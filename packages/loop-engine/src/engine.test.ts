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

  it("챔피언이 척도 상한 100점에 도달하면 즉시 조기 종료한다 (ceiling)", async () => {
    const candidates = [70, 100];
    let generated = 0;
    const events: LoopCheckpoint<number>[] = [];
    const handle = createLoopRun<number>({
      runId: "ceiling",
      pack,
      spec: makeSpec({ maxRounds: 10 }),
      scorer: (a) => ok(a),
      generate: () => candidates[generated++],
      initial: () => 40,
      store: new MemoryCheckpointStore<number>(),
      onEvent: (cp) => events.push(cp),
    });
    await handle.start();

    const last = events[events.length - 1];
    expect(last.status).toBe("done");
    expect(last.doneReason).toBe("ceiling");
    expect(last.round).toBe(2); // 100점 채택 라운드에서 멈춘다
    expect(generated).toBe(2); // 이후 generate 호출이 없다
    expect(last.curve).toEqual([40, 70, 100]);
    expect(last.provenance.some((p) => p.type === "ceiling_stop")).toBe(true);
  });

  it("라운드 0 원샷이 이미 100점이면 라운드를 돌지 않고 종료한다", async () => {
    let generateCalls = 0;
    const store = new MemoryCheckpointStore<number>();
    await createLoopRun<number>({
      runId: "ceiling-r0",
      pack,
      spec: makeSpec({ maxRounds: 10 }),
      scorer: () => ok(100),
      generate: (champion) => {
        generateCalls++;
        return champion;
      },
      initial: () => 0,
      store,
      onEvent: () => {},
    }).start();

    const final = await store.load("ceiling-r0");
    expect(final?.status).toBe("done");
    expect(final?.doneReason).toBe("ceiling");
    expect(final?.round).toBe(0);
    expect(final?.tree).toEqual([]);
    expect(generateCalls).toBe(0);
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

  it("채점 형식 오류 라운드는 0점으로 기록하지 않고 직전 체크포인트에서 재개한다", async () => {
    const store = new MemoryCheckpointStore<number>();
    let failedOnce = false;
    const opts: LoopRunOptions<number> = {
      runId: "grade-format-error",
      pack,
      spec: makeSpec({ maxRounds: 1 }),
      scorer: (artifact) => {
        if (artifact === 1 && !failedOnce) {
          failedOnce = true;
          throw new Error("채점 출력 형식 오류 — 테스트");
        }
        return ok(artifact * 10);
      },
      generate: () => 1,
      initial: () => 0,
      store,
      onEvent: () => {},
    };

    await expect(createLoopRun(opts).start()).rejects.toThrow("채점 출력 형식 오류");
    const beforeRetry = await store.load(opts.runId);
    expect(beforeRetry?.round).toBe(0);
    expect(beforeRetry?.tree).toEqual([]);
    expect(beforeRetry?.curve).toEqual([0]);

    await createLoopRun(opts).start();
    const afterRetry = await store.load(opts.runId);
    expect(afterRetry?.status).toBe("done");
    expect(afterRetry?.round).toBe(1);
    expect(afterRetry?.tree).toHaveLength(1);
    expect(afterRetry?.curve).toEqual([0, 10]);
    expect(afterRetry?.provenance.some((p) => p.type === "resumed")).toBe(true);
  });
});

