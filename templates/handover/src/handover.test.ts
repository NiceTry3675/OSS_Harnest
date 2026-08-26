/** 인수인계 템플릿 테스트 — compile 규칙과 실행 계층 불변식(SPEC §3 원칙 7).
 *  모의 LlmClient는 이 파일 안에서 문자열 규칙으로 직접 구현한다:
 *  템플릿 패키지는 웹(apps/web)에 의존하지 않는다 — import 금지. */

import { describe, expect, it } from "vitest";
import { GradeFormatError, type CaseDef, type InterviewSubmission } from "@harnest/contracts";
import {
  compile,
  MAX_CALLS_PER_RUN,
  MAX_CASES,
  MIN_CASES,
  TEMPLATE_ID,
  type CompileOptions,
  type HandoverProblem,
} from "./index";
import {
  graderPrompt,
  gradersPrompt,
  mutatePrompt,
  oneshotPrompt,
  reviseLimitBlock,
} from "./prompts";
import {
  batchOutputTokensFor,
  CallBudgetExceededError,
  CONCISENESS_WEIGHT,
  COVERAGE_WEIGHT,
  createGenerator,
  createInitial,
  createScorer,
  createStrategyPlanner,
  gradeResponse,
  hardLengthCapFor,
  LENGTH_POLICY,
  lengthOverflowPenalty,
  maxOutputTokensFor,
  parseStrategy,
  scoreHoldout,
  withCallBudget,
  type LlmClient,
} from "./runtime";

const mockJudge: CompileOptions = { judgeProvider: "mock", judgeModel: "테스트-모의" };

function makeSubmission(
  caseCount: number,
  lengthCap: number = 2000,
  conciseness?: boolean,
): InterviewSubmission {
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
      ...(conciseness === undefined ? {} : { conciseness }),
    },
  };
}

/** 실행 계층 테스트용 문제 리터럴 — 분할 정책(compile의 시드 셔플)과 무관하게
 *  피드백·가드·홀드아웃 구성을 직접 고정한다. 분할 자체는 compile describe가 검증한다. */
function makeProblem(over: Partial<HandoverProblem> = {}): HandoverProblem {
  const c = (i: number): CaseDef => ({
    id: `case-${i}`,
    question: `질문 ${i}: 항목${i}은 어떻게 처리하나요?`,
    expectedAnswer: `정답 ${i}: 절차${i}을 따르면 됩니다.`,
  });
  return {
    material: "사내 배포 파이프라인을 관리하는 업무입니다.",
    visibleCases: [c(1), c(2), c(3), c(4)],
    guardCases: [c(5), c(6)],
    holdoutCases: [c(7), c(8)],
    lengthCap: 2000,
    lengthPolicy: LENGTH_POLICY,
    useConciseness: true,
    ...over,
  };
}

