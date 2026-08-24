import { describe, expect, it } from "vitest";
import {
  digestScope,
  ProjectExportContractError,
  sha256Canonical,
  type EvaluationPack,
  type LoopCheckpoint,
} from "@harnest/contracts";
import type { CompiledGeneric } from "../state";
import {
  buildProjectExport,
  isHoldoutPhasePending,
  isHoldoutSettled,
  needsRestoredHoldoutRecovery,
  projectExportFilename,
  serializeProjectExport,
} from "./project-export";

const at = "2026-08-24T12:00:00.000Z";

async function fixture() {
  const base: Omit<EvaluationPack, "definitionDigest"> = {
    packVersion: "skeleton-1",
    templateId: "timetable",
    criteria: [],
    gates: [],
    judgeProcedure: {
      kind: "deterministic_only",
      exemptions: { examinerReport: "면제", calibration: "면제", pairwise: "면제" },
    },
    holdoutPolicy: { mode: "none", note: "없음" },
  };
  const pack: EvaluationPack = {
    ...base,
    definitionDigest: await sha256Canonical(digestScope(base)),
  };
  const compiled: CompiledGeneric = {
    problem: { derived: "내보내지 않음" },
    pack,
    loopSpec: { maxRounds: 1, plateauRounds: 1, adoptionRule: "scalar_strict", seed: 1 },
  };
  const checkpoint: LoopCheckpoint<string> = {
    runId: "run-1",
    packDigest: pack.definitionDigest,
    status: "done",
    doneReason: "max_rounds",
    round: 1,
    champion: "완료",
    championScore: 100,
    championViolations: [],
    curve: [80, 100],
    tree: [
      {
        round: 1,
        candidateScore: 100,
        championScore: 100,
        adopted: true,
        gateRejected: false,
        violations: [],
      },
    ],
    provenance: [],
    rngState: 1,
  };
  return { compiled, checkpoint, pack };
}

describe("결과 기록 내보내기", () => {
  it("승인 순간 digest를 사용하고 내부 상태·API 키를 허용 목록 밖에 둔다", async () => {
    const { compiled, checkpoint, pack } = await fixture();
    const envelope = await buildProjectExport({
      compiled,
      answers: { staff: "가온, 나래, 다솜" },
      examinerRun: null,
      calibration: null,
      approvedDigest: pack.definitionDigest,
      approvedAt: at,
      checkpoint,
      holdout: { baseline: null, final: null },
      exportedAt: at,
    });
    const json = serializeProjectExport(envelope);

    expect(json).not.toContain("내보내지 않음");
    expect(json).not.toContain("apiKey");
    expect(JSON.parse(json)).toEqual(envelope);
    expect(projectExportFilename(envelope).length).toBeLessThanOrEqual(30);
  });

  it("approvedDigest를 현재 Pack에서 재파생하지 않고 불일치를 거부한다", async () => {
    const { compiled, checkpoint } = await fixture();
    await expect(
      buildProjectExport({
        compiled,
        answers: {},
        examinerRun: null,
        calibration: null,
        approvedDigest: "b".repeat(64),
        approvedAt: at,
        checkpoint,
        holdout: { baseline: null, final: null },
        exportedAt: at,
      }),
    ).rejects.toBeInstanceOf(ProjectExportContractError);
  });

  it("복원된 완료 실행에서 복구 가능한 홀드아웃 단계를 관제실 재채점 대상으로 판별한다", async () => {
    const { compiled, checkpoint, pack } = await fixture();
    const withHoldoutBase: Omit<EvaluationPack, "definitionDigest"> = {
      ...pack,
      holdoutPolicy: { mode: "auto_tail", note: "자동", holdoutCaseIds: ["case-1"] },
    };
    const withHoldout: EvaluationPack = {
      ...withHoldoutBase,
      definitionDigest: await sha256Canonical(digestScope(withHoldoutBase)),
    };
    const done = { ...checkpoint, packDigest: withHoldout.definitionDigest };
    const pending = {
      baseline: null,
      final: null,
      errors: { baseline: "시작 결과 복원 불가", final: null },
    };

    expect(isHoldoutSettled(withHoldout, pending)).toBe(false);
    expect(isHoldoutPhasePending(pending, "final")).toBe(true);
    expect(needsRestoredHoldoutRecovery(withHoldout, done, pending)).toBe(true);
    const failedFinal = {
      ...pending,
      errors: { ...pending.errors, final: "종료 채점 실패" },
    };
    expect(isHoldoutPhasePending(failedFinal, "final")).toBe(false);
    expect(needsRestoredHoldoutRecovery(withHoldout, done, failedFinal)).toBe(false);

    const zeroRoundDone = {
      ...done,
      round: 0,
      championScore: 80,
      curve: [80],
      tree: [],
    };
    const recoverableBaseline = {
      baseline: null,
      final: null,
      errors: { baseline: null, final: "종료 채점 실패" },
    };
    expect(
      needsRestoredHoldoutRecovery(withHoldout, zeroRoundDone, recoverableBaseline),
    ).toBe(true);

    await expect(
      buildProjectExport({
        compiled: { ...compiled, pack: withHoldout },
        answers: {},
        examinerRun: null,
        calibration: null,
        approvedDigest: withHoldout.definitionDigest,
        approvedAt: at,
        checkpoint: done,
        holdout: pending,
        exportedAt: at,
      }),
    ).rejects.toBeInstanceOf(ProjectExportContractError);

    const settledFailure = {
      baseline: {
        gateRejected: false as const,
        score: 50,
        perCase: [
          {
            caseId: "case-1",
            question: "숨김 질문",
            score: 0.5,
            why: "부분 정답",
            caseType: "new" as const,
          },
        ],
        violations: [],
      },
      final: null,
      errors: { baseline: null, final: "종료 채점 실패" },
    };
    const envelope = await buildProjectExport({
      compiled: { ...compiled, pack: withHoldout },
      answers: {},
      examinerRun: null,
      calibration: null,
      approvedDigest: withHoldout.definitionDigest,
      approvedAt: at,
      checkpoint: done,
      holdout: settledFailure,
      exportedAt: at,
    });
    expect(isHoldoutSettled(withHoldout, settledFailure)).toBe(true);
    expect(envelope.result.holdout).toMatchObject({
      mode: "measured",
      final: { status: "failed", error: "종료 채점 실패" },
    });
  });
});
