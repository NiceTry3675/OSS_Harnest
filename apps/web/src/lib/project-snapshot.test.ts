/** 프로젝트 스냅샷 회귀 테스트 — 새로고침 뒤 승인·실패 고착·체크포인트 귀속 보존. */

import { describe, expect, it } from "vitest";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";
import {
  type EvaluationPack,
  type ExaminerReport,
  type LoopCheckpoint,
} from "@harnest/contracts";
import { createLoopRun, IndexedDbCheckpointStore } from "@harnest/loop-engine";
import type { CompiledGeneric } from "../state";
import {
  IndexedDbProjectStore,
  markUnavailableRestoredHoldout,
  PROJECT_SNAPSHOT_VERSION,
  projectRestoredCheckpoint,
  restoreProjectSnapshot,
  SnapshotConflictError,
  type ProjectSnapshot,
  type StoredProjectSnapshot,
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
  holdoutPolicy: {
    mode: "seeded_split",
    note: "시드 분할",
    guardCaseIds: ["case-4"],
    holdoutCaseIds: ["case-5"],
    guardTolerance: 4.2,
  },
  definitionDigest: "a".repeat(64),
};

const compiled: CompiledGeneric = {
  problem: { visibleCases: [], holdoutCases: [], lengthCap: 1000 },
  pack,
  loopSpec: { maxRounds: 2, plateauRounds: 9, adoptionRule: "scalar_strict", seed: 1 },
};

const report: ExaminerReport = {
  checks: [
    { id: "stability", verdict: "pass", note: "-" },
    { id: "hack_resistance", verdict: "pass", note: "-" },
  ],
  overall: "pass",
  forDigest: pack.definitionDigest,
  judge: { provider: "mock", model: "모의 모델" },
  ranAt: "2026-08-23T00:00:00.000Z",
};

