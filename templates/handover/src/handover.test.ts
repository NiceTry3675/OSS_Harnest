/** 인수인계 템플릿 테스트 — compile 규칙과 실행 계층 불변식(SPEC §3 원칙 7).
 *  모의 LlmClient는 이 파일 안에서 문자열 규칙으로 직접 구현한다:
 *  템플릿 패키지는 웹(apps/web)에 의존하지 않는다 — import 금지. */

import { describe, expect, it } from "vitest";
import type { CaseDef, InterviewSubmission } from "@harnest/contracts";
import { compile, MAX_CASES, MIN_CASES, TEMPLATE_ID, type CompileOptions } from "./index";
import { createGenerator, createScorer, scoreHoldout, type LlmClient } from "./runtime";

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
 *  responder: 프롬프트 속 문서에 해당 케이스의 정답이 있으면 그 정답, 없으면 "문서에 없음".
 *  grader: 응답이 "문서에 없음"이면 0, 참조 답을 그대로 담으면 1, 그 외 0.5. */
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
      // responder — 문서·질문만 담긴 프롬프트
      if (prompt.includes("아래 문서만을 근거로")) {
        const doc = prompt.split("## 문서")[1]?.split("## 질문")[0] ?? "";
        const q = prompt.split("## 질문")[1] ?? "";
        const found = allCases.find((c) => q.includes(c.question));
        return found && doc.includes(found.expectedAnswer) ? found.expectedAnswer : "문서에 없음";
      }
      // grader — 참조 답 대조
      if (prompt.includes("JSON만 출력")) {
        const expected = (prompt.split("## 참조 답 (기록된 실제 답)")[1] ?? "")
          .split("## 채점할 응답")[0]
          .trim();
        const response = (prompt.split("## 채점할 응답")[1] ?? "").split("엄격하게:")[0].trim();
        const score = response.includes("문서에 없음") ? 0 : response.includes(expected) ? 1 : 0.5;
        return `{"score": ${score}, "why": "문자열 규칙 채점"}`;
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

  it("케이스 10개는 비용 상한으로 거부한다 (최대 9개)", async () => {
    await expect(compile(makeSubmission(MAX_CASES + 1), mockJudge)).rejects.toThrow("최대");
  });

  it("분량 범위(500~8000자) 밖은 거부한다", async () => {
    await expect(compile(makeSubmission(6, 499), mockJudge)).rejects.toThrow("500~8000");
    await expect(compile(makeSubmission(6, 8001), mockJudge)).rejects.toThrow("500~8000");
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

    // responder는 가시 케이스 수만큼만 호출된다 (케이스당 responder+grader 2콜)
    const responderPrompts = llm.prompts.filter((p) => p.includes("아래 문서만을 근거로"));
    expect(responderPrompts).toHaveLength(problem.visibleCases.length);
    expect(llm.prompts).toHaveLength(problem.visibleCases.length * 2);

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

describe("scoreHoldout", () => {
  it("홀드아웃 케이스만 채점한다 — 가시 질문은 responder 프롬프트에 등장하지 않는다", async () => {
    const { problem } = await compile(makeSubmission(6), mockJudge);
    const llm = createRecordingLlm([...problem.visibleCases, ...problem.holdoutCases]);

    // 홀드아웃 케이스 1(case-5)의 정답만 담긴 문서 → 2개 중 1개 정답 = 50점
    const doc = "요약 문서. " + problem.holdoutCases[0].expectedAnswer;
    const result = await scoreHoldout(problem, doc, llm);

    expect(result.score).toBe(50);
    expect(result.perCase.map((g) => g.caseId)).toEqual(["case-5", "case-6"]);
    expect(result.perCase.map((g) => g.score)).toEqual([1, 0]);

    const responderPrompts = llm.prompts.filter((p) => p.includes("아래 문서만을 근거로"));
    expect(responderPrompts).toHaveLength(problem.holdoutCases.length);
    // 가시 케이스의 질문은 어떤 responder 프롬프트에도 등장하지 않는다
    for (const v of problem.visibleCases) {
      for (const p of responderPrompts) expect(p).not.toContain(v.question);
    }
    // 홀드아웃 질문은 각각 등장한다
    for (const h of problem.holdoutCases) {
      expect(responderPrompts.some((p) => p.includes(h.question))).toBe(true);
    }
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
