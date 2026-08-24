/** 시험관 배터리·캘리브레이션 쌍 테스트 — 검사 4종의 판정 규칙, 홀드아웃 불변식,
 *  케이스 서브샘플, 프로브의 비용 특성(게이트 실격 = 모델 호출 0)이 대상이다.
 *  모의 LlmClient는 파일 안 문자열 규칙으로 구현한다(웹 의존 금지 — handover.test.ts와 동일 원칙). */

import { describe, expect, it } from "vitest";
import type { CaseDef, InterviewSubmission } from "@harnest/contracts";
import { approvalBlockers } from "@harnest/contracts";
import { compile, TEMPLATE_ID } from "./index";
import {
  BATTERY_CASE_CAP,
  buildCalibrationPairs,
  runExaminerBattery,
  type ExaminerRun,
} from "./examiner";
import type { LlmClient } from "./runtime";

/** 답 130자 내외를 만들기 위한 패딩 — 가시 4케이스의 통째 베끼기(4×150자 내외)가
 *  상한 500자를 확실히 넘는 시나리오용 */
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

/** 문자열 규칙 모의 LLM — responder는 문서 포함 여부, grader는 참조 답 포함 여부로 채점.
 *  strictGrader: 무관 응답 0점(실제 루브릭에 가까움). 기본은 0.5(부분 점수 관대 모형). */
