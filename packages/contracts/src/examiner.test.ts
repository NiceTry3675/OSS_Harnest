/** 시험관 검증·캘리브레이션 계약 테스트 — 승인 차단 규칙(fail 차단, 2026-08-23 결정)과
 *  forDigest 결속(수정→재검증 왕복), 캘리브레이션 판정 규칙이 대상이다. */

import { describe, expect, it } from "vitest";
import {
  approvalBlockers,
  calibrationVerdict,
  judgeCalibration,
  worstVerdict,
  type CalibrationPairResult,
  type CalibrationPairSpec,
  type CalibrationResult,
  type EvaluationPack,
  type ExaminerReport,
} from "./index";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

function makePack(
  kind: "det" | "ca",
  digest: string = DIGEST_A,
  judge: { provider: "gemini" | "mock"; model: string } = {
    provider: "gemini",
    model: "gemini-3.7-flash",
  },
): EvaluationPack {
  return {
    packVersion: "skeleton-1",
    templateId: "테스트",
    criteria: [],
    gates: [],
    judgeProcedure:
      kind === "det"
        ? {
            kind: "deterministic_only",
            exemptions: { examinerReport: "-", calibration: "-", pairwise: "-" },
          }
        : { kind: "case_answering", judge, pairwiseNotice: "-" },
    holdoutPolicy: { mode: "none", note: "-" },
    definitionDigest: digest,
  };
}

function makeReport(overrides: Partial<ExaminerReport> = {}): ExaminerReport {
  return {
    checks: [],
    overall: "pass",
    forDigest: DIGEST_A,
    judge: { provider: "gemini", model: "gemini-3.7-flash" },
    ranAt: "2026-08-23T00:00:00.000Z",
    ...overrides,
  };
}

function makeCalibration(overrides: Partial<CalibrationResult> = {}): CalibrationResult {
  return {
    pairs: [],
    verdict: "pass",
    forDigest: DIGEST_A,
    // 기본값은 makeReport().ranAt과 일치 — 리포트 인스턴스 결속 검사를 통과하는 상태
    forReportAt: "2026-08-23T00:00:00.000Z",
    ranAt: "2026-08-23T00:00:00.000Z",
    ...overrides,
  };
}

function pair(kind: CalibrationPairResult["kind"], agreed: boolean): CalibrationPairResult {
  return { id: `${kind}-${agreed}`, kind, userChoice: "A", examinerChoice: agreed ? "A" : "B", agreed };
}

describe("worstVerdict", () => {
  it("빈 목록은 pass, 최악 판정이 전체를 지배한다", () => {
    expect(worstVerdict([])).toBe("pass");
    expect(worstVerdict(["pass", "warn"])).toBe("warn");
    expect(worstVerdict(["warn", "fail", "pass"])).toBe("fail");
  });
});

describe("calibrationVerdict", () => {
  it("전부 일치 → pass, 품질 쌍 소수 불일치 → warn", () => {
    expect(calibrationVerdict([pair("hack_probe", true), pair("quality", true)])).toBe("pass");
    expect(
      calibrationVerdict([pair("hack_probe", true), pair("quality", false), pair("quality", true)]),
    ).toBe("warn");
    // 2쌍 중 품질 1 불일치 — 과반이 아니므로 warn
    expect(calibrationVerdict([pair("hack_probe", true), pair("quality", false)])).toBe("warn");
  });

  it("꼼수 쌍 불일치는 즉시 fail — 기준이 사용자 가치와 어긋난 것", () => {
    expect(
      calibrationVerdict([pair("hack_probe", false), pair("quality", true), pair("quality", true)]),
    ).toBe("fail");
  });

  it("불일치 과반 → fail, 빈 쌍 목록 → fail", () => {
    expect(
      calibrationVerdict([pair("hack_probe", true), pair("quality", false), pair("quality", false)]),
    ).toBe("fail");
    expect(calibrationVerdict([])).toBe("fail");
  });

  it("꼼수 쌍이 하나도 없으면 전부 일치여도 fail — SPEC §3 원칙 2의 정의 요건을 계약이 강제", () => {
    expect(calibrationVerdict([pair("quality", true), pair("quality", true)])).toBe("fail");
  });
});