function makeSnapshot(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    schemaVersion: PROJECT_SNAPSHOT_VERSION,
    templateId: "handover",
    answers: { material: "공개 자료" },
    compiled,
    examinerReport: report,
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
    // 판 번호는 저장소가 붙인다 — 호출자가 넘긴 내용은 그대로다
    expect(loaded).toEqual({ ...snapshot, revision: 1 });
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
    expect(restoredMismatch.holdout).toEqual({
      baseline: null,
      final: null,
      errors: { baseline: null, final: null },
    });
  });

  it("잠금 없는 환경 방어: 다른 인스턴스(탭)가 먼저 저장하면 오래된 판의 저장은 거부되고 저장소는 그대로다", async () => {
    globalThis.indexedDB = fakeIndexedDB;
    const name = "harnest-project-revision-cas";
    const tabA = new IndexedDbProjectStore(name);
    const tabB = new IndexedDbProjectStore(name);
    // 읽지 않은 인스턴스의 첫 저장은 저장소의 현재 판을 잇는다(0 → 1)
    await tabA.save(makeSnapshot({ approvedAt: null, approvedDigest: null, runId: null }));
    await tabB.load(); // B는 1판을 읽었다
    // A가 승인·runId를 기록해 2판을 만든다
    await tabA.save(makeSnapshot());
    // B의 오래된 상태(승인 전)는 2판을 덮어쓰지 못한다
    await expect(
      tabB.save(makeSnapshot({ approvedAt: null, approvedDigest: null, runId: null })),
    ).rejects.toBeInstanceOf(SnapshotConflictError);
    const stored = await tabA.load();
    expect(stored?.approvedAt).toBe(makeSnapshot().approvedAt);
    expect(stored?.runId).toBe(makeSnapshot().runId);
    expect(stored?.revision).toBe(2);
    // 거부된 뒤에도 B는 계속 거부된다 — 다시 읽어야(새로고침) 이어서 저장할 수 있다
    await expect(tabB.save(makeSnapshot())).rejects.toBeInstanceOf(SnapshotConflictError);
    await tabB.load();
    // 내용이 같은 저장은 판을 올리지 않는다 — 갓 연 유휴 탭이 실행 중인 탭을 밀어내지 않게
    await expect(tabB.save(makeSnapshot())).resolves.toBeUndefined();
    expect((await tabA.load())?.revision).toBe(2);
    // 내용이 다르면 다음 판으로 기록된다
    await expect(
      tabB.save(makeSnapshot({ approvedAt: null, approvedDigest: null, runId: null })),
    ).resolves.toBeUndefined();
    expect((await tabA.load())?.revision).toBe(3);
  });

  it("v1 스냅샷은 검사 4종 리포트를 2종으로 줄이고 overall을 다시 계산해 마이그레이션한다", () => {
    const v1Report: ExaminerReport = {
      ...report,
      checks: [
        { id: "ordering" as never, verdict: "warn", note: "-" },
        { id: "discrimination" as never, verdict: "pass", note: "-" },
        { id: "stability", verdict: "pass", note: "-" },
        { id: "hack_resistance", verdict: "pass", note: "-" },
      ],
      overall: "warn",
    };
    const base = makeSnapshot();
    const v1: StoredProjectSnapshot = {
      schemaVersion: 1,
      templateId: base.templateId,
      answers: base.answers,
      compiled: base.compiled,
      examinerRun: { report: v1Report },
      approvedDigest: base.approvedDigest,
      approvedAt: base.approvedAt,
      runId: base.runId,
      holdout: base.holdout,
    };

    const restored = restoreProjectSnapshot(v1)!;
    // ordering·discrimination이 떨어지고, warn의 출처가 사라졌으므로 overall은 pass로 재계산된다
    expect(restored.examinerReport?.checks.map((c) => c.id)).toEqual([
      "stability",
      "hack_resistance",
    ]);
    expect(restored.examinerReport?.overall).toBe("pass");
    // 승인·실행 상태는 v2와 같은 규칙으로 복원된다
    expect(restored.approvedAt).toBe(base.approvedAt);

    // 현재 배터리 2종을 담지 못한 v1 리포트는 리포트 없음으로 마이그레이션 — 자동 재검증 대상
    const partial = restoreProjectSnapshot({
      ...v1,
      examinerRun: { report: { ...v1Report, checks: v1Report.checks.slice(0, 2) } },
    })!;
    expect(partial.examinerReport).toBeNull();

    // 알 수 없는 미래 버전은 복원하지 않는다
    expect(restoreProjectSnapshot({ ...base, schemaVersion: 99 as never })).toBeNull();
  });

  it("재진입 시 지난 시작 홀드아웃만 복원 불가로 확정하고 종료 단계는 대기로 둔다", () => {
    const saved = makeSnapshot({ holdout: { baseline: null, final: null } });
    const restored = restoreProjectSnapshot(saved)!;
    const settled = markUnavailableRestoredHoldout(
      restored.holdout,
      {
        runId: "paused-after-baseline",
        packDigest: pack.definitionDigest,
        status: "paused",
        round: 1,
        champion: "라운드 1",
        championScore: 1,
        championViolations: [],
        championGuardScore: null,
        curve: [1],
        guardCurve: [null],
        tree: [],
        provenance: [],
        rngState: 1,
      },
      true,
    );

    expect(settled.errors?.baseline).toContain("복원할 수 없습니다");
    expect(settled.errors?.final).toBeNull();
    expect(settled.final).toBeNull();
  });

  it("복원 시 running 저장본은 paused로 투영하고, 잠금을 쥔 탭에서만 탭 회수 runId를 기록한다", () => {
    const running: LoopCheckpoint<unknown> = {
      runId: "closed-mid-round",
      packDigest: pack.definitionDigest,
      status: "running",
      round: 2,
      champion: "라운드 2",
      championScore: 2,
      championViolations: [],
      championGuardScore: null,
      curve: [1, 1.5, 2],
      guardCurve: [null, null, null],
      tree: [],
      provenance: [],
      rngState: 1,
    };
    // 탭이 닫혀 남은 running — 진행 중이던 3회차는 저장되지 않았다는 안내의 근거
    const owned = projectRestoredCheckpoint(running, pack.definitionDigest, true);
    expect(owned.checkpoint?.status).toBe("paused");
    expect(owned.checkpoint?.round).toBe(2);
    expect(owned.interruptedRunId).toBe("closed-mid-round");
    // 읽기 전용 탭의 running 저장본은 다른 탭이 지금 돌리고 있는 것 — 탭 회수가 아니다
    const readOnly = projectRestoredCheckpoint(running, pack.definitionDigest, false);
    expect(readOnly.checkpoint?.status).toBe("paused");
    expect(readOnly.interruptedRunId).toBeNull();
    // paused·done 저장본은 그대로이고 안내도 없다
    const paused = projectRestoredCheckpoint({ ...running, status: "paused" }, pack.definitionDigest, true);
    expect(paused.checkpoint?.status).toBe("paused");
    expect(paused.interruptedRunId).toBeNull();
    // 현재 팩에 결속되지 않은 저장본은 버린다
    expect(projectRestoredCheckpoint(running, "b".repeat(64), true)).toEqual({
      checkpoint: null,
      interruptedRunId: null,
    });
    expect(projectRestoredCheckpoint(null, pack.definitionDigest, true)).toEqual({
      checkpoint: null,
      interruptedRunId: null,
    });
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
      championGuardScore: null,
      curve: [5, 10],
      guardCurve: [null, null],
      tree: [
        {
          round: 1,
          candidateScore: 10,
          championScore: 10,
          adopted: true,
          gateRejected: false,
          violations: [],
          candidateGuardScore: null,
          guardSafe: true,
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
      championGuardScore: null,
      curve: [1],
      guardCurve: [null],
      tree: [],
      provenance: [],
      rngState: 1,
    });
    await checkpointStore.delete(runId);
    await expect(checkpointStore.load(runId)).resolves.toBeNull();
  });
});