describe("createLoopRun — 비동기 슬롯", () => {
  it("Promise를 반환하는 scorer·generate·initial로도 결정성과 채택이 동작한다", async () => {
    const spec = makeSpec({ maxRounds: 10, seed: 21 });
    const scorer = async (a: number): Promise<ScoreResult> => {
      await new Promise((r) => setTimeout(r, 0));
      return ok(a);
    };
    const generate = async (champion: number, rng: () => number): Promise<number> => {
      await Promise.resolve();
      return champion + (rng() * 2 - 0.9);
    };
    const initial = async (rng: () => number): Promise<number> => rng() * 10;

    // (a) 끝까지 실행 — 채택이 실제로 일어난다
    const storeA = new MemoryCheckpointStore<number>();
    await createLoopRun<number>({
      runId: "async-det",
      pack,
      spec,
      scorer,
      generate,
      initial,
      store: storeA,
      onEvent: () => {},
    }).start();
    const finalA = await storeA.load("async-det");
    expect(finalA).not.toBeNull();
    expect(finalA?.status).toBe("done");
    expect(finalA?.tree.some((r) => r.adopted)).toBe(true);
    expect(finalA!.championScore).toBeGreaterThan(finalA!.curve[0]);

    // (b) 라운드 4에서 pause 후 재개 — 곡선·챔피언이 (a)와 동일(결정성)
    const storeB = new MemoryCheckpointStore<number>();
    let handleB: LoopHandle;
    const optsB: LoopRunOptions<number> = {
      runId: "async-det",
      pack,
      spec,
      scorer,
      generate,
      initial,
      store: storeB,
      onEvent: (cp) => {
        if (cp.status === "running" && cp.round === 4) handleB.pause();
      },
    };
    handleB = createLoopRun(optsB);
    await handleB.start();
    expect((await storeB.load("async-det"))?.status).toBe("paused");

    await createLoopRun({ ...optsB, onEvent: () => {} }).start();
    const finalB = await storeB.load("async-det");
    expect(finalB?.status).toBe("done");
    expect(finalB?.curve).toEqual(finalA?.curve);
    expect(finalB?.champion).toBe(finalA?.champion);
    expect(finalB?.championScore).toBe(finalA?.championScore);
    expect(finalB?.tree.map((r) => [r.candidateScore, r.adopted])).toEqual(
      finalA?.tree.map((r) => [r.candidateScore, r.adopted]),
    );
  });
});

describe("createLoopRun — Generator 피드백", () => {
  it("generate는 매 라운드 직전 챔피언(채택 확정 후)의 score·violations를 정확히 받는다", async () => {
    // 후보별 채점 결과를 고정해 두고 라운드별 feedback을 캡처해 대조한다:
    // r1 채택(30) → r2 기각(20) → r3 게이트 기각(90) → r4 채택(55)
    const results: Record<string, ScoreResult> = {
      c0: { total: 10, violations: ["초기 위반"], parts: {}, gateRejected: false },
      c1: { total: 30, violations: ["위반 A"], parts: {}, gateRejected: false },
      c2: { total: 20, violations: ["위반 B"], parts: {}, gateRejected: false },
      c3: { total: 90, violations: ["게이트 위반"], parts: {}, gateRejected: true },
      c4: { total: 55, violations: ["위반 C"], parts: {}, gateRejected: false },
    };
    let n = 0;
    const captured: Array<{
      round: number;
      champion: string;
      score: number;
      violations: string[];
    }> = [];
    const store = new MemoryCheckpointStore<string>();
    await createLoopRun<string>({
      runId: "feedback",
      pack,
      spec: makeSpec({ maxRounds: 4 }),
      scorer: async (a) => results[a],
      generate: async (champion, _rng, feedback) => {
        captured.push({
          round: feedback.round,
          champion,
          score: feedback.championScore,
          violations: [...feedback.championViolations],
        });
        return `c${++n}`;
      },
      initial: async () => "c0",
      store,
      onEvent: () => {},
    }).start();

    expect(captured).toEqual([
      { round: 1, champion: "c0", score: 10, violations: ["초기 위반"] }, // 원샷 기준선
      { round: 2, champion: "c1", score: 30, violations: ["위반 A"] }, // r1 채택 반영
      { round: 3, champion: "c1", score: 30, violations: ["위반 A"] }, // r2 기각 → 유지
      { round: 4, champion: "c1", score: 30, violations: ["위반 A"] }, // r3 게이트 기각 → 유지
    ]);

    const final = await store.load("feedback");
    expect(final?.champion).toBe("c4");
    expect(final?.championScore).toBe(55);
    expect(final?.championViolations).toEqual(["위반 C"]);
    expect(final?.curve).toEqual([10, 30, 30, 30, 55]);
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
