/** 프로젝트 스냅샷 회귀 테스트 — 새로고침 뒤 승인·실패 고착·체크포인트 귀속 보존. */

import { describe, expect, it } from "vitest";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";
import {
  approvalBlockers,
  type CalibrationResult,
  type EvaluationPack,
  type ExaminerReport,
  type LoopCheckpoint,
} from "@harnest/contracts";
import { createLoopRun, IndexedDbCheckpointStore } from "@harnest/loop-engine";
import type { CompiledGeneric } from "../state";
import {
  IndexedDbProjectStore,
  PROJECT_SNAPSHOT_VERSION,
  restoreProjectSnapshot,
  type ProjectSnapshot,
} from "./project-snapshot";

const pack: EvaluationPack = {
  packVersion: "skeleton-1",
  templateId: "handover",
  criteria: [],
  gates: [],
  judgeProcedure: {
    kind: "case_answering",
    judge: { provider: "mock", model: "모의 모델" },
    pairwiseNotice: "미적용",
  },
  holdoutPolicy: { mode: "auto_tail", note: "자동", holdoutCaseIds: ["case-5"] },
  definitionDigest: "a".repeat(64),
};

const compiled: CompiledGeneric = {
  problem: { visibleCases: [], holdoutCases: [], lengthCap: 1000 },
  pack,
  loopSpec: { maxRounds: 2, plateauRounds: 9, adoptionRule: "scalar_strict", seed: 1 },
};

const report: ExaminerReport = {
  checks: [],
  overall: "pass",
  forDigest: pack.definitionDigest,
  judge: { provider: "mock", model: "모의 모델" },
  ranAt: "2026-08-23T00:00:00.000Z",
};

const failedCalibration: CalibrationResult = {
  pairs: [
    {
      id: "hack-1",
      kind: "hack_probe",
      userChoice: "A",
      examinerChoice: "B",
      agreed: false,
    },
  ],
  verdict: "fail",
  forDigest: pack.definitionDigest,
  forReportAt: report.ranAt,
  ranAt: "2026-08-23T00:01:00.000Z",
};

function makeSnapshot(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    schemaVersion: PROJECT_SNAPSHOT_VERSION,
    templateId: "handover",
    answers: { material: "공개 자료" },
    compiled,
    examinerRun: { report, artifacts: { goodDoc: "좋은 문서" } },
    calibration: null,
    approvedDigest: pack.definitionDigest,
    approvedAt: "2026-08-23T00:02:00.000Z",
    runId: "snapshot-run",
    holdout: {
      baseline: {
        gateRejected: false,
        score: 50,
        perCase: [
          {
            caseId: "case-5",
            question: "질문",
            score: 0.5,
            why: "일부 누락",
            caseType: "new",
          },
        ],
        violations: [],
      },
      final: null,
    },
    ...overrides,
  };
}

describe("IndexedDbProjectStore", () => {
  it("승인 상태를 왕복하고 승인 다이제스트가 현재 팩과 같을 때만 복원한다", async () => {
    globalThis.indexedDB = fakeIndexedDB;
    const store = new IndexedDbProjectStore("harnest-project-approved");
    const snapshot = makeSnapshot();
    await store.save(snapshot);

    const loaded = await store.load();
    expect(loaded).toEqual(snapshot);
    expect(JSON.stringify(loaded)).not.toContain("apiKey");
    const restoredMatch = restoreProjectSnapshot(loaded!)!;
    expect(restoredMatch.approvedAt).toBe(snapshot.approvedAt);
    expect(restoredMatch.approvedDigest).toBe(pack.definitionDigest);

    const mismatch = makeSnapshot({ approvedDigest: "b".repeat(64) });
    const restoredMismatch = restoreProjectSnapshot(mismatch)!;
    expect(restoredMismatch.compiled).toEqual(compiled);
    expect(restoredMismatch.approvedAt).toBeNull();
    expect(restoredMismatch.approvedDigest).toBeNull();
    expect(restoredMismatch.runId).toBeNull();
    expect(restoredMismatch.holdout).toEqual({ baseline: null, final: null });
  });

  it("승인 전 캘리브레이션 실패는 새로고침 뒤에도 같은 다이제스트에 고착된다", () => {
    const restored = restoreProjectSnapshot(
      makeSnapshot({
        calibration: failedCalibration,
        approvedDigest: null,
        approvedAt: null,
        runId: null,
      }),
    )!;

    expect(restored.calibration).toEqual(failedCalibration);
    expect(approvalBlockers(pack, report, restored.calibration).some((b) => b.includes("캘리브레이션 실패")))
      .toBe(true);
  });

  it("복원된 runId로 IndexedDB 체크포인트를 이어서 완료한다", async () => {
    globalThis.indexedDB = fakeIndexedDB;
    const runId = "snapshot-checkpoint-resume";
    const checkpointStore = new IndexedDbCheckpointStore<number>();
    const checkpoint: LoopCheckpoint<number> = {
      runId,
      packDigest: pack.definitionDigest,
      status: "paused",
      round: 1,
      champion: 10,
      championScore: 10,
      championViolations: [],
      curve: [5, 10],
      tree: [
        {
          round: 1,
          candidateScore: 10,
          championScore: 10,
          adopted: true,
          gateRejected: false,
          violations: [],
        },
      ],
      provenance: [],
      rngState: 123,
    };
    await checkpointStore.save(checkpoint);
    const restored = restoreProjectSnapshot(makeSnapshot({ runId }))!;

    await createLoopRun<number>({
      runId: restored.runId!,
      pack,
      spec: compiled.loopSpec,
      scorer: (artifact) => ({ total: artifact, violations: [], parts: {}, gateRejected: false }),
      generate: (champion) => champion + 1,
      initial: () => 0,
      store: checkpointStore,
      onEvent: () => {},
    }).start();

    const final = await checkpointStore.load(runId);
    expect(final?.status).toBe("done");
    expect(final?.round).toBe(2);
    expect(final?.champion).toBe(11);
    expect(final?.provenance.some((p) => p.type === "resumed")).toBe(true);
  });

  it("폐기된 runId의 체크포인트는 delete로 정리된다 — 고아를 남기지 않는다", async () => {
    globalThis.indexedDB = fakeIndexedDB;
    const runId = "snapshot-orphan";
    const checkpointStore = new IndexedDbCheckpointStore<number>();
    await checkpointStore.save({
      runId,
      packDigest: pack.definitionDigest,
      status: "paused",
      round: 1,
      champion: 1,
      championScore: 1,
      championViolations: [],
      curve: [1],
      tree: [],
      provenance: [],
      rngState: 1,
    });
    await checkpointStore.delete(runId);
    await expect(checkpointStore.load(runId)).resolves.toBeNull();
  });
});
