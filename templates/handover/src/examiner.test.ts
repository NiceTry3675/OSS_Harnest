/** 시험관 배터리 테스트 — 검사 2종(안정성·꼼수 내성)의 판정 규칙, 홀드아웃 불변식,
 *  케이스 서브샘플, 호출 수가 대상이다.
 *  모의 LlmClient는 파일 안 문자열 규칙으로 구현한다(웹 의존 금지 — handover.test.ts와 동일 원칙). */

import { describe, expect, it } from "vitest";
import type { CaseDef, ExaminerCheckResult, InterviewSubmission } from "@harnest/contracts";
import { approvalBlockers } from "@harnest/contracts";
import { compile, TEMPLATE_ID } from "./index";
import { BATTERY_CASE_CAP, runExaminerBattery } from "./examiner";
import type { LlmClient } from "./runtime";

/** 답 130자 내외를 만들기 위한 패딩 — 기록 전체가 상한 500자를 확실히 넘는 시나리오용 */
const LONG_PAD =
  " 상세 절차는 위키의 운영 문서에 정리되어 있고 담당자 승인 뒤 진행해야 하며 금요일 배포는 금지입니다.".repeat(2);

function makeSubmission(
  caseCount: number,
  lengthCap: number,
  answerPad = "",
): InterviewSubmission {
  return {
    schemaVersion: "skeleton-1",
    templateId: TEMPLATE_ID,
    answers: {
      material: "사내 배포 파이프라인을 관리하는 업무입니다.",
      cases: Array.from({ length: caseCount }, (_, i) => ({
        question: `질문 ${i + 1}: 항목${i + 1}은 어떻게 처리하나요?`,
        expectedAnswer: `정답 ${i + 1}: 절차${i + 1}을 따르면 됩니다.${answerPad}`,
      })),
      lengthCap,
    },
  };
}

interface BatteryLlm extends LlmClient {
  prompts: string[];
}

/** 문자열 규칙 모의 LLM — responder 배치는 문서 포함 여부, grader는 참조 답 포함 여부로 채점.
 *  strictGrader: 무관 응답 0점(실제 루브릭에 가까움). 기본은 0.5(부분 점수 관대 모형).
 *  graderOverride의 call은 채점 호출 순번 — 배치 grader와 단건 grader(오염 프로브)가 카운터를
 *  공유한다: 배치 0(1차)·1(재채점), 단건 2(날조)·3(아첨). */
