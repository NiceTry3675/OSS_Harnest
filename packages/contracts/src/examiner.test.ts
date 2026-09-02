/** 시험관 검증 계약 테스트 — 승인 차단 규칙(fail 차단, 2026-08-23 결정)과
 *  forDigest 결속(수정→재검증 왕복)이 대상이다. */

import { describe, expect, it } from "vitest";
import {
  approvalBlockers,
  worstVerdict,
  type EvaluationPack,
  type ExaminerReport,
  type JudgeProvider,
} from "./index";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

function makePack(
  kind: "det" | "ca",
  digest: string = DIGEST_A,
  judge: { provider: JudgeProvider; model: string } = {
    provider: "gemini",
    model: "gemini-3.8-flash",
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
            exemptions: { examinerReport: "-", pairwise: "-" },
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
    judge: { provider: "gemini", model: "gemini-3.8-flash" },
    ranAt: "2026-08-23T00:00:00.000Z",
    ...overrides,
  };
}

describe("worstVerdict", () => {
  it("빈 목록은 pass, 최악 판정이 전체를 지배한다", () => {
    expect(worstVerdict([])).toBe("pass");
    expect(worstVerdict(["pass", "warn"])).toBe("warn");
    expect(worstVerdict(["warn", "fail", "pass"])).toBe("fail");
  });
});

describe("approvalBlockers", () => {
  it("결정적 전용 루프는 면제 — 리포트 없이도 차단 없음(SPEC §10)", () => {
    expect(approvalBlockers(makePack("det"), null)).toEqual([]);
  });

  it("llm_judge 루프는 리포트가 없으면 차단된다", () => {
    const blockers = approvalBlockers(makePack("ca"), null);
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toContain("검증");
  });

  it("기준 수정(다이제스트 변경)은 리포트를 기계적으로 무효화한다", () => {
    const newPack = makePack("ca", DIGEST_B);
    const blockers = approvalBlockers(newPack, makeReport());
    expect(blockers.some((b) => b.includes("검증 리포트가 무효화"))).toBe(true);
  });

  it("배터리를 구동한 저지가 동결 선언과 다르면 차단된다 (모의는 provider만 대조)", () => {
    const geminiPack = makePack("ca");
    expect(
      approvalBlockers(
        geminiPack,
        makeReport({ judge: { provider: "mock", model: "모의" } }),
      ).some((b) => b.includes("채점 모델")),
    ).toBe(true);
    const openaiPack = makePack("ca", DIGEST_A, {
      provider: "openai",
      model: "gpt-5.6-sol",
    });
    expect(
      approvalBlockers(
        openaiPack,
        makeReport({ judge: { provider: "openai", model: "다른-모델" } }),
      ).some((b) => b.includes("채점 모델")),
    ).toBe(true);
    expect(
      approvalBlockers(
        geminiPack,
        makeReport({ judge: { provider: "gemini", model: "다른-모델" } }),
      ).some((b) => b.includes("채점 모델")),
    ).toBe(true);
    // 모의 저지는 모델명 표기가 유동적 — provider 일치면 통과(등록소 실행 가드와 동일 규칙)
    const mockPack = makePack("ca", DIGEST_A, { provider: "mock", model: "모의 모델" });
    expect(
      approvalBlockers(
        mockPack,
        makeReport({ judge: { provider: "mock", model: "모의 모델 (결정적)" } }),
      ),
    ).toEqual([]);
  });

  it("검증 fail은 승인을 차단하고, warn은 승인을 허용한다", () => {
    const pack = makePack("ca");
    expect(
      approvalBlockers(pack, makeReport({ overall: "fail" })).some((b) => b.includes("실패")),
    ).toBe(true);
    expect(approvalBlockers(pack, makeReport({ overall: "warn" }))).toEqual([]);
  });

  it("유효한 pass 리포트면 차단 없음", () => {
    expect(approvalBlockers(makePack("ca"), makeReport())).toEqual([]);
  });
});
