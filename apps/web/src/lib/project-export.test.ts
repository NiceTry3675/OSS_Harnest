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
  holdoutPhaseToScore,
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
      exemptions: { examinerReport: "면제", pairwise: "면제" },
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
    championScore: 90,
    championViolations: [],
    championGuardScore: null,
    curve: [80, 90],
    guardCurve: [null, null],
    tree: [
      {
        round: 1,
        candidateScore: 90,
        championScore: 90,
        adopted: true,
        gateRejected: false,
        violations: [],
        candidateGuardScore: null,
        guardSafe: true,
      },
    ],
    provenance: [],
    rngState: 1,
  };
  return { compiled, checkpoint, pack };
}

describe("결과 기록 내보내기", () => {
  it("승인 순간 digest를 사용하고 내부 상태·벤더 자격 증명을 허용 목록 밖에 둔다", async () => {
    const { compiled, checkpoint, pack } = await fixture();
    const envelope = await buildProjectExport({
      compiled,
      answers: { staff: "가온, 나래, 다솜" },
      examinerReport: null,
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
        examinerReport: null,
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
      holdoutPolicy: {
        mode: "seeded_split",
        note: "시드 분할",
        guardCaseIds: ["case-0"],
        holdoutCaseIds: ["case-1"],
        guardTolerance: 4.2,
      },
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
        examinerReport: null,
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
      examinerReport: null,
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

describe("홀드아웃 채점 시점(holdoutPhaseToScore)", () => {
  const empty = { baseline: null, final: null, errors: { baseline: null, final: null } };
  const scored = {
    gateRejected: false as const,
    score: 50,
    perCase: [],
    violations: [],
  };

  it("라운드 0 시작 통지(run_started)는 시작 단계만 낸다", () => {
    expect(holdoutPhaseToScore({ round: 0, status: "running" }, empty)).toEqual(["baseline"]);
  });

  it("같은 라운드 0의 재개 통지라도 시작 결과가 이미 있으면 다시 채점하지 않는다", () => {
    expect(
      holdoutPhaseToScore({ round: 0, status: "running" }, { ...empty, baseline: scored }),
    ).toEqual([]);
  });

  it("시작 실패 사유가 기록된 라운드 0도 재채점하지 않는다 — 실패는 확정된 단계다", () => {
    expect(
      holdoutPhaseToScore(
        { round: 0, status: "running" },
        { ...empty, errors: { baseline: "시작 채점 실패", final: null } },
      ),
    ).toEqual([]);
  });

  it("진행 중인 라운드에서는 어떤 단계도 채점하지 않는다(SPEC §3 원칙 7)", () => {
    expect(holdoutPhaseToScore({ round: 3, status: "running" }, empty)).toEqual([]);
    expect(holdoutPhaseToScore({ round: 3, status: "paused" }, empty)).toEqual([]);
  });

  it("완료 통지는 종료 단계를 낸다", () => {
    expect(holdoutPhaseToScore({ round: 3, status: "done" }, empty)).toEqual(["final"]);
  });

  it("라운드 0에서 상한 종료되면 시작·종료를 함께 낸다 — 호출자가 같은 산출물임을 알고 한 번만 잰다", () => {
    expect(holdoutPhaseToScore({ round: 0, status: "done" }, empty)).toEqual(["baseline", "final"]);
  });

  it("시작 단계가 복원 불가로 확정되면 라운드 0 완료본이라도 종료만 낸다 — 확정된 실패는 재채점하지 않는다", () => {
    const restored = {
      ...empty,
      errors: { baseline: "저장된 기록에 시작할 때의 최종 확인 결과가 없어 복원할 수 없습니다.", final: null },
    };
    // 같은 입력에서 실패 확정만 지우면 시작·종료를 함께 낸다 — 차이를 만드는 것이 errors.baseline이다
    expect(holdoutPhaseToScore({ round: 0, status: "done" }, restored)).toEqual(["final"]);
    expect(
      holdoutPhaseToScore({ round: 0, status: "done" }, { ...restored, errors: { baseline: null, final: null } }),
    ).toEqual(["baseline", "final"]);
    // 라운드가 지난 완료본은 애초에 시작 단계를 내지 않는다
    expect(holdoutPhaseToScore({ round: 2, status: "done" }, restored)).toEqual(["final"]);
  });

  it("errors 필드가 없는 구버전 홀드아웃도 대기로 본다", () => {
    expect(holdoutPhaseToScore({ round: 0, status: "done" }, { baseline: null, final: null })).toEqual([
      "baseline",
      "final",
    ]);
  });
});