function createBatteryLlm(opts: {
  cases: CaseDef[];
  oneshotDoc: string;
  strictGrader?: boolean;
  graderOverride?: (call: number, defaultScore: number) => number;
}): BatteryLlm {
  const prompts: string[] = [];
  let graderCalls = 0;
  return {
    providerId: "mock",
    model: "테스트-모의",
    prompts,
    async complete(prompt) {
      prompts.push(prompt);
      // responder 배치
      if (prompt.includes("아래 문서만을 근거로")) {
        const doc = prompt.split("## 문서")[1]?.split("## 질문 목록")[0] ?? "";
        const listBlock = prompt.split("## 질문 목록")[1] ?? "";
        const ids = [...listBlock.matchAll(/### 질문 \(([^)]+)\)/g)].map((m) => m[1]);
        return JSON.stringify(
          ids.map((id) => {
            const found = opts.cases.find((c) => c.id === id);
            if (!found) return { caseId: id, answer: "문서에 없음" };
            const has = doc.includes(found.expectedAnswer);
            return { caseId: id, answer: has ? found.expectedAnswer : "문서에 없음" };
          }),
        );
      }
      // grader 배치
      if (prompt.includes("## 채점 목록")) {
        const call = graderCalls;
        graderCalls += 1;
        return JSON.stringify(
          prompt.split("### 케이스 (").slice(1).map((chunk) => {
            const caseId = chunk.split(")")[0];
            const expected =
              chunk.split("\n참조 답 (기록된 실제 답): ")[1]?.split("\n채점할 응답: ")[0] ?? "";
            const response = (chunk.split("\n채점할 응답: ")[1] ?? "")
              .split("\n\n엄격하게")[0]
              .trim();
            let score = response.includes("문서에 없음")
              ? 0
              : response.includes(expected)
                ? 1
                : opts.strictGrader
                  ? 0
                  : 0.5;
            if (opts.graderOverride) score = opts.graderOverride(call, score);
            return { caseId, score, why: "규칙 채점" };
          }),
        );
      }
      // grader 단건 — 오염 응답 프로브
      if (prompt.includes("JSON만 출력")) {
        const expected = (prompt.split("## 참조 답 (기록된 실제 답)")[1] ?? "")
          .split("## 채점할 응답")[0]
          .trim();
        const response = (prompt.split("## 채점할 응답")[1] ?? "").split("엄격하게:")[0].trim();
        let score = response.includes("문서에 없음")
          ? 0
          : response.includes(expected)
            ? 1
            : opts.strictGrader
              ? 0
              : 0.5;
        if (opts.graderOverride) score = opts.graderOverride(graderCalls, score);
        graderCalls += 1;
        return `{"score": ${score}, "why": "규칙 채점"}`;
      }
      if (prompt.includes("## 실패 목록")) return "변이된 문서";
      return opts.oneshotDoc;
    },
  };
}

/** 기준 시나리오 — 긴 답(기록 전체가 상한 초과) + 엄격 grader: 전 검사 pass가 나오는 구성 */
async function compileScenario() {
  const compiled = await compile(makeSubmission(6, 500, LONG_PAD), {
    judgeProvider: "mock",
    judgeModel: "테스트-모의",
  });
  const { problem } = compiled;
  // 검증용 문서 = 가시 1~3 정답 원문 — 배터리 4케이스 중 3개 커버(75점)
  const oneshotDoc = problem.visibleCases
    .slice(0, 3)
    .map((c) => c.expectedAnswer)
    .join("\n");
  return { compiled, oneshotDoc };
}

describe("runExaminerBattery — 판정 규칙", () => {
  it("onCheck는 검사 완료 순서대로 최종 리포트와 같은 결과를 내보내며 판정을 바꾸지 않는다", async () => {
    const { compiled, oneshotDoc } = await compileScenario();
    const { problem, pack } = compiled;
    const emitted: ExaminerCheckResult[] = [];
    const withCallback = await runExaminerBattery(
      problem,
      pack,
      createBatteryLlm({
        cases: [...problem.visibleCases, ...problem.holdoutCases],
        oneshotDoc,
        strictGrader: true,
      }),
      undefined,
      (result) => emitted.push(result),
    );

    expect(emitted.map((result) => result.id)).toEqual(["stability", "hack_resistance"]);
    expect(emitted).toHaveLength(withCallback.checks.length);
    emitted.forEach((result, index) => {
      expect(result).toBe(withCallback.checks[index]);
    });

    const withoutCallback = await runExaminerBattery(
      problem,
      pack,
      createBatteryLlm({
        cases: [...problem.visibleCases, ...problem.holdoutCases],
        oneshotDoc,
        strictGrader: true,
      }),
    );
    expect(withCallback.overall).toBe(withoutCallback.overall);
    expect(withCallback.checks).toEqual(withoutCallback.checks);
  });

  it("재채점이 안정되고 프로브가 방어되면 전 검사 pass, forDigest·저지가 결속된다", async () => {
    const { compiled, oneshotDoc } = await compileScenario();
    const { problem, pack } = compiled;
    const llm = createBatteryLlm({
      cases: [...problem.visibleCases, ...problem.holdoutCases],
      oneshotDoc,
      strictGrader: true,
    });

    const report = await runExaminerBattery(problem, pack, llm);
    expect(report.checks.map((c) => c.id)).toEqual(["stability", "hack_resistance"]);
    expect(report.checks.map((c) => c.verdict)).toEqual(["pass", "pass"]);
    expect(report.overall).toBe("pass");
    expect(report.forDigest).toBe(pack.definitionDigest);
    expect(report.judge).toEqual({ provider: "mock", model: "테스트-모의" });
  });

  it("재채점이 크게 흔들리면 안정성 fail", async () => {
    const { compiled, oneshotDoc } = await compileScenario();
    const { problem, pack } = compiled;
    // 채점 호출 순서: 1차(0)·재채점(1) — 재채점만 0점으로 무너뜨린다
    const llm = createBatteryLlm({
      cases: [...problem.visibleCases, ...problem.holdoutCases],
      oneshotDoc,
      strictGrader: true,
      graderOverride: (call, def) => (call === 1 ? 0 : def),
    });

    const report = await runExaminerBattery(problem, pack, llm);
    expect(report.checks.find((c) => c.id === "stability")?.verdict).toBe("fail");
    expect(report.overall).toBe("fail");
  });

  it("관대한 grader가 오염 응답에 부분 점수를 주면 꼼수 내성 warn", async () => {
    const { compiled, oneshotDoc } = await compileScenario();
    const { problem, pack } = compiled;
    // strictGrader 없음 — 무관 응답(날조·아첨)이 0.5점을 받는 관대 모형
    const llm = createBatteryLlm({
      cases: [...problem.visibleCases, ...problem.holdoutCases],
      oneshotDoc,
    });

    const report = await runExaminerBattery(problem, pack, llm);
    const hack = report.checks.find((c) => c.id === "hack_resistance");
    expect(hack?.verdict).toBe("warn");
    expect(hack?.note).toContain("부분 점수");
  });

  it("grader가 오염 응답(날조·아첨)을 정답 처리하면 꼼수 내성 fail", async () => {
    const { compiled, oneshotDoc } = await compileScenario();
    const { problem, pack } = compiled;
    // 채점 호출 2·3 = 날조·아첨 프로브(단건) — 정답(1점) 처리로 조작
    const llm = createBatteryLlm({
      cases: [...problem.visibleCases, ...problem.holdoutCases],
      oneshotDoc,
      strictGrader: true,
      graderOverride: (call, def) => (call >= 2 ? 1 : def),
    });

    const report = await runExaminerBattery(problem, pack, llm);
    const hack = report.checks.find((c) => c.id === "hack_resistance");
    expect(hack?.verdict).toBe("fail");
    expect(hack?.note).toContain("날조 응답이 정답 처리");
    expect(hack?.note).toContain("아첨 응답이 정답 처리");
    expect(report.overall).toBe("fail");
  });
});

describe("runExaminerBattery — 경계", () => {
  it("생성 문서가 상한을 넘으면 90%로 절단해 채점한다 (게이트 실격 문서로는 검증 불가)", async () => {
    const compiled = await compile(makeSubmission(6, 500, LONG_PAD), {
      judgeProvider: "mock",
      judgeModel: "테스트-모의",
    });
    const { problem, pack } = compiled;
    const truncated = "가".repeat(Math.floor(problem.lengthCap * 0.9));
    const llm = createBatteryLlm({
      cases: [...problem.visibleCases, ...problem.holdoutCases],
      oneshotDoc: "가".repeat(problem.lengthCap + 500),
      strictGrader: true,
    });

    const report = await runExaminerBattery(problem, pack, llm);
    // 채점(responder) 프롬프트에 실린 문서는 절단본이다 — 원본 길이 문서는 등장하지 않는다
    const responderPrompts = llm.prompts.filter((p) => p.includes("아래 문서만을 근거로"));
    expect(responderPrompts.length).toBeGreaterThan(0);
    expect(responderPrompts.every((p) => p.includes(truncated))).toBe(true);
    expect(llm.prompts.every((p) => !p.includes("가".repeat(problem.lengthCap + 500)))).toBe(true);
    // 절단본은 정답을 하나도 담지 못하지만, 0점 재현은 안정적이므로 배터리는 통과한다
    expect(report.checks.find((c) => c.id === "stability")?.verdict).toBe("pass");
  });
});

describe("runExaminerBattery — 불변식·비용", () => {
  it("홀드아웃 질문·정답은 배터리의 어떤 프롬프트에도 등장하지 않고, 채점은 케이스 상한까지만 쓴다", async () => {
    // 9케이스 → 가시 6 / 홀드아웃 3, 배터리 채점은 가시 앞 4개만
    const compiled = await compile(makeSubmission(9, 500, LONG_PAD), {
      judgeProvider: "mock",
      judgeModel: "테스트-모의",
    });
    const { problem, pack } = compiled;
    expect(problem.visibleCases.length).toBeGreaterThan(BATTERY_CASE_CAP);
    const oneshotDoc = problem.visibleCases
      .slice(0, 3)
      .map((c) => c.expectedAnswer)
      .join("\n");
    const llm = createBatteryLlm({
      cases: [...problem.visibleCases, ...problem.holdoutCases],
      oneshotDoc,
      strictGrader: true,
    });

    await runExaminerBattery(problem, pack, llm);

    for (const h of problem.holdoutCases) {
      for (const p of llm.prompts) {
        expect(p).not.toContain(h.question);
        expect(p).not.toContain(h.expectedAnswer);
      }
    }
    // 채점(responder) 프롬프트에는 배터리 상한 밖 가시 케이스가 등장하지 않는다
    const responderPrompts = llm.prompts.filter((p) => p.includes("아래 문서만을 근거로"));
    for (const v of problem.visibleCases.slice(BATTERY_CASE_CAP)) {
      for (const p of responderPrompts) expect(p).not.toContain(v.question);
    }
  });

  it("배터리 호출 수가 닫힌 식과 일치한다 — 생성 1 + 채점 2회 × 2콜 + 오염 프로브 단건 2", async () => {
    const { compiled, oneshotDoc } = await compileScenario();
    const { problem, pack } = compiled;
    const llm = createBatteryLlm({
      cases: [...problem.visibleCases, ...problem.holdoutCases],
      oneshotDoc,
      strictGrader: true,
    });

    await runExaminerBattery(problem, pack, llm);
    expect(llm.prompts).toHaveLength(1 + 2 * 2 + 2);
  });
});

describe("수정→재검증 왕복", () => {
  it("분량 상한만 바꿔도 다이제스트가 갈리고, 이전 리포트는 승인 차단 사유가 된다", async () => {
    const { compiled, oneshotDoc } = await compileScenario();
    const llm = createBatteryLlm({
      cases: [...compiled.problem.visibleCases, ...compiled.problem.holdoutCases],
      oneshotDoc,
      strictGrader: true,
    });
    const report = await runExaminerBattery(compiled.problem, compiled.pack, llm);
    expect(approvalBlockers(compiled.pack, report)).toEqual([]);

    const revised = await compile(makeSubmission(6, 600, LONG_PAD), {
      judgeProvider: "mock",
      judgeModel: "테스트-모의",
    });
    expect(revised.pack.definitionDigest).not.toBe(compiled.pack.definitionDigest);
    const blockers = approvalBlockers(revised.pack, report);
    expect(blockers.some((b) => b.includes("무효화"))).toBe(true);
  });
});
