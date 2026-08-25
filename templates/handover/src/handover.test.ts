/** 인수인계 템플릿 테스트 — compile 규칙과 실행 계층 불변식(SPEC §3 원칙 7).
 *  모의 LlmClient는 이 파일 안에서 문자열 규칙으로 직접 구현한다:
 *  템플릿 패키지는 웹(apps/web)에 의존하지 않는다 — import 금지. */

import { describe, expect, it } from "vitest";
import { GradeFormatError, type CaseDef, type InterviewSubmission } from "@harnest/contracts";
import { compile, MAX_CALLS_PER_RUN, MAX_CASES, MIN_CASES, TEMPLATE_ID, type CompileOptions } from "./index";
import { mutatePrompt, oneshotPrompt } from "./prompts";
import {
  CallBudgetExceededError,
  createGenerator,
  createInitial,
  createScorer,
  gradeResponse,
  scoreHoldout,
  withCallBudget,
  type LlmClient,
} from "./runtime";

const mockJudge: CompileOptions = { judgeProvider: "mock", judgeModel: "테스트-모의" };

function makeSubmission(caseCount: number, lengthCap: number = 2000): InterviewSubmission {
  return {
    schemaVersion: "skeleton-1",
    templateId: TEMPLATE_ID,
    answers: {
      material: "사내 배포 파이프라인을 관리하는 업무입니다.",
      cases: Array.from({ length: caseCount }, (_, i) => ({
        question: `질문 ${i + 1}: 항목${i + 1}은 어떻게 처리하나요?`,
        expectedAnswer: `정답 ${i + 1}: 절차${i + 1}을 따르면 됩니다.`,
      })),
      lengthCap,
    },
  };
}

/** 프롬프트 기록형 모의 LLM — prompts.ts의 고정 마커로 역할을 판별하는 문자열 규칙.
 *  responder 배치: 질문 목록의 케이스마다 문서에 정답이 있으면 그 정답, 없으면 "문서에 없음".
 *  grader 배치: 응답이 "문서에 없음"이면 0, 참조 답을 그대로 담으면 1, 그 외 0.5. */
interface RecordingLlm extends LlmClient {
  prompts: string[];
}

