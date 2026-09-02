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
    exemptions: { examinerReport: "-", pairwise: "-" },
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

  it("검증 가드가 퇴보한 후보는 스칼라가 높아도 기각한다 (seeded_split)", async () => {
    const guardedPack: EvaluationPack = {
      ...pack,
      holdoutPolicy: {
        mode: "seeded_split",
        note: "-",
        guardCaseIds: ["g1"],
        holdoutCaseIds: ["h1"],
        guardTolerance: 5,
      },
    };
    const events: LoopCheckpoint<number>[] = [];
    const handle = createLoopRun<number>({
      runId: "guard-drop",
      pack: guardedPack,
      spec: makeSpec({ maxRounds: 3 }),
      // 챔피언(0): 10점/가드 60 — 후보: 99점/가드 40 → 허용 오차 5를 넘는 퇴보라 기각
      scorer: (a) => (a === 0 ? { ...ok(10), guardScore: 60 } : { ...ok(99), guardScore: 40 }),
      generate: (champion) => champion + 1,
      initial: () => 0,
      store: new MemoryCheckpointStore<number>(),
      onEvent: (cp) => events.push(cp),
    });
    await handle.start();

    const last = events[events.length - 1];
    expect(last.champion).toBe(0);
    expect(last.championScore).toBe(10);
    expect(last.championGuardScore).toBe(60);
    expect(last.guardCurve).toEqual([60, 60, 60, 60]);
    for (const record of last.tree) {
      expect(record.guardSafe).toBe(false);
      expect(record.adopted).toBe(false);
      expect(record.candidateGuardScore).toBe(40);
    }
  });

  it("가드가 허용 오차 안에서 내려간 후보는 채택한다", async () => {
    const guardedPack: EvaluationPack = {
      ...pack,
      holdoutPolicy: {
        mode: "seeded_split",
        note: "-",
        guardCaseIds: ["g1"],
        holdoutCaseIds: ["h1"],
        guardTolerance: 5,
      },
    };
    const events: LoopCheckpoint<number>[] = [];
    const handle = createLoopRun<number>({
      runId: "guard-tolerance",
      pack: guardedPack,
      spec: makeSpec({ maxRounds: 1 }),
      scorer: (a) => (a === 0 ? { ...ok(10), guardScore: 60 } : { ...ok(50), guardScore: 56 }),
      generate: (champion) => champion + 1,
      initial: () => 0,
      store: new MemoryCheckpointStore<number>(),
      onEvent: (cp) => events.push(cp),
    });
    await handle.start();

    const last = events[events.length - 1];
    expect(last.champion).toBe(1);
    expect(last.championScore).toBe(50);
    expect(last.championGuardScore).toBe(56);
    expect(last.guardCurve).toEqual([60, 56]);
    expect(last.tree[0].guardSafe).toBe(true);
    expect(last.tree[0].adopted).toBe(true);
  });

  // 실측(bb88db60·019e41b9): 가드 6문항에서 챔피언이 91.7에 앉으면 반 단계 하나 내려간
  // 후보(83.3)가 `91.7 - 8.4 = 58.3...004` 식의 이진 오차로 기각되어 실행이 얼어붙었다.
  it("경계에 정확히 걸친 후보는 이진 오차로 기각되지 않는다", async () => {
    const guardedPack: EvaluationPack = {
      ...pack,
      holdoutPolicy: {
        mode: "seeded_split",
        note: "-",
        guardCaseIds: ["g1"],
        holdoutCaseIds: ["h1"],
        guardTolerance: 8.4,
      },
    };
    const events: LoopCheckpoint<number>[] = [];
    const handle = createLoopRun<number>({
      runId: "guard-boundary",
      pack: guardedPack,
      spec: makeSpec({ maxRounds: 1 }),
      // 66.7 - 8.4 는 이진에서 58.300000000000004 — 후보 58.3이 경계에 정확히 걸린다
      scorer: (a) => (a === 0 ? { ...ok(10), guardScore: 66.7 } : { ...ok(90), guardScore: 58.3 }),
      generate: (champion) => champion + 1,
      initial: () => 0,
      store: new MemoryCheckpointStore<number>(),
      onEvent: (cp) => events.push(cp),
    });
    await handle.start();

    const last = events[events.length - 1];
    expect(last.tree[0].guardSafe).toBe(true);
    expect(last.tree[0].adopted).toBe(true);
    expect(last.championScore).toBe(90);
  });

  it("여유는 반 단계까지다 — 두 단계 내려간 후보는 그대로 기각한다", async () => {
    const guardedPack: EvaluationPack = {
      ...pack,
      holdoutPolicy: {
        mode: "seeded_split",
        note: "-",
        guardCaseIds: ["g1"],
        holdoutCaseIds: ["h1"],
        guardTolerance: 8.4,
      },
    };
    const events: LoopCheckpoint<number>[] = [];
    const handle = createLoopRun<number>({
      runId: "guard-two-steps",
      pack: guardedPack,
      spec: makeSpec({ maxRounds: 1 }),
      // 91.7 → 75 는 두 단계(16.7) — 스칼라가 훨씬 높아도 기각되어야 한다
      scorer: (a) => (a === 0 ? { ...ok(10), guardScore: 91.7 } : { ...ok(95), guardScore: 75 }),
      generate: (champion) => champion + 1,
      initial: () => 0,
      store: new MemoryCheckpointStore<number>(),
      onEvent: (cp) => events.push(cp),
    });
    await handle.start();

    const last = events[events.length - 1];
    expect(last.tree[0].guardSafe).toBe(false);
    expect(last.tree[0].adopted).toBe(false);
    expect(last.championScore).toBe(10);
  });

  it("가드 미구성(scorer가 guardScore를 주지 않음)이면 채택 판정이 기존과 같다", async () => {
    const events: LoopCheckpoint<number>[] = [];
    const handle = createLoopRun<number>({
      runId: "guard-absent",
      pack,
      spec: makeSpec({ maxRounds: 1 }),
      scorer: (a) => ok(a === 0 ? 10 : 50),
      generate: (champion) => champion + 1,
      initial: () => 0,
      store: new MemoryCheckpointStore<number>(),
      onEvent: (cp) => events.push(cp),
    });
    await handle.start();

    const last = events[events.length - 1];
    expect(last.tree[0].adopted).toBe(true);
    expect(last.championGuardScore).toBeNull();
    expect(last.guardCurve).toEqual([null, null]);
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
    // 실패한 라운드는 회차·곡선·tree에 남지 않고, 사유를 단 채 일시정지로 저장된다
    expect(beforeRetry?.status).toBe("paused");
    expect(beforeRetry?.round).toBe(0);
    expect(beforeRetry?.tree).toEqual([]);
    expect(beforeRetry?.curve).toEqual([0]);
    const errorNote = beforeRetry?.provenance.find((p) => p.type === "error");
    expect(errorNote?.detail).toContain("라운드 1 실패");
    expect(errorNote?.detail).toContain("채점 출력 형식 오류");

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

  it("새 피드백 모드는 직전 공개 기각 사유를 다음 생성에 전달한다", async () => {
    const results: Record<string, ScoreResult> = {
      c0: { total: 10, violations: ["초기 위반"], parts: {}, gateRejected: false },
      c1: { total: 5, violations: ["질문 A 악화"], parts: {}, gateRejected: false },
      c2: { total: 6, violations: ["질문 B 악화"], parts: {}, gateRejected: false },
    };
    const captured: Array<unknown> = [];
    let n = 0;
    const store = new MemoryCheckpointStore<string>();

    await createLoopRun<string>({
      runId: "public-rejection-feedback",
      pack,
      spec: makeSpec({
        maxRounds: 2,
        feedbackMode: "champion_and_last_public_rejection",
      }),
      scorer: (artifact) => results[artifact],
      generate: (_champion, _rng, feedback) => {
        captured.push(feedback.previousPublicAttempt);
        return `c${++n}`;
      },
      initial: () => "c0",
      store,
      onEvent: () => {},
    }).start();

    expect(captured).toEqual([
      undefined,
      {
        candidateScore: 5,
        scoreDelta: -5,
        gateRejected: false,
        violations: ["질문 A 악화"],
      },
    ]);
  });

  it("가드에서 기각된 후보의 점수·트레이스는 다음 생성 피드백에 싣지 않는다", async () => {
    const guardedPack: EvaluationPack = {
      ...pack,
      holdoutPolicy: {
        mode: "seeded_split",
        note: "-",
        guardCaseIds: ["guard-1"],
        holdoutCaseIds: ["holdout-1"],
        guardTolerance: 5,
      },
    };
    const results: Record<string, ScoreResult> = {
      c0: {
        total: 10,
        violations: ["초기 공개 위반"],
        parts: {},
        gateRejected: false,
        guardScore: 60,
      },
      c1: {
        total: 99,
        violations: ["후보 공개 트레이스"],
        parts: {},
        gateRejected: false,
        guardScore: 0,
      },
      c2: {
        total: 9,
        violations: [],
        parts: {},
        gateRejected: false,
        guardScore: 60,
      },
    };
    const captured: Array<unknown> = [];
    let n = 0;

    await createLoopRun<string>({
      runId: "guard-feedback-isolation",
      pack: guardedPack,
      spec: makeSpec({
        maxRounds: 2,
        feedbackMode: "champion_and_last_public_rejection",
      }),
      scorer: (artifact) => results[artifact],
      generate: (_champion, _rng, feedback) => {
        captured.push(feedback.previousPublicAttempt);
        return `c${++n}`;
      },
      initial: () => "c0",
      store: new MemoryCheckpointStore<string>(),
      onEvent: () => {},
    }).start();

    expect(captured).toEqual([undefined, undefined]);
  });

  it("최근 공개 실험 3개와 반복 실패 전략을 전달하되 가드 기각 시도는 통째로 제외한다", async () => {
    const guardedPack: EvaluationPack = {
      ...pack,
      holdoutPolicy: {
        mode: "seeded_split",
        note: "-",
        guardCaseIds: ["guard-1"],
        holdoutCaseIds: ["holdout-1"],
        guardTolerance: 5,
      },
    };
    const results: Record<string, ScoreResult> = {
      c0: { ...ok(10), guardScore: 60 },
      c1: { ...ok(5), violations: ["공개 실패 A"], guardScore: 60 },
      c2: { ...ok(6), violations: ["공개 실패 B"], guardScore: 60 },
      // 공개 점수는 높지만 가드에서 기각 — 다음 공개 실험 기억에 흔적을 남기면 안 된다.
      c3: { ...ok(99), violations: ["숨겨야 할 후보 흔적"], guardScore: 0 },
      c4: { ...ok(7), violations: ["공개 실패 C"], guardScore: 60 },
      c5: { ...ok(8), violations: ["공개 실패 D"], guardScore: 60 },
      c6: { ...ok(9), violations: ["공개 실패 E"], guardScore: 60 },
    };
    const strategyKeys = [
      "targeted_repair",
      "targeted_repair",
      "restructure_for_retrieval",
      "compress_and_reallocate",
      "source_regrounding",
      "consistency_pass",
    ];
    const captured: Array<{
      recent: unknown;
      blocked: unknown;
    }> = [];
    const generatedWith: string[] = [];
    let n = 0;
    let planAt = 0;
    const store = new MemoryCheckpointStore<string>();

    await createLoopRun<string>({
      runId: "public-experiment-memory",
      pack: guardedPack,
      spec: makeSpec({ maxRounds: 6, feedbackMode: "recent_public_experiments_v1" }),
      scorer: (artifact) => results[artifact],
      planStrategy: (_champion, _rng, feedback) => {
        captured.push({
          recent: structuredClone(feedback.recentPublicExperiments),
          blocked: structuredClone(feedback.blockedStrategyKeys),
        });
        const key = strategyKeys[planAt++];
        return { key, summary: `${key} 실행` };
      },
      generate: (_champion, _rng, _feedback, strategy) => {
        generatedWith.push(strategy?.key ?? "none");
        return `c${++n}`;
      },
      initial: () => "c0",
      store,
      onEvent: () => {},
    }).start();

    expect(captured[0]).toEqual({ recent: [], blocked: [] });
    expect(captured[2].blocked).toEqual(["targeted_repair"]);
    expect(captured[2].recent).toEqual([
      expect.objectContaining({ round: 1, scoreDelta: -5, adopted: false }),
      expect.objectContaining({ round: 2, scoreDelta: -4, adopted: false }),
    ]);
    // 3회차는 가드 기각이므로 4회차 기억에도 점수·전략·실패 사유가 나타나지 않는다.
    expect(JSON.stringify(captured[3])).not.toContain("99");
    expect(JSON.stringify(captured[3])).not.toContain("숨겨야 할 후보 흔적");
    expect(JSON.stringify(captured[3])).not.toContain("restructure_for_retrieval");
    expect(captured[3].blocked).toEqual(["targeted_repair"]);
    // 공개 실험이 3개를 넘으면 오래된 기록부터 빠진다. 가드 기각 3회차는 여전히 없다.
    expect((captured[5].recent as Array<{ round: number }>).map((record) => record.round)).toEqual([
      2,
      4,
      5,
    ]);
    expect(captured[5].blocked).toEqual([]);
    expect(generatedWith).toEqual(strategyKeys);

    const final = await store.load("public-experiment-memory");
    expect(final?.tree.map((record) => record.strategy?.key)).toEqual(strategyKeys);
  });

  it("차단된 전략을 거듭 선택하면 한 번 더 고르게 한 뒤 전략 없이 생성한다 — 실행은 계속된다", async () => {
    const events: LoopCheckpoint<string>[] = [];
    const strategiesSeen: Array<string | undefined> = [];
    let plans = 0;
    let n = 0;
    await createLoopRun<string>({
      runId: "blocked-strategy-fallback",
      pack,
      spec: makeSpec({ maxRounds: 3, feedbackMode: "recent_public_experiments_v1" }),
      scorer: (artifact) => artifact === "c0" ? ok(10) : ok(5),
      planStrategy: () => {
        plans += 1;
        return { key: "targeted_repair", summary: "같은 전략" };
      },
      generate: (_champ, _rng, _feedback, strategy) => {
        strategiesSeen.push(strategy?.key);
        return `c${++n}`;
      },
      initial: () => "c0",
      store: new MemoryCheckpointStore<string>(),
      onEvent: (cp) => events.push(cp),
    }).start();

    const last = events[events.length - 1];
    expect(last.status).toBe("done");
    expect(last.tree).toHaveLength(3);
    // 두 번 기각된 뒤 3라운드: 재계획 1회(총 4회 계획) 후 전략 없이 생성
    expect(plans).toBe(4);
    expect(strategiesSeen).toEqual(["targeted_repair", "targeted_repair", undefined]);
    expect(last.tree[2].strategy).toBeUndefined();
    expect(
      last.provenance.some((p) => p.type === "round" && p.detail.includes("전략 없이 생성")),
    ).toBe(true);
  });

  it("차단된 전략이라도 재계획에서 다른 전략을 내면 그 전략으로 생성한다", async () => {
    const strategiesSeen: Array<string | undefined> = [];
    let plans = 0;
    let n = 0;
    await createLoopRun<string>({
      runId: "blocked-strategy-replan",
      pack,
      spec: makeSpec({ maxRounds: 3, feedbackMode: "recent_public_experiments_v1" }),
      scorer: (artifact) => artifact === "c0" ? ok(10) : ok(5),
      planStrategy: () => {
        plans += 1;
        return plans === 4
          ? { key: "restructure", summary: "다른 전략" }
          : { key: "targeted_repair", summary: "같은 전략" };
      },
      generate: (_champ, _rng, _feedback, strategy) => {
        strategiesSeen.push(strategy?.key);
        return `c${++n}`;
      },
      initial: () => "c0",
      store: new MemoryCheckpointStore<string>(),
      onEvent: () => {},
    }).start();
    expect(strategiesSeen).toEqual(["targeted_repair", "targeted_repair", "restructure"]);
  });

  it("생성 단계 오류도 회차를 소모하지 않고 일시정지로 저장한 뒤 재개할 수 있다", async () => {
    const store = new MemoryCheckpointStore<number>();
    let failOnce = true;
    const opts: LoopRunOptions<number> = {
      runId: "generate-error",
      pack,
      spec: makeSpec({ maxRounds: 2 }),
      scorer: (artifact) => ok(artifact * 10),
      generate: (champion) => {
        if (failOnce) {
          failOnce = false;
          throw new Error("모델 호출 시간 초과 — 테스트");
        }
        return champion + 1;
      },
      initial: () => 0,
      store,
      onEvent: () => {},
    };
    await expect(createLoopRun(opts).start()).rejects.toThrow("모델 호출 시간 초과");
    const paused = await store.load(opts.runId);
    expect(paused?.status).toBe("paused");
    expect(paused?.round).toBe(0);

    await createLoopRun(opts).start();
    const done = await store.load(opts.runId);
    expect(done?.status).toBe("done");
    expect(done?.round).toBe(2);
    expect(done?.curve).toEqual([0, 10, 20]);
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
      championGuardScore: null,
      curve: [80, 85, 88, 88],
      guardCurve: [null, null, null, null],
      tree: [
        {
          round: 1,
          candidateScore: 85,
          championScore: 85,
          adopted: true,
          gateRejected: false,
          violations: [],
          candidateGuardScore: null,
          guardSafe: true,
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