function createBatteryLlm(opts: {
  cases: CaseDef[];
  oneshotDoc: string;
  invertResponder?: boolean;
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
      if (prompt.includes("아래 문서만을 근거로")) {
        const doc = prompt.split("## 문서")[1]?.split("## 질문")[0] ?? "";
        const q = prompt.split("## 질문")[1] ?? "";
        const found = opts.cases.find((c) => q.includes(c.question));
        if (!found) return "문서에 없음";
        const has = doc.includes(found.expectedAnswer);
        return (opts.invertResponder ? !has : has) ? found.expectedAnswer : "문서에 없음";
      }
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

/** 시나리오 B — 긴 답(베끼기 프로브가 상한 초과) + 엄격 grader: 전 검사 pass가 나오는 구성 */
async function compileScenarioB() {
  const compiled = await compile(makeSubmission(6, 500, LONG_PAD), {
    judgeProvider: "mock",
    judgeModel: "테스트-모의",
  });
  const { problem } = compiled;
  // 좋은 문서 = 가시 1~3 정답 원문 — 배터리 4케이스 중 3개 커버(75점),
  // 40% 절단본은 1번 정답만 온전히 남는다(25점)
  const oneshotDoc = problem.visibleCases
    .slice(0, 3)
    .map((c) => c.expectedAnswer)
    .join("\n");
  return { compiled, oneshotDoc };
}

describe("runExaminerBattery — 판정 규칙", () => {
  it("품질 사다리가 유지되고 프로브가 방어되면 전 검사 pass, forDigest·저지가 결속된다", async () => {
    const { compiled, oneshotDoc } = await compileScenarioB();
    const { problem, pack } = compiled;
    const llm = createBatteryLlm({
      cases: [...problem.visibleCases, ...problem.holdoutCases],
      oneshotDoc,
      strictGrader: true,
    });

    const run = await runExaminerBattery(problem, pack, llm);
    expect(run.report.checks.map((c) => c.id)).toEqual([
      "ordering",
      "discrimination",
      "stability",
      "hack_resistance",
    ]);
    expect(run.report.checks.map((c) => c.verdict)).toEqual(["pass", "pass", "pass", "pass"]);
    expect(run.report.overall).toBe("pass");
    expect(run.report.forDigest).toBe(pack.definitionDigest);
    expect(run.report.judge).toEqual({ provider: "mock", model: "테스트-모의" });
    expect(run.artifacts.scores).toEqual({ good: 75, degraded: 25, empty: 0 });
  });

  it("사다리 역전(좋은 문서 < 빈 문서)은 순서·변별력 fail → overall fail", async () => {
    const { compiled, oneshotDoc } = await compileScenarioB();
    const { problem, pack } = compiled;
    const llm = createBatteryLlm({
      cases: [...problem.visibleCases, ...problem.holdoutCases],
      oneshotDoc,
      strictGrader: true,
      invertResponder: true,
    });

    const run = await runExaminerBattery(problem, pack, llm);
    const byId = Object.fromEntries(run.report.checks.map((c) => [c.id, c.verdict]));
    expect(byId["ordering"]).toBe("fail");
    expect(byId["discrimination"]).toBe("fail");
    expect(run.report.overall).toBe("fail");
  });

  it("재채점이 크게 흔들리면 안정성 fail", async () => {
    const { compiled, oneshotDoc } = await compileScenarioB();
    const { problem, pack } = compiled;
    // grader 호출 순서: 좋음(0~3)·훼손(4~7)·빈(8~11)·재채점(12~15) — 재채점만 0점으로 무너뜨린다
    const llm = createBatteryLlm({
      cases: [...problem.visibleCases, ...problem.holdoutCases],
      oneshotDoc,
      strictGrader: true,
      graderOverride: (call, def) => (call >= 12 && call <= 15 ? 0 : def),
    });

    const run = await runExaminerBattery(problem, pack, llm);
    expect(run.report.checks.find((c) => c.id === "stability")?.verdict).toBe("fail");
  });

  it("기록 전체가 상한 안이면(게이트 밴드 밖) 베끼기 프로브는 주의 + 상한 안내, 관대한 grader의 부분 점수도 주의", async () => {
    // 짧은 답 + 넉넉한 상한: 통째 베끼기가 분량 게이트에 걸리지 않는 입력
    const compiled = await compile(makeSubmission(6, 2000), {
      judgeProvider: "mock",
      judgeModel: "테스트-모의",
    });
    const { problem, pack } = compiled;
    const oneshotDoc = problem.visibleCases
      .slice(0, 3)
      .map((c) => c.expectedAnswer)
      .join("\n");
    const llm = createBatteryLlm({
      cases: [...problem.visibleCases, ...problem.holdoutCases],
      oneshotDoc,
    });

    const run = await runExaminerBattery(problem, pack, llm);
    const hack = run.report.checks.find((c) => c.id === "hack_resistance");
    expect(hack?.verdict).toBe("warn");
    expect(hack?.note).toContain("분량 상한 안");
    expect(hack?.note).toContain("부분 점수");
  });
});

describe("runExaminerBattery — 경계", () => {
  it("생성 문서가 상한을 넘으면 90%로 절단해 사다리를 만든다 (게이트 실격 문서로는 검증 불가)", async () => {
    const compiled = await compile(makeSubmission(6, 500, LONG_PAD), {
      judgeProvider: "mock",
      judgeModel: "테스트-모의",
    });
    const { problem, pack } = compiled;
    const llm = createBatteryLlm({
      cases: [...problem.visibleCases, ...problem.holdoutCases],
      oneshotDoc: "가".repeat(problem.lengthCap + 500),
      strictGrader: true,
    });

    const run = await runExaminerBattery(problem, pack, llm);
    expect(run.artifacts.goodDoc).toHaveLength(Math.floor(problem.lengthCap * 0.9));
    // 절단본은 정답을 하나도 담지 못한다 — 사다리가 무너져 배터리가 정직하게 fail을 낸다
    expect(run.report.overall).toBe("fail");
  });

  it("grader가 오염 응답(날조·아첨)을 정답 처리하면 꼼수 내성 fail", async () => {
    const { compiled, oneshotDoc } = await compileScenarioB();
    const { problem, pack } = compiled;
    // grader 호출 16·17 = 날조·아첨 프로브 — 정답(1점) 처리로 조작
    const llm = createBatteryLlm({
      cases: [...problem.visibleCases, ...problem.holdoutCases],
      oneshotDoc,
      strictGrader: true,
      graderOverride: (call, def) => (call >= 16 ? 1 : def),
    });

    const run = await runExaminerBattery(problem, pack, llm);
    const hack = run.report.checks.find((c) => c.id === "hack_resistance");
    expect(hack?.verdict).toBe("fail");
    expect(hack?.note).toContain("날조 응답이 정답 처리");
    expect(hack?.note).toContain("아첨 응답이 정답 처리");
    expect(run.report.overall).toBe("fail");
  });
});

describe("probes — 장황함 인플레", () => {
  it("원문이 이미 상한을 넘는 입력에서도 최소 1회는 부풀린다 — 프로브 문면이 거짓이 되지 않게", async () => {
    const { compiled } = await compileScenarioB();
    const problem = {
      ...compiled.problem,
      lengthCap: 500,
      // 자료만으로 상한을 넘는 극단 입력
      material: "운영 절차. ".repeat(120),
    };
    const { buildVerbosityProbe } = await import("./probes");
    const base = [problem.material, ...problem.visibleCases.map((c) => `${c.question} ${c.expectedAnswer}`)]
      .join("\n")
      .trim();
    const doc = buildVerbosityProbe(problem);
    expect(base.length).toBeGreaterThan(problem.lengthCap);
    expect(doc.length).toBeGreaterThan(base.length);
    expect(doc).toContain("(중요한 내용이므로 한 번 더 강조합니다)");
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

  it("게이트에 실격되는 프로브(장황함)는 모델 호출을 만들지 않는다 — 호출 수가 닫힌 식과 일치", async () => {
    // 시나리오 A: 베끼기 프로브도 상한 안(주의 분기)이라 채점 호출이 없다
    const compiled = await compile(makeSubmission(6, 2000), {
      judgeProvider: "mock",
      judgeModel: "테스트-모의",
    });
    const { problem, pack } = compiled;
    const oneshotDoc = problem.visibleCases[0].expectedAnswer;
    const llm = createBatteryLlm({
      cases: [...problem.visibleCases, ...problem.holdoutCases],
      oneshotDoc,
    });

    await runExaminerBattery(problem, pack, llm);
    // 생성 1 + 사다리 4회 채점 × (케이스 4 × 2콜) + 오염 응답 grader 2 = 35
    expect(llm.prompts).toHaveLength(1 + 4 * (BATTERY_CASE_CAP * 2) + 2);
    // 부풀린 프로브 문서가 모델에 전달된 적이 없다
    expect(llm.prompts.every((p) => !p.includes("(중요한 내용이므로 한 번 더 강조합니다)"))).toBe(
      true,
    );
  });
});

describe("buildCalibrationPairs", () => {
  it("꼼수 쌍이 항상 먼저 오고, 시험관 선택 위치의 산출물이 실제 점수 우위와 일치한다", async () => {
    const { compiled, oneshotDoc } = await compileScenarioB();
    const { problem, pack } = compiled;
    const llm = createBatteryLlm({
      cases: [...problem.visibleCases, ...problem.holdoutCases],
      oneshotDoc,
      strictGrader: true,
    });
    const run = await runExaminerBattery(problem, pack, llm);

    const pairs = buildCalibrationPairs(run, pack);
    expect(pairs).toHaveLength(3); // 75 / 25 / 0 — 전 구간 점수가 갈린다
    expect(pairs[0].kind).toBe("hack_probe");
    const pick = (p: (typeof pairs)[number]) => (p.examinerChoice === "A" ? p.a : p.b);
    expect(pick(pairs[0])).toBe(run.artifacts.goodDoc);
    expect(pick(pairs[1])).toBe(run.artifacts.goodDoc);
    expect(pick(pairs[2])).toBe(run.artifacts.degradedDoc);

    // 결정적 재현: 같은 실행·같은 팩이면 쌍 구성(위치 포함)이 같다 — 리플레이 가능
    expect(buildCalibrationPairs(run, pack)).toEqual(pairs);
  });

  it("시험관 점수가 같은 품질 쌍은 제외된다 — 무차별 판정은 캘리브레이션 표본이 아니다", async () => {
    const { compiled } = await compileScenarioB();
    const { pack } = compiled;
    expect(
      buildCalibrationPairs(fakeRun(pack.definitionDigest, { good: 50, degraded: 50, empty: 0 }), pack)
        .map((p) => p.id),
    ).toEqual(["hack-verbosity", "quality-empty"]);
    expect(
      buildCalibrationPairs(fakeRun(pack.definitionDigest, { good: 50, degraded: 0, empty: 0 }), pack)
        .map((p) => p.id),
    ).toEqual(["hack-verbosity", "quality-degraded"]);
  });

  it("점수가 역전되면(훼손본 > 좋은 문서) 시험관 선택도 실제 우위를 따른다", async () => {
    const { compiled } = await compileScenarioB();
    const { pack } = compiled;
    const run = fakeRun(pack.definitionDigest, { good: 30, degraded: 60, empty: 0 });
    const pairs = buildCalibrationPairs(run, pack);
    const qd = pairs.find((p) => p.id === "quality-degraded")!;
    expect(qd.examinerChoice === "A" ? qd.a : qd.b).toBe(run.artifacts.degradedDoc);
  });

  it("A/B 위치는 다이제스트 16진 문자의 홀짝으로 실제로 뒤집힌다", async () => {
    const { compiled } = await compileScenarioB();
    const scores = { good: 75, degraded: 25, empty: 0 };
    // 짝수 문자("2") → 뒤집기 없음: 첫 쌍의 A가 좋은 문서, 시험관 선택 A
    const even = buildCalibrationPairs(
      fakeRun("2".repeat(64), scores),
      { ...compiled.pack, definitionDigest: "2".repeat(64) },
    );
    expect(even[0].examinerChoice).toBe("A");
    expect(even[0].a).toBe("좋은 문서");
    // 홀수 문자("3") → 뒤집힘: 첫 쌍의 A가 부풀린 문서, 시험관 선택 B
    const odd = buildCalibrationPairs(
      fakeRun("3".repeat(64), scores),
      { ...compiled.pack, definitionDigest: "3".repeat(64) },
    );
    expect(odd[0].examinerChoice).toBe("B");
    expect(odd[0].a).toBe("부풀린 문서");
    expect(odd[0].b).toBe("좋은 문서");
  });
});

/** 배터리 실행 없이 쌍 구성 규칙만 시험하기 위한 수제 실행 결과 */
function fakeRun(
  digest: string,
  scores: { good: number; degraded: number; empty: number },
): ExaminerRun {
  return {
    report: {
      checks: [],
      overall: "pass",
      forDigest: digest,
      judge: { provider: "mock", model: "테스트-모의" },
      ranAt: "2026-08-23T00:00:00.000Z",
    },
    artifacts: {
      goodDoc: "좋은 문서",
      degradedDoc: "훼손본",
      emptyDoc: "빈 문서",
      verbosityDoc: "부풀린 문서",
      verbatimDoc: "베낀 문서",
      scores,
    },
  };
}

describe("수정→재검증 왕복", () => {
  it("분량 상한만 바꿔도 다이제스트가 갈리고, 이전 리포트는 승인 차단 사유가 된다", async () => {
    const { compiled, oneshotDoc } = await compileScenarioB();
    const llm = createBatteryLlm({
      cases: [...compiled.problem.visibleCases, ...compiled.problem.holdoutCases],
      oneshotDoc,
      strictGrader: true,
    });
    const run = await runExaminerBattery(compiled.problem, compiled.pack, llm);
    expect(approvalBlockers(compiled.pack, run.report, null)).toHaveLength(1); // 캘리브레이션만 남음

    const revised = await compile(makeSubmission(6, 600, LONG_PAD), {
      judgeProvider: "mock",
      judgeModel: "테스트-모의",
    });
    expect(revised.pack.definitionDigest).not.toBe(compiled.pack.definitionDigest);
    const blockers = approvalBlockers(revised.pack, run.report, null);
    expect(blockers.some((b) => b.includes("무효화"))).toBe(true);
  });
});