describe("judgeCalibration", () => {
  const specs: CalibrationPairSpec[] = [
    { id: "hack", kind: "hack_probe", a: "좋은 문서", b: "부풀린 문서", examinerChoice: "A", basis: "-" },
    { id: "q1", kind: "quality", a: "훼손본", b: "좋은 문서", examinerChoice: "B", basis: "-" },
  ];

  it("선택을 쌍 결과로 조립하고 forDigest·forReportAt(리포트 인스턴스)을 결속한다", () => {
    const result = judgeCalibration(specs, ["A", "A"], makePack("ca"), makeReport());
    expect(result.pairs.map((p) => p.agreed)).toEqual([true, false]);
    expect(result.verdict).toBe("warn");
    expect(result.forDigest).toBe(DIGEST_A);
    expect(result.forReportAt).toBe(makeReport().ranAt);
  });

  it("모든 쌍이 판정되지 않으면 거부한다", () => {
    expect(() => judgeCalibration(specs, ["A"], makePack("ca"), makeReport())).toThrow("모든 쌍");
  });
});

describe("approvalBlockers", () => {
  it("결정적 전용 루프는 면제 — 리포트·캘리브레이션 없이도 차단 없음(§10 특례 ①)", () => {
    expect(approvalBlockers(makePack("det"), null, null)).toEqual([]);
  });

  it("llm_judge 루프는 리포트·캘리브레이션이 없으면 각각 차단된다", () => {
    const blockers = approvalBlockers(makePack("ca"), null, null);
    expect(blockers).toHaveLength(2);
    expect(blockers[0]).toContain("검증");
    expect(blockers[1]).toContain("캘리브레이션");
  });

  it("기준 수정(다이제스트 변경)은 리포트·캘리브레이션을 기계적으로 무효화한다", () => {
    const newPack = makePack("ca", DIGEST_B);
    const blockers = approvalBlockers(newPack, makeReport(), makeCalibration());
    expect(blockers.some((b) => b.includes("검증 리포트가 무효화"))).toBe(true);
    expect(blockers.some((b) => b.includes("캘리브레이션이 무효화"))).toBe(true);
  });

  it("배터리를 구동한 저지가 동결 선언과 다르면 차단된다 (모의는 provider만 대조)", () => {
    const geminiPack = makePack("ca");
    expect(
      approvalBlockers(
        geminiPack,
        makeReport({ judge: { provider: "mock", model: "모의" } }),
        makeCalibration(),
      ).some((b) => b.includes("채점 모델")),
    ).toBe(true);
    expect(
      approvalBlockers(
        geminiPack,
        makeReport({ judge: { provider: "gemini", model: "다른-모델" } }),
        makeCalibration(),
      ).some((b) => b.includes("채점 모델")),
    ).toBe(true);
    // 모의 저지는 모델명 표기가 유동적 — provider 일치면 통과(등록소 실행 가드와 동일 규칙)
    const mockPack = makePack("ca", DIGEST_A, { provider: "mock", model: "모의 모델" });
    expect(
      approvalBlockers(
        mockPack,
        makeReport({ judge: { provider: "mock", model: "모의 모델 (결정적)" } }),
        makeCalibration(),
      ),
    ).toEqual([]);
  });

  it("검증 fail은 승인을 차단하고, warn은 승인을 허용한다", () => {
    const pack = makePack("ca");
    expect(
      approvalBlockers(pack, makeReport({ overall: "fail" }), makeCalibration()).some((b) =>
        b.includes("실패"),
      ),
    ).toBe(true);
    expect(
      approvalBlockers(
        pack,
        makeReport({ overall: "warn" }),
        makeCalibration({ verdict: "warn" }),
      ),
    ).toEqual([]);
  });

  it("검증을 다시 실행하면(리포트 ranAt 변경) 이전 캘리브레이션은 승인 차단 사유가 된다", () => {
    const blockers = approvalBlockers(
      makePack("ca"),
      makeReport({ ranAt: "2026-08-23T09:00:00.000Z" }),
      makeCalibration(), // forReportAt은 이전 리포트의 것
    );
    expect(blockers.some((b) => b.includes("검증이 다시 실행"))).toBe(true);
  });

  it("캘리브레이션 fail은 승인을 차단한다", () => {
    expect(
      approvalBlockers(makePack("ca"), makeReport(), makeCalibration({ verdict: "fail" })).some(
        (b) => b.includes("캘리브레이션 실패"),
      ),
    ).toBe(true);
  });

  it("유효한 pass 리포트 + pass 캘리브레이션이면 차단 없음", () => {
    expect(approvalBlockers(makePack("ca"), makeReport(), makeCalibration())).toEqual([]);
  });
});