function createRecordingLlm(allCases: CaseDef[]): RecordingLlm {
  const prompts: string[] = [];
  return {
    providerId: "mock",
    model: "테스트-모의",
    prompts,
    async complete(prompt) {
      prompts.push(prompt);
      // responder 배치 — 문서·질문 목록만 담긴 프롬프트
      if (prompt.includes("아래 문서만을 근거로")) {
        const doc = prompt.split("## 문서")[1]?.split("## 질문 목록")[0] ?? "";
        const listBlock = prompt.split("## 질문 목록")[1] ?? "";
        const ids = [...listBlock.matchAll(/### 질문 \(([^)]+)\)/g)].map((m) => m[1]);
        return JSON.stringify(
          ids.map((id) => {
            const found = allCases.find((c) => c.id === id);
            const covered = found && doc.includes(found.expectedAnswer);
            return { caseId: id, answer: covered ? found.expectedAnswer : "문서에 없음" };
          }),
        );
      }
      // grader 배치 — 참조 답 대조
      if (prompt.includes("## 채점 목록")) {
        return JSON.stringify(
          prompt.split("### 케이스 (").slice(1).map((chunk) => {
            const caseId = chunk.split(")")[0];
            const expected =
              chunk.split("\n참조 답 (기록된 실제 답): ")[1]?.split("\n채점할 응답: ")[0] ?? "";
            const response = (chunk.split("\n채점할 응답: ")[1] ?? "")
              .split("\n\n엄격하게")[0]
              .trim();
            const score =
              response.includes("문서에 없음") ? 0 : response.includes(expected) ? 1 : 0.5;
            return { caseId, score, why: "문자열 규칙 채점" };
          }),
        );
      }
      // 변이(mutate)
      if (prompt.includes("## 실패 목록")) return "변이된 문서";
      // 원샷
      return "원샷 문서";
    },
  };
}

describe("compile", () => {
  it("케이스 6개는 가시 4 / 홀드아웃 2로 꼬리 분할되고 holdoutCaseIds가 일치한다", async () => {
    const { problem, pack } = await compile(makeSubmission(6), mockJudge);

    expect(problem.visibleCases.map((c) => c.id)).toEqual([
      "case-1", "case-2", "case-3", "case-4",
    ]);
    expect(problem.holdoutCases.map((c) => c.id)).toEqual(["case-5", "case-6"]);

    const hp = pack.holdoutPolicy;
    expect(hp.mode).toBe("auto_tail");
    if (hp.mode !== "auto_tail") throw new Error("unreachable");
    expect(hp.holdoutCaseIds).toEqual(problem.holdoutCases.map((c) => c.id));
  });

  it("판정 절차 다이제스트가 계산되어 동결된다 (SHA-256 hex)", async () => {
    const { pack, loopSpec } = await compile(makeSubmission(6), mockJudge);
    expect(pack.definitionDigest).toMatch(/^[0-9a-f]{64}$/);
    // 시드는 다이제스트에서 파생 — 같은 입력이면 리플레이 가능
    expect(loopSpec.seed).toBe(parseInt(pack.definitionDigest.slice(0, 8), 16));
  });

  it("케이스 3개 이하는 거부한다 (최소 4개)", async () => {
    await expect(compile(makeSubmission(MIN_CASES - 1), mockJudge)).rejects.toThrow(
      `${MIN_CASES}개 이상`,
    );
  });

  it("케이스 상한을 넘는 입력은 거부한다", async () => {
    await expect(compile(makeSubmission(MAX_CASES + 1), mockJudge)).rejects.toThrow("최대");
  });

  it("분량 범위(500~20,000자) 밖은 거부한다", async () => {
    await expect(compile(makeSubmission(6, 499), mockJudge)).rejects.toThrow("500~20,000");
    await expect(compile(makeSubmission(6, 20_001), mockJudge)).rejects.toThrow("500~20,000");
  });

  it("기록 전체가 상한 안이면 베끼기 방어 정적 안내를 남기고, 상한을 넘으면 안내가 없다", async () => {
    // 짧은 답 4개 + 넉넉한 상한 2,000자 — 통째 베끼기를 분량 게이트가 못 걸러내는 설정
    const roomy = await compile(makeSubmission(6, 2000), mockJudge);
    expect(roomy.notices.some((n) => n.includes("베끼기"))).toBe(true);

    // 상한 500자 — 가시 기록 전체(4케이스 × 약 130자)가 상한을 넘어 게이트가 방어한다
    const padded = makeSubmission(6, 500);
    for (const c of padded.answers["cases"] as Array<Record<string, unknown>>) {
      c.expectedAnswer = `${c.expectedAnswer} 상세 절차는 위키의 운영 문서에 정리되어 있고 담당자 승인 뒤 진행해야 하며 금요일 배포는 금지입니다. 예외는 보안 패치뿐이며 그때도 사후 보고가 필요합니다.`;
    }
    const tight = await compile(padded, mockJudge);
    expect(tight.notices).toEqual([]);
  });

  it("judge 옵션은 pack에 동결되며 다이제스트에 결속된다", async () => {
    const a = await compile(makeSubmission(6), { judgeProvider: "mock", judgeModel: "모의-감정관" });
    const jp = a.pack.judgeProcedure;
    expect(jp.kind).toBe("case_answering");
    if (jp.kind !== "case_answering") throw new Error("unreachable");
    expect(jp.judge).toEqual({ provider: "mock", model: "모의-감정관" });

    // 저지 모델 교체 = 다른 판정 절차 = 다른 다이제스트 (교체는 재승인)
    const b = await compile(makeSubmission(6), {
      judgeProvider: "gemini",
      judgeModel: "gemini-3.7-flash",
    });
    expect(b.pack.definitionDigest).not.toBe(a.pack.definitionDigest);

    const c = await compile(makeSubmission(6), {
      judgeProvider: "openai",
      judgeModel: "gpt-5.6-sol",
    });
    expect(c.pack.definitionDigest).not.toBe(b.pack.definitionDigest);

    const vertex = await compile(makeSubmission(6), {
      judgeProvider: "vertex",
      judgeModel: "gemini-3.7-flash",
    });
    expect(vertex.pack.definitionDigest).not.toBe(b.pack.definitionDigest);
  });

  it("케이스 provenance는 컴파일을 통과해 가시·홀드아웃 케이스에 유지된다", async () => {
    const submission = makeSubmission(6);
    const cases = submission.answers["cases"] as Array<Record<string, unknown>>;
    cases[0].provenance = "ai";
    cases[5].provenance = "ai_edited";
    const { problem } = await compile(submission, mockJudge);

    expect(problem.visibleCases[0].provenance).toBe("ai");
    expect(problem.visibleCases[1].provenance).toBeUndefined();
    expect(problem.holdoutCases[1].provenance).toBe("ai_edited");
  });

  it("provenance만 달라도 다이제스트가 달라진다 — 케이스 출처는 판정 절차에 결속된다", async () => {
    const plain = await compile(makeSubmission(6), mockJudge);
    const withAi = makeSubmission(6);
    (withAi.answers["cases"] as Array<Record<string, unknown>>)[0].provenance = "ai";
    const { pack } = await compile(withAi, mockJudge);

    expect(pack.definitionDigest).not.toBe(plain.pack.definitionDigest);
  });

  it('명시적 "user"와 생략은 같은 다이제스트다 — 직접 입력 흐름의 다이제스트 보존(생략 규약)', async () => {
    const plain = await compile(makeSubmission(6), mockJudge);
    const explicit = makeSubmission(6);
    for (const c of explicit.answers["cases"] as Array<Record<string, unknown>>) {
      c.provenance = "user";
    }
    const { pack } = await compile(explicit, mockJudge);

    expect(pack.definitionDigest).toBe(plain.pack.definitionDigest);
  });

  it("provenance는 생성 프롬프트에 유입되지 않는다 — 공개용 메타데이터", async () => {
    const submission = makeSubmission(6);
    for (const c of submission.answers["cases"] as Array<Record<string, unknown>>) {
      c.provenance = "ai";
    }
    const { problem } = await compile(submission, mockJudge);

    expect(oneshotPrompt(problem)).not.toContain("provenance");
    expect(
      mutatePrompt(problem, "챔피언 문서", 42, ["case-1: 오답"], 3),
    ).not.toContain("provenance");
  });
});

describe("createScorer", () => {
  it("분량 초과는 게이트에서 실격되고 LLM은 한 번도 호출되지 않는다", async () => {
    const { problem } = await compile(makeSubmission(6), mockJudge);
    const llm = createRecordingLlm([...problem.visibleCases, ...problem.holdoutCases]);
    const scorer = createScorer(problem, llm);

    const result = await scorer("가".repeat(problem.lengthCap + 1));
    expect(result.gateRejected).toBe(true);
    expect(result.total).toBe(0);
    expect(result.violations[0]).toContain("분량 초과");
    expect(llm.prompts).toHaveLength(0);
  });

  it("가시 케이스만 채점한다 — 홀드아웃 질문은 responder 프롬프트에 등장하지 않는다(불변식)", async () => {
    const { problem } = await compile(makeSubmission(6), mockJudge);
    const llm = createRecordingLlm([...problem.visibleCases, ...problem.holdoutCases]);
    const scorer = createScorer(problem, llm);

    // 가시 케이스 1·2의 정답만 담긴 문서 → 4개 중 2개 정답 = 50점
    const doc =
      "배포 파이프라인 안내. " +
      problem.visibleCases[0].expectedAnswer +
      " " +
      problem.visibleCases[1].expectedAnswer;
    const result = await scorer(doc);

    expect(result.gateRejected).toBe(false);
    expect(result.total).toBe(50);
    expect(result.parts).toEqual({ case_answerability: 50 });

    // violations 문자열에 실패한 케이스 id가 담긴다 (Generator 피드백의 재료)
    expect(result.violations).toHaveLength(2);
    expect(result.violations[0]).toContain("case-3");
    expect(result.violations[1]).toContain("case-4");

    // 배치 채점: responder 1콜 + grader 1콜 — 케이스 수와 무관
    const responderPrompts = llm.prompts.filter((p) => p.includes("아래 문서만을 근거로"));
    expect(responderPrompts).toHaveLength(1);
    expect(llm.prompts).toHaveLength(2);

    // 불변식: 홀드아웃 케이스의 질문·정답은 어떤 프롬프트에도 등장하지 않는다
    for (const h of problem.holdoutCases) {
      for (const p of llm.prompts) {
        expect(p).not.toContain(h.question);
        expect(p).not.toContain(h.expectedAnswer);
      }
    }
    // 가시 케이스 질문은 각각 responder 프롬프트에 등장한다
    for (const v of problem.visibleCases) {
      expect(responderPrompts.some((p) => p.includes(v.question))).toBe(true);
    }
  });
});

describe("배치 채점 — 형식 오류", () => {
  const sequenceLlm = (outputs: string[]): LlmClient & { prompts: string[] } => {
    const prompts: string[] = [];
    return {
      providerId: "mock",
      model: "배치-형식-테스트",
      prompts,
      async complete(prompt) {
        prompts.push(prompt);
        return outputs.shift() ?? "";
      },
    };
  };

  it("responder 배치가 요청 케이스를 모두 담지 않으면 형식 재시도 1회 후 성공한다", async () => {
    const { problem } = await compile(makeSubmission(6), mockJudge);
    const answers = problem.visibleCases.map((c) => ({ caseId: c.id, answer: c.expectedAnswer }));
    const grades = problem.visibleCases.map((c) => ({ caseId: c.id, score: 1, why: "정답" }));
    const llm = sequenceLlm([
      JSON.stringify(answers.slice(0, 1)), // 케이스 누락 — 부분 결과로 채점하지 않는다
      JSON.stringify(answers),
      JSON.stringify(grades),
    ]);

    const result = await createScorer(problem, llm)("문서");
    expect(result.total).toBe(100);
    expect(llm.prompts).toHaveLength(3);
    expect(llm.prompts[1]).toContain("<invalid-output>");
  });

  it("grader 배치가 재시도까지 실패하면 GradeFormatError를 던진다", async () => {
    const { problem } = await compile(makeSubmission(6), mockJudge);
    const answers = problem.visibleCases.map((c) => ({ caseId: c.id, answer: c.expectedAnswer }));
    const llm = sequenceLlm([
      JSON.stringify(answers),
      "배열 아님",
      '[{"caseId": "case-1", "score": 2, "why": "허용되지 않은 점수"}]',
    ]);

    const thrown = await createScorer(problem, llm)("문서").then(
      () => null,
      (e: unknown) => e,
    );
    expect(thrown).toBeInstanceOf(GradeFormatError);
    expect(String(thrown)).toContain("형식 수정 요청 1회 후에도");
    expect(llm.prompts).toHaveLength(3);
  });
});

describe("gradeResponse — 형식 오류", () => {
  const sequenceLlm = (outputs: string[]): LlmClient & { prompts: string[] } => {
    const prompts: string[] = [];
    return {
      providerId: "mock",
      model: "형식-테스트",
      prompts,
      async complete(prompt) {
        prompts.push(prompt);
        return outputs.shift() ?? "";
      },
    };
  };

  it("JSON 코드 펜스는 제거하되 score 집합과 비어 있지 않은 why를 엄격 검증한다", async () => {
    const llm = sequenceLlm(['```json\n{"score": 0.5, "why": "핵심 일부 누락"}\n```']);
    await expect(gradeResponse(llm, "질문", "정답", "응답")).resolves.toEqual({
      score: 0.5,
      why: "핵심 일부 누락",
    });
    expect(llm.prompts).toHaveLength(1);
  });

  it("첫 형식 오류는 형식 수정 요청으로 한 번만 재시도한다", async () => {
    const llm = sequenceLlm([
      '{"score": 0.7, "why": "허용되지 않은 점수"}',
      '{"score": 1, "why": "핵심 포함"}',
    ]);
    await expect(gradeResponse(llm, "질문", "정답", "응답")).resolves.toEqual({
      score: 1,
      why: "핵심 포함",
    });
    expect(llm.prompts).toHaveLength(2);
    expect(llm.prompts[1]).toContain("이전 출력은 JSON 형식 검증에 실패");
  });

  it("재시도도 잘리거나 why가 비어 있으면 가짜 0점 대신 명시적 오류를 던진다", async () => {
    const llm = sequenceLlm(['{"score":', '{"score": 0, "why": ""}']);
    // 계약 타입으로 던진다 — 페이지는 메시지가 아니라 이 타입으로 판별한다(경계 원칙)
    const thrown = await gradeResponse(llm, "질문", "정답", "응답").then(
      () => null,
      (e: unknown) => e,
    );
    expect(thrown).toBeInstanceOf(GradeFormatError);
    expect(String(thrown)).toContain("채점 출력 형식 오류");
    expect(llm.prompts).toHaveLength(2);
  });
});

describe("scoreHoldout", () => {
  it("홀드아웃 케이스만 채점한다 — 가시 질문은 responder 프롬프트에 등장하지 않는다", async () => {
    const { problem } = await compile(makeSubmission(6), mockJudge);
    const llm = createRecordingLlm([...problem.visibleCases, ...problem.holdoutCases]);

    // 홀드아웃 케이스 1(case-5)의 정답만 담긴 문서 → 2개 중 1개 정답 = 50점
    const doc = "요약 문서. " + problem.holdoutCases[0].expectedAnswer;
    const result = await scoreHoldout(problem, doc, llm);

    expect(result.gateRejected).toBe(false);
    expect(result.score).toBe(50);
    expect(result.perCase.map((g) => g.caseId)).toEqual(["case-5", "case-6"]);
    expect(result.perCase.map((g) => g.score)).toEqual([1, 0]);

    const responderPrompts = llm.prompts.filter((p) => p.includes("아래 문서만을 근거로"));
    expect(responderPrompts).toHaveLength(1);
    // 가시 케이스의 질문은 어떤 responder 프롬프트에도 등장하지 않는다
    for (const v of problem.visibleCases) {
      for (const p of responderPrompts) expect(p).not.toContain(v.question);
    }
    // 홀드아웃 질문은 각각 등장한다
    for (const h of problem.holdoutCases) {
      expect(responderPrompts.some((p) => p.includes(h.question))).toBe(true);
    }
  });

  it("분량 게이트 실격은 0점이 아니라 score null이며 모델을 호출하지 않는다", async () => {
    const { problem } = await compile(makeSubmission(6), mockJudge);
    const llm = createRecordingLlm([...problem.visibleCases, ...problem.holdoutCases]);
    const result = await scoreHoldout(problem, "가".repeat(problem.lengthCap + 1), llm);

    expect(result).toEqual({
      gateRejected: true,
      score: null,
      perCase: [],
      violations: [`분량 초과 실격: ${problem.lengthCap + 1}자 > ${problem.lengthCap}자`],
    });
    expect(llm.prompts).toHaveLength(0);
  });

  it("홀드아웃 질문을 가시 질문과의 반복/신규로 구분하되 분할에서 제거하지 않는다", async () => {
    const submission = makeSubmission(6);
    const cases = submission.answers["cases"] as Array<{
      question: string;
      expectedAnswer: string;
    }>;
    cases[4].question = `  ${cases[0].question.toUpperCase()}  `;
    const { problem } = await compile(submission, mockJudge);
    const llm = createRecordingLlm([...problem.visibleCases, ...problem.holdoutCases]);
    const result = await scoreHoldout(problem, "요약 문서", llm);

    expect(result.gateRejected).toBe(false);
    expect(result.perCase).toHaveLength(2);
    expect(result.perCase.map((g) => g.caseType)).toEqual(["repeated", "new"]);
    expect(problem.holdoutCases.map((c) => c.id)).toEqual(["case-5", "case-6"]);
  });
});

describe("createGenerator", () => {
  it("mutatePrompt에 feedback의 championScore·championViolations·round가 실린다", async () => {
    const { problem } = await compile(makeSubmission(6), mockJudge);
    const llm = createRecordingLlm([...problem.visibleCases, ...problem.holdoutCases]);
    const generate = createGenerator(problem, llm);

    const violation = "case-2 (질문 2: 항목2은 어떻게 처리…): 오답 — 핵심 절차 누락";
    const out = await generate("현재 챔피언 문서 본문", () => 0.5, {
      round: 3,
      championScore: 42,
      championViolations: [violation],
    });

    expect(out).toBe("변이된 문서");
    expect(llm.prompts).toHaveLength(1);
    const prompt = llm.prompts[0];
    expect(prompt).toContain("## 실패 목록");
    expect(prompt).toContain(violation);
    expect(prompt).toContain("현재 문서 (점수 42/100)");
    expect(prompt).toContain("현재 챔피언 문서 본문");
    expect(prompt).toContain("라운드 3");
    // 변이 프롬프트도 가시 케이스만 본다 — 홀드아웃 유입 금지
    for (const h of problem.holdoutCases) {
      expect(prompt).not.toContain(h.question);
      expect(prompt).not.toContain(h.expectedAnswer);
    }
  });
});

describe("생성 출력 토큰 예산", () => {
  it("원샷·변이 호출에 분량 상한 연동 maxOutputTokens가 실린다 — 기본 상한의 조용한 절단 방지", async () => {
    const { problem } = await compile(makeSubmission(6, 8000), mockJudge);
    const optsSeen: Array<number | undefined> = [];
    const llm: LlmClient = {
      providerId: "mock",
      model: "테스트-모의",
      async complete(_prompt, opts) {
        optsSeen.push(opts?.maxOutputTokens);
        return "문서";
      },
    };

    await createInitial(problem, llm)(() => 0);
    await createGenerator(problem, llm)("챔피언 문서", () => 0, {
      round: 1,
      championScore: 0,
      championViolations: [],
    });
    expect(optsSeen).toEqual([16_000, 16_000]);
  });

  it("배치 채점 호출에도 케이스 수 연동 maxOutputTokens가 실린다", async () => {
    // 최대 구성: 30케이스 → 가시 20 — 기본 상한(8192)보다 큰 예산이 필요한 지점
    const { problem } = await compile(makeSubmission(MAX_CASES), mockJudge);
    const seen: Array<number | undefined> = [];
    const llm: LlmClient = {
      providerId: "mock",
      model: "테스트-모의",
      async complete(prompt, opts) {
        seen.push(opts?.maxOutputTokens);
        if (prompt.includes("아래 문서만을 근거로")) {
          return JSON.stringify(
            problem.visibleCases.map((c) => ({ caseId: c.id, answer: c.expectedAnswer })),
          );
        }
        return JSON.stringify(
          problem.visibleCases.map((c) => ({ caseId: c.id, score: 1, why: "정답" })),
        );
      },
    };

    await createScorer(problem, llm)("문서");
    expect(problem.visibleCases).toHaveLength(20);
    expect(seen).toEqual([20_480, 20_480]);
  });
});

describe("withCallBudget", () => {
  it("예산 안에서는 그대로 위임하고, 소진 후에는 원 클라이언트 호출 없이 차단한다", async () => {
    let underlyingCalls = 0;
    const llm: LlmClient = {
      providerId: "mock",
      model: "테스트-모의",
      async complete() {
        underlyingCalls += 1;
        return "응답";
      },
    };
    const budgeted = withCallBudget(llm, 2);
    await expect(budgeted.complete("1")).resolves.toBe("응답");
    await expect(budgeted.complete("2")).resolves.toBe("응답");
    await expect(budgeted.complete("3")).rejects.toBeInstanceOf(CallBudgetExceededError);
    await expect(budgeted.complete("4")).rejects.toBeInstanceOf(CallBudgetExceededError);
    expect(underlyingCalls).toBe(2);
  });

  it("선언된 실행 예산은 최대 구성의 이론적 최악 호출 수를 넘는 백스톱이다", async () => {
    const { loopSpec } = await compile(makeSubmission(MAX_CASES), mockJudge);
    // 배치 채점 1회 최악 = responder + 형식 재시도 + grader + 형식 재시도 = 4콜
    const perScoringWorst = 4;
    const worst = (loopSpec.maxRounds + 1) * (1 + perScoringWorst) + 2 * perScoringWorst;
    expect(MAX_CALLS_PER_RUN).toBeGreaterThan(worst);
  });
});