const allCasesOf = (problem: HandoverProblem): CaseDef[] => [
  ...problem.visibleCases,
  ...problem.guardCases,
  ...problem.holdoutCases,
];

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
  it("케이스 6개는 시드 셔플로 피드백 3 / 가드 2 / 홀드아웃 1로 분할되고 팩과 일치한다", async () => {
    const { problem, pack } = await compile(makeSubmission(6), mockJudge);

    expect(problem.visibleCases).toHaveLength(3);
    expect(problem.guardCases).toHaveLength(2);
    expect(problem.holdoutCases).toHaveLength(1);
    // 세 집합은 전체 케이스의 겹침 없는 분할이다
    const allIds = allCasesOf(problem).map((c) => c.id);
    expect([...allIds].sort()).toEqual(
      ["case-1", "case-2", "case-3", "case-4", "case-5", "case-6"].sort(),
    );
    expect(new Set(allIds).size).toBe(6);

    const hp = pack.holdoutPolicy;
    expect(hp.mode).toBe("seeded_split");
    if (hp.mode !== "seeded_split") throw new Error("unreachable");
    expect(hp.guardCaseIds).toEqual(problem.guardCases.map((c) => c.id));
    expect(hp.holdoutCaseIds).toEqual(problem.holdoutCases.map((c) => c.id));
    // 허용 오차 = 채점 반 단계: 100 / (2 × 가드 2개)
    expect(hp.guardTolerance).toBe(25);
  });

  it("같은 시험지는 다시 컴파일해도 같은 분할·같은 다이제스트다 — 컴파일 순수성", async () => {
    const a = await compile(makeSubmission(8), mockJudge);
    const b = await compile(makeSubmission(8), mockJudge);
    expect(b.pack.definitionDigest).toBe(a.pack.definitionDigest);
    expect(b.problem.visibleCases.map((c) => c.id)).toEqual(
      a.problem.visibleCases.map((c) => c.id),
    );
    expect(b.problem.guardCases.map((c) => c.id)).toEqual(a.problem.guardCases.map((c) => c.id));
    expect(b.problem.holdoutCases.map((c) => c.id)).toEqual(
      a.problem.holdoutCases.map((c) => c.id),
    );
  });

  it("케이스 30개는 피드백 12 / 가드 12 / 홀드아웃 6으로 분할된다 (40/40/20)", async () => {
    const { problem, pack } = await compile(makeSubmission(MAX_CASES), mockJudge);
    expect(problem.visibleCases).toHaveLength(12);
    expect(problem.guardCases).toHaveLength(12);
    expect(problem.holdoutCases).toHaveLength(6);
    const hp = pack.holdoutPolicy;
    if (hp.mode !== "seeded_split") throw new Error("unreachable");
    // 100 / (2 × 12) = 4.166… → 소수 첫째 자리 올림
    expect(hp.guardTolerance).toBe(4.2);
  });

  // 실측(bb88db60): 내림(8.3)이면 가드 6문항에서 91.7 → 83.3(반 단계 하나)이 8.4로
  // 벌어져 기각된다. 챔피언 가드가 91.7·66.7에 앉는 순간 스칼라가 훨씬 높은 후보도
  // 전부 막혀 실행이 얼어붙는다. 올림이라야 "반 단계 하나는 봐준다"가 성립한다.
  it("가드 허용 오차는 올림이라 반 단계 하나를 실제로 덮는다", async () => {
    const { problem, pack } = await compile(makeSubmission(15), mockJudge);
    expect(problem.guardCases).toHaveLength(6);
    const hp = pack.holdoutPolicy;
    if (hp.mode !== "seeded_split") throw new Error("unreachable");
    expect(hp.guardTolerance).toBe(8.4);

    // 반 단계 하나는 통과, 두 단계는 기각 — 모든 등급에서
    const rungs = Array.from({ length: 13 }, (_, i) => Math.round(((12 - i) / 12) * 1000) / 10);
    for (let i = 0; i + 1 < rungs.length; i += 1) {
      expect(rungs[i + 1]).toBeGreaterThanOrEqual(rungs[i] - hp.guardTolerance - 1e-9);
    }
    for (let i = 0; i + 2 < rungs.length; i += 1) {
      expect(rungs[i + 2]).toBeLessThan(rungs[i] - hp.guardTolerance);
    }
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

  it("새 컴파일은 분량 채점 정책 버전을 problem과 pack에 함께 결속한다", async () => {
    const compiled = await compile(makeSubmission(6), mockJudge);

    expect(compiled.problem.lengthPolicy).toBe(LENGTH_POLICY);
    expect(compiled.pack.criteria[0].params.lengthPolicy).toBe(LENGTH_POLICY);
    expect(compiled.pack.gates[0].params.lengthPolicy).toBe(LENGTH_POLICY);
    expect(compiled.loopSpec.feedbackMode).toBe("recent_public_experiments_v1");
  });

  it("케이스 상한을 넘는 입력은 거부한다", async () => {
    await expect(compile(makeSubmission(MAX_CASES + 1), mockJudge)).rejects.toThrow("최대");
  });

  it("분량 범위(500~20,000자) 밖은 거부한다", async () => {
    await expect(compile(makeSubmission(6, 499), mockJudge)).rejects.toThrow("500~20,000");
    await expect(compile(makeSubmission(6, 20_001), mockJudge)).rejects.toThrow("500~20,000");
  });

  it("간결성 토글이 criteria와 다이제스트에 결속된다 — 키 없음(구버전 답변)은 켬", async () => {
    const on = await compile(makeSubmission(6), mockJudge);
    expect(on.problem.useConciseness).toBe(true);
    expect(on.pack.criteria.map((c) => [c.id, c.weight])).toEqual([
      ["case_answerability", COVERAGE_WEIGHT],
      ["conciseness", CONCISENESS_WEIGHT],
    ]);
    expect(on.pack.gates[0].params).toEqual({
      maxChars: 2500,
      softMaxChars: 2000,
      maxOverflowPenalty: 20,
      lengthPolicy: LENGTH_POLICY,
    });

    const off = await compile(makeSubmission(6, 2000, false), mockJudge);
    expect(off.problem.useConciseness).toBe(false);
    expect(off.pack.criteria.map((c) => [c.id, c.weight])).toEqual([
      ["case_answerability", 1.0],
    ]);
    // 토글 = 판정 절차 변경 = 다른 다이제스트 (재승인 원칙)
    expect(off.pack.definitionDigest).not.toBe(on.pack.definitionDigest);

    // 명시적 켬과 키 없음은 같은 criteria → 같은 다이제스트
    const explicitOn = await compile(makeSubmission(6, 2000, true), mockJudge);
    expect(explicitOn.pack.definitionDigest).toBe(on.pack.definitionDigest);
  });

  it("질문·답 전체가 상한 안이면 그대로 옮길 수 있다는 안내를 남기고, 상한을 넘으면 안내가 없다", async () => {
    // 짧은 답 + 넉넉한 상한 2,000자 — 질문·답 전체를 옮겨도 분량 조건이 걸러내지 못하는 설정
    const roomy = await compile(makeSubmission(6, 2000), mockJudge);
    expect(roomy.notices.some((n) => n.includes("그대로 옮겨도"))).toBe(true);

    // 상한 500자 — 피드백 기록 전체(3케이스 × 약 200자)가 상한을 넘어 게이트가 방어한다
    const padded = makeSubmission(6, 500);
    for (const c of padded.answers["cases"] as Array<Record<string, unknown>>) {
      c.expectedAnswer =
        `${c.expectedAnswer} 상세 절차는 위키의 운영 문서에 정리되어 있고 담당자 승인 뒤 진행해야 하며 금요일 배포는 금지입니다. ` +
        `예외는 보안 패치뿐이며 그때도 사후 보고가 필요합니다. 장애가 발생하면 온콜 채널에 먼저 공유하고 롤백 여부를 ` +
        `리드와 합의한 뒤 진행 기록을 운영 일지에 남겨야 합니다.`;
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

  it("케이스 provenance는 컴파일과 시드 분할을 통과해 각 케이스에 유지된다", async () => {
    const submission = makeSubmission(6);
    const cases = submission.answers["cases"] as Array<Record<string, unknown>>;
    cases[0].provenance = "ai";
    cases[5].provenance = "ai_edited";
    const { problem } = await compile(submission, mockJudge);

    const byId = new Map(allCasesOf(problem).map((c) => [c.id, c]));
    expect(byId.get("case-1")!.provenance).toBe("ai");
    expect(byId.get("case-2")!.provenance).toBeUndefined();
    expect(byId.get("case-6")!.provenance).toBe("ai_edited");
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
  it("분량 정책 버전이 없는 구버전 승인본은 새 scorer로 실행하지 않는다", () => {
    const current = makeProblem();
    const legacy = { ...current, lengthPolicy: undefined } as unknown as HandoverProblem;
    const llm = createRecordingLlm(allCasesOf(current));

    expect(() => createScorer(legacy, llm)).toThrow("평가 구성을 다시 만들어 승인");
    expect(llm.prompts).toHaveLength(0);
  });

  it("최대 안전 분량 초과만 게이트에서 실격되고 LLM은 한 번도 호출되지 않는다", async () => {
    const problem = makeProblem();
    const llm = createRecordingLlm(allCasesOf(problem));
    const scorer = createScorer(problem, llm);
    const hardCap = hardLengthCapFor(problem.lengthCap);

    const result = await scorer("가".repeat(hardCap + 1));
    expect(result.gateRejected).toBe(true);
    expect(result.total).toBe(0);
    expect(result.guardScore).toBeNull();
    expect(result.violations[0]).toBe(
      `최대 분량 초과 실격: ${hardCap + 1}자 > ${hardCap}자 (권장 ${problem.lengthCap}자)`,
    );
    expect(llm.prompts).toHaveLength(0);
  });

  it("권장 분량부터 최대 안전 분량까지는 초과 비율에 따라 선형 감점한다", async () => {
    const problem = makeProblem({ guardCases: [] });
    const llm = createRecordingLlm(allCasesOf(problem));
    const scorer = createScorer(problem, llm);
    const answers = problem.visibleCases.map((c) => c.expectedAnswer).join(" ");
    const doc = answers.padEnd(2250, "가"); // 권장 2,000자와 최대 2,500자의 정중앙

    const result = await scorer(doc);

    expect(result.gateRejected).toBe(false);
    expect(result.parts).toEqual({ case_answerability: 100, conciseness: 0 });
    expect(result.adjustments).toEqual({ length_overflow: -10 });
    expect(result.total).toBe(70); // 답변 가능성 80점 - 초과 감점 10점
    expect(result.violations.at(-1)).toContain("종합 점수 10점 감점");
    expect(llm.prompts).toHaveLength(2);
  });

  it("간결성을 끄더라도 권장 분량 초과 감점은 적용하되 답변 가능성 부분 점수는 보존한다", async () => {
    const problem = makeProblem({ guardCases: [], useConciseness: false });
    const llm = createRecordingLlm(allCasesOf(problem));
    const answers = problem.visibleCases.map((c) => c.expectedAnswer).join(" ");
    const result = await createScorer(problem, llm)(answers.padEnd(2250, "가"));

    expect(result.parts).toEqual({ case_answerability: 100 });
    expect(result.adjustments).toEqual({ length_overflow: -10 });
    expect(result.total).toBe(90);
  });

  it("분량 감점 경계는 권장 상한 0점에서 최대 안전 상한 20점까지 이어진다", () => {
    expect(lengthOverflowPenalty(8000, 8000)).toBe(0);
    expect(lengthOverflowPenalty(8000, 8400)).toBe(4);
    expect(lengthOverflowPenalty(8000, 9000)).toBe(10);
    expect(lengthOverflowPenalty(8000, 10_000)).toBe(20);
  });

  it("피드백 케이스를 채점하고 가드는 별도 배치로 집계만 낸다 — 홀드아웃은 등장하지 않는다", async () => {
    // 간결성 끔 — 순수 커버리지 산술을 검증한다 (켠 경로는 아래 간결성 describe)
    const problem = makeProblem({ useConciseness: false });
    const llm = createRecordingLlm(allCasesOf(problem));
    const scorer = createScorer(problem, llm);

    // 피드백 1·2와 가드 1(case-5)의 정답만 담긴 문서 → 커버리지 50, 가드 50
    const doc =
      "배포 파이프라인 안내. " +
      problem.visibleCases[0].expectedAnswer +
      " " +
      problem.visibleCases[1].expectedAnswer +
      " " +
      problem.guardCases[0].expectedAnswer;
    const result = await scorer(doc);

    expect(result.gateRejected).toBe(false);
    expect(result.total).toBe(50);
    expect(result.parts).toEqual({ case_answerability: 50 });
    expect(result.guardScore).toBe(50);

    // violations 문자열에는 실패한 피드백 케이스만 담긴다 — 가드 트레이스는
    // Generator 피드백으로 새지 않는다(비퇴보 조건은 집계 점수만 쓴다)
    expect(result.violations).toHaveLength(2);
    expect(result.violations[0]).toContain("case-3");
    expect(result.violations[1]).toContain("case-4");
    for (const v of result.violations) {
      expect(v).not.toContain("case-5");
      expect(v).not.toContain("case-6");
    }

    // 배치 채점 4콜: 피드백 responder+grader, 가드 responder+grader — 케이스 수와 무관
    const responderPrompts = llm.prompts.filter((p) => p.includes("아래 문서만을 근거로"));
    expect(responderPrompts).toHaveLength(2);
    expect(llm.prompts).toHaveLength(4);

    // 피드백과 가드는 같은 responder 프롬프트에 섞이지 않는다
    const [first, second] = responderPrompts;
    for (const v of problem.visibleCases) {
      expect(first).toContain(v.question);
      expect(second).not.toContain(v.question);
    }
    for (const g of problem.guardCases) {
      expect(first).not.toContain(g.question);
      expect(second).toContain(g.question);
    }

    // 불변식: 홀드아웃 케이스의 질문·정답은 어떤 프롬프트에도 등장하지 않는다
    for (const h of problem.holdoutCases) {
      for (const p of llm.prompts) {
        expect(p).not.toContain(h.question);
        expect(p).not.toContain(h.expectedAnswer);
      }
    }
  });

  it("가드 케이스가 없으면 guardScore는 null이고 추가 호출도 없다", async () => {
    const problem = makeProblem({ guardCases: [], useConciseness: false });
    const llm = createRecordingLlm(allCasesOf(problem));
    const result = await createScorer(problem, llm)("문서. " + problem.visibleCases[0].expectedAnswer);

    expect(result.guardScore).toBeNull();
    expect(llm.prompts).toHaveLength(2);
  });
});

describe("createScorer — 간결성 가점", () => {
  const round1 = (x: number): number => Math.round(x * 10) / 10;

  it("켜면 커버리지 0.8 + 상한 대비 여유 0.2로 합산하고, 같은 커버리지면 짧을수록 높다", async () => {
    const problem = makeProblem({ guardCases: [] }); // 기본 켬
    const llm = createRecordingLlm(allCasesOf(problem));
    const scorer = createScorer(problem, llm);

    // 가시 4케이스 중 2개 정답 = 커버리지 50
    const doc =
      "배포 파이프라인 안내. " +
      problem.visibleCases[0].expectedAnswer +
      " " +
      problem.visibleCases[1].expectedAnswer;
    const result = await scorer(doc);
    const headroom = Math.max(0, 1 - doc.length / problem.lengthCap) * 100;
    expect(result.gateRejected).toBe(false);
    expect(result.parts).toEqual({
      case_answerability: 50,
      conciseness: round1(headroom),
    });
    expect(result.total).toBe(round1(0.8 * 50 + 0.2 * headroom));

    // 같은 커버리지, 더 짧은 문서 → 더 높은 점수
    const shorter = await scorer(
      problem.visibleCases[0].expectedAnswer + " " + problem.visibleCases[1].expectedAnswer,
    );
    expect(shorter.total).toBeGreaterThan(result.total);

    // 만점 포화 없음 — 전 케이스 커버리지(100)여도 total은 100에 못 미친다
    const full = await scorer(problem.visibleCases.map((c) => c.expectedAnswer).join(" "));
    expect(full.parts["case_answerability"]).toBe(100);
    expect(full.total).toBeLessThan(100);
  });

  it("답변력이 0이면 간결성도 0 — 빈 문서가 간결성만으로 점수를 받지 못한다", async () => {
    const problem = makeProblem({ guardCases: [] });
    const llm = createRecordingLlm(allCasesOf(problem));
    const result = await createScorer(problem, llm)("관련 없는 짧은 문서");

    expect(result.total).toBe(0);
    expect(result.parts).toEqual({ case_answerability: 0, conciseness: 0 });
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
    const problem = makeProblem({ guardCases: [], useConciseness: false });
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
    const problem = makeProblem({ guardCases: [], useConciseness: false });
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
  it("홀드아웃 케이스만 채점한다 — 피드백·가드 질문은 responder 프롬프트에 등장하지 않는다", async () => {
    const problem = makeProblem();
    const llm = createRecordingLlm(allCasesOf(problem));

    // 홀드아웃 케이스 1(case-7)의 정답만 담긴 문서 → 2개 중 1개 정답 = 50점
    const doc = "요약 문서. " + problem.holdoutCases[0].expectedAnswer;
    const result = await scoreHoldout(problem, doc, llm);

    expect(result.gateRejected).toBe(false);
    expect(result.score).toBe(50);
    expect(result.perCase.map((g) => g.caseId)).toEqual(["case-7", "case-8"]);
    expect(result.perCase.map((g) => g.score)).toEqual([1, 0]);

    const responderPrompts = llm.prompts.filter((p) => p.includes("아래 문서만을 근거로"));
    expect(responderPrompts).toHaveLength(1);
    // 피드백·가드 케이스의 질문은 어떤 responder 프롬프트에도 등장하지 않는다
    for (const v of [...problem.visibleCases, ...problem.guardCases]) {
      for (const p of responderPrompts) expect(p).not.toContain(v.question);
    }
    // 홀드아웃 질문은 각각 등장한다
    for (const h of problem.holdoutCases) {
      expect(responderPrompts.some((p) => p.includes(h.question))).toBe(true);
    }
  });

  it("최대 안전 분량의 게이트 실격은 0점이 아니라 score null이며 모델을 호출하지 않는다", async () => {
    const problem = makeProblem();
    const llm = createRecordingLlm(allCasesOf(problem));
    const hardCap = hardLengthCapFor(problem.lengthCap);
    const result = await scoreHoldout(problem, "가".repeat(hardCap + 1), llm);

    expect(result).toEqual({
      gateRejected: true,
      score: null,
      perCase: [],
      violations: [
        `최대 분량 초과 실격: ${hardCap + 1}자 > ${hardCap}자 (권장 ${problem.lengthCap}자)`,
      ],
    });
    expect(llm.prompts).toHaveLength(0);
  });

  it("권장 분량만 넘은 문서는 최종 확인 질문을 정상 채점한다", async () => {
    const problem = makeProblem();
    const llm = createRecordingLlm(allCasesOf(problem));
    const doc = problem.holdoutCases[0].expectedAnswer.padEnd(problem.lengthCap + 1, "가");
    const result = await scoreHoldout(problem, doc, llm);

    expect(result.gateRejected).toBe(false);
    expect(result.score).toBe(50);
    expect(llm.prompts).toHaveLength(2);
  });

  it("홀드아웃 질문을 피드백 질문과의 반복/신규로 구분하되 분할에서 제거하지 않는다", async () => {
    const problem = makeProblem();
    // 홀드아웃 1(case-7)의 질문을 피드백 1(case-1)과 사실상 같게 — 공백·대소문자만 다르게
    problem.holdoutCases[0] = {
      ...problem.holdoutCases[0],
      question: `  ${problem.visibleCases[0].question.toUpperCase()}  `,
    };
    const llm = createRecordingLlm(allCasesOf(problem));
    const result = await scoreHoldout(problem, "요약 문서", llm);

    expect(result.gateRejected).toBe(false);
    expect(result.perCase).toHaveLength(2);
    expect(result.perCase.map((g) => g.caseType)).toEqual(["repeated", "new"]);
    expect(problem.holdoutCases.map((c) => c.id)).toEqual(["case-7", "case-8"]);
  });
});

describe("createGenerator", () => {
  it("mutatePrompt에 feedback의 championScore·championViolations·round가 실린다", async () => {
    const problem = makeProblem();
    const llm = createRecordingLlm(allCasesOf(problem));
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
    // 간결성이 켜진 절차의 변이 프롬프트에는 가점 힌트가 실린다 (강제는 scorer, 프롬프트는 힌트)
    expect(prompt).toContain("간결성 점수");
    // 가드가 있는 절차에는 비공개 검증 안내가 실린다 — 질문·정답이 아니라 존재만
    expect(prompt).toContain("공개되지 않는 검증 질문");
    // 변이 프롬프트도 피드백 케이스만 본다 — 가드·홀드아웃 유입 금지
    for (const hidden of [...problem.guardCases, ...problem.holdoutCases]) {
      expect(prompt).not.toContain(hidden.question);
      expect(prompt).not.toContain(hidden.expectedAnswer);
    }
  });

  it("직전 공개 기각 사유는 변이 프롬프트에 싣되 비공개 판정 필드는 계약에 두지 않는다", () => {
    const problem = makeProblem();
    const prompt = mutatePrompt(
      problem,
      "챔피언 문서",
      42,
      ["현재 챔피언 위반"],
      3,
      {
        candidateScore: 40,
        scoreDelta: -2,
        gateRejected: false,
        violations: ["직전 후보의 공개 위반"],
      },
    );

    expect(prompt).toContain("직전 기각 시도에서 공개 기준으로 확인한 것");
    expect(prompt).toContain("후보 점수: 40/100 (-2.0점)");
    expect(prompt).toContain("직전 후보의 공개 위반");
    expect(prompt).not.toContain("guardSafe");
    expect(prompt).not.toContain("중간 점검 점수");
  });

  it("선택한 전략과 최근 공개 실험 기록을 후보 생성 프롬프트에 함께 싣는다", async () => {
    const problem = makeProblem();
    const llm = createRecordingLlm(allCasesOf(problem));
    const strategy = {
      key: "compress_and_reallocate",
      summary: "중복 설명을 줄여 실패 질문의 예외 조건을 보강한다.",
    };

    await createGenerator(problem, llm)(
      "챔피언 문서",
      () => 0,
      {
        round: 3,
        championScore: 42,
        championViolations: ["현재 실패"],
        recentPublicExperiments: [
          {
            round: 2,
            strategy: { key: "targeted_repair", summary: "누락 항목 직접 추가" },
            candidateScore: 40,
            scoreDelta: -2,
            adopted: false,
            gateRejected: false,
            violations: ["직전 공개 실패"],
          },
        ],
        blockedStrategyKeys: [],
      },
      strategy,
    );

    const prompt = llm.prompts[0];
    expect(prompt).toContain("## 이번 수정 전략");
    expect(prompt).toContain("compress_and_reallocate");
    expect(prompt).toContain(strategy.summary);
    expect(prompt).toContain("## 최근 공개 실험 기록");
    expect(prompt).toContain("targeted_repair");
    expect(prompt).toContain("직전 공개 실패");
  });

  it("가드가 없는 절차의 변이 프롬프트에는 비공개 검증 안내가 없다", async () => {
    const problem = makeProblem({ guardCases: [] });
    const llm = createRecordingLlm(allCasesOf(problem));
    await createGenerator(problem, llm)("챔피언 문서", () => 0, {
      round: 1,
      championScore: 0,
      championViolations: [],
    });
    expect(llm.prompts[0]).not.toContain("공개되지 않는 검증 질문");
  });

  it("간결성을 끈 절차의 변이 프롬프트에는 가점 힌트가 없다", async () => {
    const problem = makeProblem({ useConciseness: false });
    const llm = createRecordingLlm(allCasesOf(problem));
    await createGenerator(problem, llm)("챔피언 문서", () => 0, {
      round: 1,
      championScore: 0,
      championViolations: [],
    });
    expect(llm.prompts[0]).not.toContain("간결성 가점");
  });
});

describe("createStrategyPlanner", () => {
  it("반복 실패로 차단된 전략을 거부하고 형식 재시도에서 다른 전략을 선택한다", async () => {
    const problem = makeProblem();
    const responses = [
      JSON.stringify({ key: "targeted_repair", summary: "같은 전략을 반복" }),
      JSON.stringify({
        key: "restructure_for_retrieval",
        summary: "절차를 작업 순서별 제목과 체크리스트로 재구성한다.",
      }),
    ];
    const prompts: string[] = [];
    const llm: LlmClient = {
      providerId: "mock",
      model: "테스트-모의",
      async complete(prompt) {
        prompts.push(prompt);
        return responses.shift() ?? "";
      },
    };
    const feedback = {
      round: 3,
      championScore: 42,
      championViolations: ["현재 실패"],
      recentPublicExperiments: [
        {
          round: 1,
          strategy: { key: "targeted_repair", summary: "첫 시도" },
          candidateScore: 40,
          scoreDelta: -2,
          adopted: false,
          gateRejected: false,
          violations: ["실패 A"],
        },
        {
          round: 2,
          strategy: { key: "targeted_repair", summary: "두 번째 시도" },
          candidateScore: 41,
          scoreDelta: -1,
          adopted: false,
          gateRejected: false,
          violations: ["실패 B"],
        },
      ],
      blockedStrategyKeys: ["targeted_repair"],
    };

    const result = await createStrategyPlanner(problem, llm)("챔피언 문서", () => 0, feedback);

    expect(result).toEqual({
      key: "restructure_for_retrieval",
      summary: "절차를 작업 순서별 제목과 체크리스트로 재구성한다.",
      // 화면이 key 대신 보여줄 이름표가 함께 실린다
      label: "검색 가능한 구조로 재편",
    });
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("최근 공개 실험 기록");
    expect(prompts[0]).toContain("targeted_repair");
    expect(prompts[0]).toContain("이번에 선택할 수 없는 전략");
    for (const hidden of [...problem.guardCases, ...problem.holdoutCases]) {
      expect(prompts[0]).not.toContain(hidden.question);
      expect(prompts[0]).not.toContain(hidden.expectedAnswer);
    }
  });

  it("전략 파서는 지원하지 않는 키와 차단된 키를 거부한다", () => {
    expect(() => parseStrategy('{"key":"unknown","summary":"설명"}')).toThrow("지원하는 전략");
    expect(() =>
      parseStrategy(
        '{"key":"targeted_repair","summary":"설명"}',
        ["targeted_repair"],
      ),
    ).toThrow("다시 선택할 수 없습니다");
  });
});

describe("생성 출력 토큰 예산", () => {
  it("배치 예산은 벤더 최대치(65,536)로 클램프된다 — 초안 30개 × 멀티홉 회귀", () => {
    // 실측(2026-08-26): batchOutputTokensFor(30×3) = 92,160이 Vertex HTTP 400을 냈다
    expect(batchOutputTokensFor(90)).toBe(65_536);
    expect(batchOutputTokensFor(12)).toBe(12_288);
    expect(batchOutputTokensFor(1)).toBe(8_192);
    expect(maxOutputTokensFor(20_000)).toBe(40_000);
    expect(maxOutputTokensFor(50_000)).toBe(65_536);
  });

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
    // 최대 구성: 30케이스 → 피드백 12 · 가드 12 — 기본 상한(8192)보다 큰 예산이 필요한 지점
    const { problem } = await compile(makeSubmission(MAX_CASES), mockJudge);
    const seen: Array<number | undefined> = [];
    const llm: LlmClient = {
      providerId: "mock",
      model: "테스트-모의",
      async complete(prompt, opts) {
        seen.push(opts?.maxOutputTokens);
        if (prompt.includes("아래 문서만을 근거로")) {
          const listBlock = prompt.split("## 질문 목록")[1] ?? "";
          const ids = [...listBlock.matchAll(/### 질문 \(([^)]+)\)/g)].map((m) => m[1]);
          return JSON.stringify(ids.map((id) => ({ caseId: id, answer: "정답" })));
        }
        const ids = [...prompt.matchAll(/### 케이스 \(([^)]+)\)/g)].map((m) => m[1]);
        return JSON.stringify(ids.map((id) => ({ caseId: id, score: 1, why: "정답" })));
      },
    };

    await createScorer(problem, llm)("문서");
    expect(problem.visibleCases).toHaveLength(12);
    // 피드백 responder+grader, 가드 responder+grader — 각 12케이스 × 1024토큰
    expect(seen).toEqual([12_288, 12_288, 12_288, 12_288]);
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
    // 배치 채점 1회 최악 = responder + 형식 재시도 + grader + 형식 재시도 = 4콜.
    // 라운드마다 공개·가드 배치가 각각 1회이고, 전략 선택은 형식 재시도까지 최대 2콜이다.
    const perScoringWorst = 4;
    const initialWorst = 1 + 2 * perScoringWorst;
    const perRoundWorst = 2 + 1 + 2 * perScoringWorst;
    const worst = initialWorst + loopSpec.maxRounds * perRoundWorst + 2 * perScoringWorst;
    expect(MAX_CALLS_PER_RUN).toBeGreaterThan(worst);
  });
});

describe("수정 프롬프트 — 간결성과 분량 지시의 정합", () => {
  // 간결성을 켜면 점수는 "상한 대비 남는 여유"다. 그런데 원샷용 안내는 상한의 80%를
  // 목표로 삼으라고 지시해, 남은 점수 여지를 프롬프트가 스스로 막고 있었다.
  it("고칠 실패가 남아 있으면 목표 분량을 주지 않는다", () => {
    const block = reviseLimitBlock(8000, 6400, true, false);
    expect(block).not.toContain("목표로 여유 있게");
    expect(block).toContain("6,400자로 20점");
    expect(block).not.toContain("이번 회차 목표");
  });

  // 못 채운 질문이 없으면 짧게 쓰는 것 말고 점수를 올릴 길이 없다.
  // 과감히 줄여도 안전하다 — 답을 놓치면 기각될 뿐 챔피언은 지켜진다.
  it("고칠 것이 없으면 이번 회차 목표 분량을 준다", () => {
    const block = reviseLimitBlock(8000, 6400, true, true);
    expect(block).toContain("이번 회차 목표: 4,480자 이하");
    expect(block).toContain("약 30% 짧게");
    expect(block).toContain("간결성이 44점");
    expect(block).toContain("채택되지 않습니다");
  });

  it("간결성을 끄면 분량 한도만 알린다", () => {
    const block = reviseLimitBlock(8000, 6400, false);
    expect(block).not.toContain("간결성 점수");
    expect(block).toContain("6,400자입니다");
  });

  it("지적할 것이 없을 때 간결성 쪽으로 방향을 준다", () => {
    const problem = makeProblem({ useConciseness: true });
    const prompt = mutatePrompt(problem, "문서 본문", 88, [], 3);
    expect(prompt).toContain("남은 점수 여지는 간결성뿐");
    expect(prompt).toContain("이번 회차 목표");
    expect(prompt).not.toContain("목표로 여유 있게");
  });
});

describe("createStrategyPlanner — 더 올릴 곳이 없을 때", () => {
  // 케이스를 다 맞히면 커버리지가 천장에 닿아 80%가 얼어붙는다.
  // 그 상태에서 내용을 더하는 전략은 문서만 길게 만들어 간결성을 깎는다.
  it("공개 실패가 없으면 내용을 더하는 전략을 후보에서 뺀다", async () => {
    const problem = makeProblem();
    const prompts: string[] = [];
    const llm = {
      providerId: "mock" as const,
      model: "테스트",
      async complete(prompt: string) {
        prompts.push(prompt);
        return JSON.stringify({ key: "tighten", summary: "중복된 결재선 설명을 한 번만 남긴다." });
      },
    };
    const feedback = {
      round: 4,
      championScore: 83.2,
      championViolations: [],
      blockedStrategyKeys: [],
    };

    const result = await createStrategyPlanner(problem, llm)("챔피언 문서", () => 0, feedback);

    expect(result.key).toBe("tighten");
    expect(result.label).toBe("군더더기 덜어내기");
    for (const blocked of [
      "targeted_repair",
      "source_regrounding",
      "restructure_for_retrieval",
      "consistency_pass",
    ]) {
      expect(prompts[0]).toContain(blocked);
    }
    // 남는 선택지는 짧게 만드는 쪽뿐이다
    expect(prompts[0]).toContain("tighten");
  });
});

describe("전략 차단 — 전부 막히지 않는다", () => {
  // 천장 차단(4개)에 엔진의 반복 실패 차단(나머지)이 겹치면 고를 전략이 사라져
  // 실행이 멈춘다. 그때는 천장 차단부터 양보한다.
  it("엔진이 남은 전략까지 막으면 천장 차단을 풀어 선택지를 남긴다", async () => {
    const problem = makeProblem();
    const prompts: string[] = [];
    const llm = {
      providerId: "mock" as const,
      model: "테스트",
      async complete(prompt: string) {
        prompts.push(prompt);
        return JSON.stringify({ key: "targeted_repair", summary: "빠진 절차를 보강한다." });
      },
    };
    const feedback = {
      round: 6,
      championScore: 84.6,
      championViolations: [],
      blockedStrategyKeys: ["tighten", "compress_and_reallocate"],
    };

    const result = await createStrategyPlanner(problem, llm)("챔피언 문서", () => 0, feedback);

    // 전부 막히는 대신 천장 차단이 풀려 보강 전략을 다시 고를 수 있다
    expect(result.key).toBe("targeted_repair");
  });
});

describe("채점 규칙 — 무엇을 재는가", () => {
  // 실측(harnest-0a7770ba): "참조 답에 없는 절차를 추가했다"는 이유로 0.5가 반복됐다.
  // 기준은 "문서만 보고 답할 수 있는가"인데, 맞는 내용이 더 있다고 답할 수 있는 정도가
  // 줄지는 않는다. 축자 일치를 재던 것을 답의 해결력으로 되돌린다.
  it("참조 답에 없는 내용을 더했다는 이유만으로는 깎지 않는다고 명시한다", () => {
    const prompt = gradersPrompt([
      { caseId: "case-1", question: "질문", expected: "참조 답", response: "응답" },
    ]);
    expect(prompt).toContain("참조 답에 없는 내용이 더 있다는 것만으로는");
    expect(prompt).toContain("답을 틀리게 만들거나 질문과 무관할 때만");
    expect(prompt).toContain("표현이 참조 답과 다른 것도 감점 사유가 아닙니다");
  });

  it("단건 채점에도 같은 규칙을 쓴다", () => {
    const prompt = graderPrompt("질문", "참조 답", "응답");
    expect(prompt).toContain("참조 답에 없는 내용이 더 있다는 것만으로는");
  });

  it("사실과 다른 내용을 덧붙이면 여전히 부분 정답이다", () => {
    const prompt = graderPrompt("질문", "참조 답", "응답");
    expect(prompt).toContain("사실과 다른 내용을 덧붙임");
  });
});
