import { describe, expect, it } from "vitest";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";
import type { EvaluationPack, LoopCheckpoint, LoopSpec, ScoreResult } from "@harnest/contracts";
import {
  createLoopRun,
  createRng,
  IndexedDbCheckpointStore,
  MemoryCheckpointStore,
  type LoopHandle,
  type LoopRunOptions,
} from "./index";

const pack: EvaluationPack = {
  packVersion: "skeleton-1",
  templateId: "test",
  criteria: [],
  gates: [],
  judgeProcedure: {
    kind: "deterministic_only",
    exemptions: { examinerReport: "-", calibration: "-", pairwise: "-" },
  },
  holdoutPolicy: { mode: "none", note: "-" },
  definitionDigest: "test-digest",
};

const makeSpec = (over: Partial<LoopSpec> = {}): LoopSpec => ({
  maxRounds: 10,
  plateauRounds: 99,
  adoptionRule: "scalar_strict",
  seed: 42,
  ...over,
});

const ok = (total: number): ScoreResult => ({ total, violations: [], parts: {}, gateRejected: false });

describe("createRng", () => {
  it("같은 시드는 같은 수열, state 복원 시 수열이 이어서 재현된다", () => {
    const a = createRng(123);
    const b = createRng(123);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);

    const saved = a.state;
    const ahead = [a(), a(), a()];
    a.state = saved;
    expect([a(), a(), a()]).toEqual(ahead);
  });

  it("값은 [0, 1) 범위다", () => {
    const r = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("createLoopRun", () => {
  it("동점 후보는 채택하지 않는다 (scalar_strict)", async () => {
    const events: LoopCheckpoint<number>[] = [];
    const handle = createLoopRun<number>({
      runId: "tie",
      pack,
      spec: makeSpec({ maxRounds: 5 }),
      scorer: () => ok(50),
      generate: (champion) => champion + 1,
      initial: () => 0,
      store: new MemoryCheckpointStore<number>(),
      onEvent: (cp) => events.push(cp),
    });
    await handle.start();

    const last = events[events.length - 1];
    expect(last.status).toBe("done");
    expect(last.doneReason).toBe("max_rounds");
    expect(last.champion).toBe(0);
    expect(last.tree).toHaveLength(5);
    expect(last.tree.every((r) => !r.adopted)).toBe(true);
    expect(last.curve).toEqual([50, 50, 50, 50, 50, 50]);
  });

  it("게이트 기각 후보는 점수가 높아도 채택 판정에 진입하지 않는다", async () => {
    const events: LoopCheckpoint<number>[] = [];
    const handle = createLoopRun<number>({
      runId: "gate",
      pack,
      spec: makeSpec({ maxRounds: 4 }),
      // 챔피언(0)은 10점, 후보(>0)는 99점이지만 전부 게이트 기각
      scorer: (a) =>
        a === 0 ? ok(10) : { total: 99, violations: ["게이트 위반"], parts: {}, gateRejected: true },
      generate: (champion) => champion + 1,
      initial: () => 0,
      store: new MemoryCheckpointStore<number>(),
      onEvent: (cp) => events.push(cp),
    });
    await handle.start();

    const last = events[events.length - 1];
    expect(last.champion).toBe(0);
    expect(last.championScore).toBe(10);
    expect(last.curve).toEqual([10, 10, 10, 10, 10]);
    for (const record of last.tree) {
      expect(record.gateRejected).toBe(true);
      expect(record.adopted).toBe(false);
      expect(record.candidateScore).toBe(99);
      expect(record.championScore).toBe(10);
    }
  });

  it("연속 plateauRounds 미채택이면 조기 종료한다", async () => {
    const events: LoopCheckpoint<number>[] = [];
    const handle = createLoopRun<number>({
      runId: "plateau",
      pack,
      spec: makeSpec({ maxRounds: 100, plateauRounds: 4 }),
      scorer: (a) => ok(a),
      generate: (champion) => champion - 1, // 항상 더 나쁜 후보
      initial: () => 60,
      store: new MemoryCheckpointStore<number>(),
      onEvent: (cp) => events.push(cp),
    });
    await handle.start();

    const last = events[events.length - 1];
    expect(last.status).toBe("done");
    expect(last.doneReason).toBe("plateau");
    expect(last.round).toBe(4);
    expect(last.curve).toEqual([60, 60, 60, 60, 60]);
    expect(last.provenance.some((p) => p.type === "plateau_stop")).toBe(true);
  });

  it("곡선은 후보 점수가 아니라 채택 확정 후 챔피언 점수를 기록한다", async () => {
    const candidates = [20, 15, 30];
    let i = 0;
    const events: LoopCheckpoint<number>[] = [];
    const handle = createLoopRun<number>({
      runId: "curve",
      pack,
      spec: makeSpec({ maxRounds: 3 }),
      scorer: (a) => ok(a),
      generate: () => candidates[i++],
      initial: () => 10,
      store: new MemoryCheckpointStore<number>(),
      onEvent: (cp) => events.push(cp),
    });
    await handle.start();

    const last = events[events.length - 1];
    expect(last.curve).toEqual([10, 20, 20, 30]); // 라운드 2의 후보 15는 곡선에 나타나지 않는다
    expect(last.tree.map((r) => r.adopted)).toEqual([true, false, true]);
    expect(last.tree.map((r) => r.candidateScore)).toEqual([20, 15, 30]);
    expect(last.tree.map((r) => r.championScore)).toEqual([20, 20, 30]);
    expect(last.champion).toBe(30);
    expect(last.provenance.filter((p) => p.type === "adopted")).toHaveLength(2);
  });

  it("매 라운드 저장 후 이벤트가 온다 — 저장본과 이벤트본이 일치한다", async () => {
    const store = new MemoryCheckpointStore<number>();
    const seen: Array<{ round: number; stored: number | undefined }> = [];
    const handle = createLoopRun<number>({
      runId: "save-then-event",
      pack,
      spec: makeSpec({ maxRounds: 3 }),
      scorer: (a) => ok(a),
      generate: (champion, rng) => champion + rng(),
      initial: () => 1,
      store,
      onEvent: (cp) => {
        void store.load("save-then-event").then((stored) => {
          seen.push({ round: cp.round, stored: stored?.round });
        });
      },
    });
    await handle.start();
    await new Promise((r) => setTimeout(r, 0));

    expect(seen.map((s) => s.round)).toEqual([0, 1, 2, 3]);
    // 이벤트 시점에 해당 라운드는 이미 저장되어 있다(첫 커밋부터 재개 가능)
    for (const s of seen) expect(s.stored).toBeGreaterThanOrEqual(s.round);
  });

  it("결정성: 같은 시드로 끝까지 실행 vs 중간 pause 후 재개가 동일한 curve·챔피언", async () => {
    const spec = makeSpec({ maxRounds: 12, seed: 7 });
    const scorer = (a: number) => ok(a);
    const generate = (champion: number, rng: () => number) => champion + (rng() * 2 - 0.9);
    const initial = (rng: () => number) => rng() * 10;

    // (a) 끝까지 실행
    const storeA = new MemoryCheckpointStore<number>();
    await createLoopRun<number>({
      runId: "det",
      pack,
      spec,
      scorer,
      generate,
      initial,
      store: storeA,
      onEvent: () => {},
    }).start();
    const finalA = await storeA.load("det");
    expect(finalA?.status).toBe("done");

    // (b) 라운드 5에서 pause 후 재개
    const storeB = new MemoryCheckpointStore<number>();
    let handleB: LoopHandle;
    const optsB: LoopRunOptions<number> = {
      runId: "det",
      pack,
      spec,
      scorer,
      generate,
      initial,
      store: storeB,
      onEvent: (cp) => {
        if (cp.status === "running" && cp.round === 5) handleB.pause();
      },
    };
    handleB = createLoopRun(optsB);
    await handleB.start();

    const paused = await storeB.load("det");
    expect(paused?.status).toBe("paused");
    expect(paused?.round).toBe(5);
    expect(paused?.provenance.some((p) => p.type === "paused")).toBe(true);

    await createLoopRun({ ...optsB, onEvent: () => {} }).start();
    const finalB = await storeB.load("det");

    expect(finalB?.status).toBe("done");
    expect(finalB?.provenance.some((p) => p.type === "resumed")).toBe(true);
    expect(finalB?.curve).toEqual(finalA?.curve);
    expect(finalB?.champion).toBe(finalA?.champion);
    expect(finalB?.championScore).toBe(finalA?.championScore);
    expect(finalB?.tree.map((r) => [r.candidateScore, r.adopted])).toEqual(
      finalA?.tree.map((r) => [r.candidateScore, r.adopted]),
    );
  });

  it("판정 절차 다이제스트가 다른 체크포인트는 이어받지 않는다", async () => {
    const store = new MemoryCheckpointStore<number>();
    let handle: LoopHandle;
    const opts: LoopRunOptions<number> = {
      runId: "digest-guard",
      pack,
      spec: makeSpec({ maxRounds: 6 }),
      scorer: (a) => ok(a),
      generate: (champion, rng) => champion + rng(),
      initial: () => 1,
      store,
      onEvent: (cp) => {
        if (cp.status === "running" && cp.round === 2) handle.pause();
      },
    };
    handle = createLoopRun(opts);
    await handle.start();
    expect((await store.load("digest-guard"))?.status).toBe("paused");

    const otherPack = { ...pack, definitionDigest: "다른-절차" };
    await expect(
      createLoopRun({ ...opts, pack: otherPack, onEvent: () => {} }).start(),
    ).rejects.toThrow("재승인");
  });

  it("완료된 실행은 재시작해도 이어 돌지 않는다", async () => {
    const store = new MemoryCheckpointStore<number>();
    const opts: LoopRunOptions<number> = {
      runId: "done-run",
      pack,
      spec: makeSpec({ maxRounds: 2 }),
      scorer: (a) => ok(a),
      generate: (champion, rng) => champion + rng(),
      initial: () => 1,
      store,
      onEvent: () => {},
    };
    await createLoopRun(opts).start();
    const done = await store.load("done-run");
    await createLoopRun(opts).start();
    const after = await store.load("done-run");
    expect(after).toEqual(done);
  });
});

describe("IndexedDbCheckpointStore", () => {
  it("저장·복원 왕복, 없는 runId는 null", async () => {
    globalThis.indexedDB = fakeIndexedDB;
    const store = new IndexedDbCheckpointStore<number>();
    const cp: LoopCheckpoint<number> = {
      runId: "idb-1",
      packDigest: "d",
      status: "paused",
      round: 3,
      champion: 42,
      championScore: 88,
      championViolations: ["예시 위반"],
      curve: [80, 85, 88, 88],
      tree: [
        {
          round: 1,
          candidateScore: 85,
          championScore: 85,
          adopted: true,
          gateRejected: false,
          violations: [],
        },
      ],
      provenance: [{ at: "2026-01-01T00:00:00.000Z", type: "run_started", detail: "테스트" }],
      rngState: 123456,
    };
    await store.save(cp);
    expect(await store.load("idb-1")).toEqual(cp);
    expect(await store.load("없는-run")).toBeNull();
  });

  it("엔진과 함께 pause·재개가 동작한다", async () => {
    globalThis.indexedDB = fakeIndexedDB;
    const store = new IndexedDbCheckpointStore<number>();
    let handle: LoopHandle;
    const opts: LoopRunOptions<number> = {
      runId: "idb-loop",
      pack,
      spec: makeSpec({ maxRounds: 6, seed: 11 }),
      scorer: (a) => ok(a),
      generate: (champion, rng) => champion + (rng() - 0.4),
      initial: (rng) => rng(),
      store,
      onEvent: (cp) => {
        if (cp.status === "running" && cp.round === 3) handle.pause();
      },
    };
    handle = createLoopRun(opts);
    await handle.start();
    expect((await store.load("idb-loop"))?.status).toBe("paused");

    await createLoopRun({ ...opts, onEvent: () => {} }).start();
    const final = await store.load("idb-loop");
    expect(final?.status).toBe("done");
    expect(final?.round).toBe(6);
    expect(final?.curve).toHaveLength(7);
  });
});
