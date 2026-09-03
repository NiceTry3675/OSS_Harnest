/** 실행 오케스트레이션 회귀 테스트 — 화면 이탈과 무관한 단일 핸들, 홀드아웃 시점·귀속·중복 방지. */

import { describe, expect, it } from "vitest";
import type { EvaluationPack, HoldoutEvaluation, HoldoutScores, LoopCheckpoint, LoopSpec } from "@harnest/contracts";
import { CheckpointSaveError, MemoryCheckpointStore } from "@harnest/loop-engine";
import type { TemplateRuntime } from "../templates";
import { createRunController, type RunSink } from "./runController";
import { readOnlyGuardedStore } from "./readOnlyCheckpointStore";

const pack: EvaluationPack = {
  packVersion: "skeleton-1",
  templateId: "handover",
  criteria: [],
  gates: [],
  judgeProcedure: {
    kind: "case_answering",
    judge: { provider: "mock", model: "모의 모델" },
    pairwiseNotice: "-",
  },
  holdoutPolicy: {
    mode: "seeded_split",
    note: "-",
    guardCaseIds: ["case-2"],
    holdoutCaseIds: ["case-1"],
    guardTolerance: 4.2,
  },
  definitionDigest: "a".repeat(64),
};
const spec: LoopSpec = { maxRounds: 3, plateauRounds: 9, adoptionRule: "scalar_strict", seed: 1 };
const RUN = "run-1";

const evaluation = (score: number): HoldoutEvaluation => ({
  gateRejected: false,
  score,
  perCase: [],
  violations: [],
});

/** Provider 대역 — 귀속(runId·digest)이 맞는 갱신만 받는다. runId는 프로젝트가 다른 실행으로
 *  넘어가는 상황을 흉내 내기 위해 바꿀 수 있고, readOnly는 잠금 없는 탭(채점 시작 금지)을 흉내 낸다. */
function fakeSink(initialRunId = RUN, digest = pack.definitionDigest) {
  let runId = initialRunId;
  let readOnly = false;
  const checkpoints: LoopCheckpoint<unknown>[] = [];
  let holdout: HoldoutScores = { baseline: null, final: null, errors: { baseline: null, final: null } };
  const rejected: string[] = [];
  const sink: RunSink = {
    onCheckpoint: (cp) => {
      if (cp.runId === runId && cp.packDigest === digest) checkpoints.push(cp);
    },
    updateHoldout: (r, d, update) => {
      if (r !== runId || d !== digest) {
        rejected.push(`${r}/${d.slice(0, 4)}`);
        return;
      }
      holdout = update(holdout);
    },
    getHoldout: (r, d) => (!readOnly && r === runId && d === digest ? holdout : null),
  };
  return {
    sink,
    checkpoints,
    rejected,
    holdout: () => holdout,
    setRunId: (id: string) => {
      runId = id;
    },
    setReadOnly: (value: boolean) => {
      readOnly = value;
    },
  };
}

/** 정수 산출물 — 점수는 값 그대로. gate/holdout 호출 수를 센다 */
function fakeRuntime(opts: {
  initialScore?: number;
  holdoutScore?: number;
  holdoutFails?: boolean;
  onGenerate?: (round: number) => void;
} = {}): TemplateRuntime & { holdoutCalls: number[] } {
  const initialScore = opts.initialScore ?? 10;
  const runtime: TemplateRuntime & { holdoutCalls: number[] } = {
    holdoutCalls: [],
    scorer: (artifact) => ({
      total: artifact as number,
      violations: [],
      parts: {},
      gateRejected: false,
    }),
    generate: (champion) => (champion as number) + 5,
    initial: () => initialScore,
    scoreHoldout: async (artifact) => {
      runtime.holdoutCalls.push(artifact as number);
      await new Promise((r) => setTimeout(r, 0));
      if (opts.holdoutFails) throw new Error("채점 실패");
      return evaluation(opts.holdoutScore ?? (artifact as number));
    },
    callsPerRound: 4,
    maxCallsPerRun: 40,
    roundDelayMs: 0,
  };
  return runtime;
}

const flush = () => new Promise((r) => setTimeout(r, 5));

describe("createRunController", () => {
  it("같은 runId+packDigest에는 핸들을 하나만 만들고, 진행 중 두 번째 start()는 no-op이다", async () => {
    const { sink, checkpoints } = fakeSink();
    const controller = createRunController(sink);
    const store = new MemoryCheckpointStore<unknown>();
    const runtime = fakeRuntime();
    const params = { runId: RUN, pack, spec, store, build: () => runtime };

    const first = controller.ensure(params);
    // 화면 이탈 → 재진입: 같은 세션을 돌려받는다(새 핸들·새 런타임 없음)
    let builds = 0;
    const again = controller.ensure({ ...params, build: () => (builds++, runtime) });
    expect(again).toBe(first);
    expect(builds).toBe(0);

    const running = controller.start(RUN, pack.definitionDigest);
    expect(controller.get(RUN, pack.definitionDigest)?.active).toBe(true);
    expect(controller.anyActive()).toBe(true);
    await controller.start(RUN, pack.definitionDigest); // 이중 클릭 — 즉시 끝난다
    await running;
    await flush();

    const view = controller.get(RUN, pack.definitionDigest)!;
    expect(view.active).toBe(false);
    expect(view.error).toBeNull();
    expect(view.callsPerRound).toBe(4);
    const done = await store.load(RUN);
    expect(done?.status).toBe("done");
    expect(done?.round).toBe(3);
    // 라운드가 두 번 돈 흔적이 없다 — 회차 기록은 1·2·3 한 번씩
    expect(done?.tree.map((r) => r.round)).toEqual([1, 2, 3]);
    expect(checkpoints.at(-1)?.status).toBe("done");
  });

  it("홀드아웃은 라운드 0과 종료 시에만 한 번씩 채점하고 결과는 runId·digest로 귀속된다", async () => {
    const { sink, holdout } = fakeSink();
    const controller = createRunController(sink);
    const runtime = fakeRuntime();
    controller.ensure({ runId: RUN, pack, spec, store: new MemoryCheckpointStore(), build: () => runtime });
    await controller.start(RUN, pack.definitionDigest);
    await flush();

    expect(runtime.holdoutCalls).toEqual([10, 25]);
    expect(holdout().baseline?.score).toBe(10);
    expect(holdout().final?.score).toBe(25);
    expect(holdout().errors).toEqual({ baseline: null, final: null });
  });

  it("라운드 0에서 상한 종료되면 같은 산출물을 두 번 재지 않고 시작·종료에 같은 결과를 쓴다", async () => {
    const { sink, holdout } = fakeSink();
    const controller = createRunController(sink);
    const runtime = fakeRuntime({ initialScore: 100 });
    controller.ensure({ runId: RUN, pack, spec, store: new MemoryCheckpointStore(), build: () => runtime });
    await controller.start(RUN, pack.definitionDigest);
    await flush();

    expect(runtime.holdoutCalls).toEqual([100]);
    expect(holdout().baseline?.score).toBe(100);
    expect(holdout().final).toBe(holdout().baseline);
  });

  it("복구 경로: 라운드 0 완료본에 시작 결과가 이미 있으면 호출 없이 종료 단계에 복사한다", async () => {
    const store = new MemoryCheckpointStore<unknown>();
    const doneAtZero: LoopCheckpoint<unknown> = {
      runId: RUN,
      packDigest: pack.definitionDigest,
      status: "done",
      doneReason: "ceiling",
      round: 0,
      champion: 100,
      championScore: 100,
      championViolations: [],
      championGuardScore: null,
      curve: [100],
      guardCurve: [null],
      tree: [],
      provenance: [],
      rngState: 1,
    };
    await store.save(doneAtZero);
    const { sink, holdout } = fakeSink();
    sink.updateHoldout(RUN, pack.definitionDigest, (prev) => ({ ...prev, baseline: evaluation(77) }));
    const controller = createRunController(sink);
    const runtime = fakeRuntime();
    controller.ensure({ runId: RUN, pack, spec, store, build: () => runtime });
    await flush();

    expect(runtime.holdoutCalls).toEqual([]);
    expect(holdout().final?.score).toBe(77);
  });

  it("복구 경로: 완료본의 종료 단계가 비어 있으면 저장된 챔피언으로 한 번 채점한다", async () => {
    const store = new MemoryCheckpointStore<unknown>();
    await store.save({
      runId: RUN,
      packDigest: pack.definitionDigest,
      status: "done",
      doneReason: "max_rounds",
      round: 2,
      champion: 20,
      championScore: 20,
      championViolations: [],
      championGuardScore: null,
      curve: [10, 15, 20],
      guardCurve: [null, null, null],
      tree: [],
      provenance: [],
      rngState: 1,
    });
    const { sink, holdout } = fakeSink();
    // 지나간 시작 단계는 복원 불가로 확정된 상태(하이드레이션이 기록)
    sink.updateHoldout(RUN, pack.definitionDigest, (prev) => ({
      ...prev,
      errors: { baseline: "복원할 수 없습니다", final: null },
    }));
    const controller = createRunController(sink);
    const runtime = fakeRuntime();
    controller.ensure({ runId: RUN, pack, spec, store, build: () => runtime });
    await flush();

    expect(runtime.holdoutCalls).toEqual([20]);
    expect(holdout().final?.score).toBe(20);
    expect(holdout().errors?.baseline).toBe("복원할 수 없습니다");
  });

  it("채점 실패는 단계별 실패 사유로 남는다", async () => {
    const { sink, holdout } = fakeSink();
    const controller = createRunController(sink);
    const runtime = fakeRuntime({ holdoutFails: true });
    controller.ensure({ runId: RUN, pack, spec, store: new MemoryCheckpointStore(), build: () => runtime });
    await controller.start(RUN, pack.definitionDigest);
    await flush();
    expect(holdout().errors).toEqual({ baseline: "채점 실패", final: "채점 실패" });
  });

  it("프로젝트가 다른 실행을 보고 있으면(getHoldout null) 채점을 시작조차 하지 않는다", async () => {
    const other = fakeSink("run-2");
    const c2 = createRunController(other.sink);
    const r2 = fakeRuntime();
    c2.ensure({ runId: RUN, pack, spec, store: new MemoryCheckpointStore(), build: () => r2 });
    await c2.start(RUN, pack.definitionDigest);
    await flush();
    expect(r2.holdoutCalls).toEqual([]);
    expect(other.holdout()).toEqual({ baseline: null, final: null, errors: { baseline: null, final: null } });
    expect(other.checkpoints).toEqual([]);
    expect(other.rejected).toEqual([]);
  });

  it("채점 도중 프로젝트가 다른 실행으로 넘어가면 늦게 도착한 결과는 귀속 거부로 버려진다", async () => {
    const project = fakeSink();
    const controller = createRunController(project.sink);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runtime: TemplateRuntime & { holdoutCalls: number[] } = {
      ...fakeRuntime(),
      holdoutCalls: [],
      scoreHoldout: async (artifact) => {
        runtime.holdoutCalls.push(artifact as number);
        await gate; // 결과는 프로젝트가 바뀐 뒤에 도착한다
        return evaluation(artifact as number);
      },
    };
    controller.ensure({ runId: RUN, pack, spec, store: new MemoryCheckpointStore(), build: () => runtime });
    await controller.start(RUN, pack.definitionDigest);
    // 시작·종료 채점이 모두 시작됐지만 아직 결과가 없다
    expect(runtime.holdoutCalls).toEqual([10, 25]);
    expect(project.holdout()).toEqual({ baseline: null, final: null, errors: { baseline: null, final: null } });

    project.setRunId("run-2"); // 재컴파일·초기화로 프로젝트가 다른 실행을 본다
    release();
    await flush();
    // 두 결과 모두 귀속 거부 — 새 프로젝트의 홀드아웃은 손대지 않는다
    expect(project.rejected).toEqual([`${RUN}/aaaa`, `${RUN}/aaaa`]);
    expect(project.holdout()).toEqual({ baseline: null, final: null, errors: { baseline: null, final: null } });
  });

  it("getHoldout이 null이면(읽기 전용 탭) done 복구 통지에서도 scoreHoldout을 호출하지 않는다", async () => {
    const store = new MemoryCheckpointStore<unknown>();
    await store.save({
      runId: RUN,
      packDigest: pack.definitionDigest,
      status: "done",
      doneReason: "max_rounds",
      round: 2,
      champion: 20,
      championScore: 20,
      championViolations: [],
      championGuardScore: null,
      curve: [10, 15, 20],
      guardCurve: [null, null, null],
      tree: [],
      provenance: [],
      rngState: 1,
    });
    const project = fakeSink();
    project.setReadOnly(true);
    const controller = createRunController(project.sink);
    const runtime = fakeRuntime();
    controller.ensure({ runId: RUN, pack, spec, store, build: () => runtime });
    await flush();
    // 표시는 저장본으로 하고, 소유 탭이 돌리고 있을 종료 채점을 이 탭이 한 번 더 내지 않는다
    expect(runtime.holdoutCalls).toEqual([]);
    expect(project.checkpoints.at(-1)?.status).toBe("done");
    expect(project.holdout().final).toBeNull();
    expect(project.holdout().errors).toEqual({ baseline: null, final: null });
  });

  it("라운드 0 실패 뒤 세션은 원샷 보유 여부(pendingInitial)를 알린다 — 화면이 재시도 비용 안내를 가른다", async () => {
    // 채점 실패: 원샷은 남는다
    const scoredFails = fakeSink();
    const c1 = createRunController(scoredFails.sink);
    let failScore = true;
    const r1: TemplateRuntime = {
      ...fakeRuntime(),
      scorer: (artifact) => {
        if (failScore) {
          failScore = false;
          throw new Error("채점 형식 오류");
        }
        return { total: artifact as number, violations: [], parts: {}, gateRejected: false };
      },
    };
    c1.ensure({ runId: RUN, pack, spec, store: new MemoryCheckpointStore(), build: () => r1 });
    await c1.start(RUN, pack.definitionDigest);
    expect(c1.get(RUN, pack.definitionDigest)?.error).toBeInstanceOf(Error);
    expect(c1.get(RUN, pack.definitionDigest)?.pendingInitial).toBe(true);
    await c1.start(RUN, pack.definitionDigest);
    expect(c1.get(RUN, pack.definitionDigest)?.pendingInitial).toBe(false);

    // 원샷 생성 실패: 남는 것이 없다
    const initialFails = fakeSink();
    const c2 = createRunController(initialFails.sink);
    const r2: TemplateRuntime = {
      ...fakeRuntime(),
      initial: () => {
        throw new Error("생성 호출 실패");
      },
    };
    c2.ensure({ runId: RUN, pack, spec, store: new MemoryCheckpointStore(), build: () => r2 });
    await c2.start(RUN, pack.definitionDigest);
    expect(c2.get(RUN, pack.definitionDigest)?.error).toBeInstanceOf(Error);
    expect(c2.get(RUN, pack.definitionDigest)?.pendingInitial).toBe(false);
  });

  it("dropExcept는 다른 runId의 세션을 정지시켜 버리고 살아 있는 세션 수를 줄인다", async () => {
    const { sink, checkpoints } = fakeSink();
    const controller = createRunController(sink);
    const store = new MemoryCheckpointStore<unknown>();
    let generated = 0;
    const runtime: TemplateRuntime = {
      ...fakeRuntime(),
      generate: async (champion) => {
        generated += 1;
        await new Promise((r) => setTimeout(r, 2));
        return (champion as number) + 5;
      },
    };
    const narrated: number[] = [];
    controller.ensure({
      runId: RUN,
      pack,
      spec,
      store,
      build: () => runtime,
      narrate: (cp) => narrated.push(cp.round),
    });
    const running = controller.start(RUN, pack.definitionDigest);
    await new Promise((r) => setTimeout(r, 1));
    expect(narrated).toEqual([0]);
    controller.dropExcept("run-other");
    expect(controller.get(RUN, pack.definitionDigest)).toBeNull();
    await running;
    await flush();
    // 진행 중이던 라운드 하나만 마치고 멈췄다
    expect(generated).toBe(1);
    expect((await store.load(RUN))?.status).toBe("paused");
    expect(controller.anyActive()).toBe(false);
    // 버려진 세션이 마친 라운드는 활동 콘솔에 서술되지 않고 체크포인트 통지도 나가지 않는다 —
    // 귀속 검사는 sink뿐 아니라 narrate 경로에도 적용된다
    expect(narrated).toEqual([0]);
    expect(checkpoints.map((cp) => cp.round)).toEqual([0]);
  });

  it("라운드 도중 읽기 전용이 된 탭은 그 라운드를 마쳐도 체크포인트를 쓰지 않는다(소유 탭과 번갈아 커밋 금지)", async () => {
    const project = fakeSink();
    const controller = createRunController(project.sink);
    const base = new MemoryCheckpointStore<unknown>();
    const saves: Array<{ round: number; status: string }> = [];
    const spied = {
      save: async (cp: LoopCheckpoint<unknown>) => {
        saves.push({ round: cp.round, status: cp.status });
        await base.save(cp);
      },
      load: (runId: string) => base.load(runId),
    };
    let readOnly = false;
    const store = readOnlyGuardedStore(spied, () => readOnly);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runtime: TemplateRuntime = {
      ...fakeRuntime(),
      generate: async (champion) => {
        await gate; // 라운드 1 생성 도중 다른 탭이 소유권을 가져간다
        return (champion as number) + 5;
      },
    };
    controller.ensure({ runId: RUN, pack, spec, store, build: () => runtime });
    const running = controller.start(RUN, pack.definitionDigest);
    await flush();
    expect(saves).toEqual([{ round: 0, status: "running" }]);

    // 스냅샷 충돌 → 읽기 전용 전환과 세션 폐기(state.tsx의 becomeReadOnly + dropExcept(null))
    readOnly = true;
    project.setReadOnly(true);
    controller.dropExcept(null);
    release();
    await running;
    await flush();
    // 진행 중이던 라운드 1의 결과도, pause 커밋도 저장소에 닿지 않았다
    expect(saves).toEqual([{ round: 0, status: "running" }]);
    expect((await base.load(RUN))?.round).toBe(0);
    expect(project.checkpoints.map((cp) => cp.round)).toEqual([0]);
    expect(controller.anyActive()).toBe(false);
  });

  it("체크포인트 저장 실패는 세션 오류로 남아 화면이 모델 오류와 구분할 수 있다", async () => {
    const { sink } = fakeSink();
    const controller = createRunController(sink);
    const base = new MemoryCheckpointStore<unknown>();
    let failOnce = true;
    const flaky = {
      save: async (cp: LoopCheckpoint<unknown>) => {
        if (failOnce && cp.round === 1) {
          failOnce = false;
          throw new Error("QuotaExceededError");
        }
        await base.save(cp);
      },
      load: (runId: string) => base.load(runId),
    };
    controller.ensure({ runId: RUN, pack, spec, store: flaky, build: () => fakeRuntime() });
    await controller.start(RUN, pack.definitionDigest);
    const failed = controller.get(RUN, pack.definitionDigest)!;
    expect(failed.error).toBeInstanceOf(CheckpointSaveError);
    expect(failed.active).toBe(false);
    // 같은 핸들로 다시 시작하면 마지막 저장 회차부터 이어져 완주한다
    await controller.start(RUN, pack.definitionDigest);
    expect(controller.get(RUN, pack.definitionDigest)?.error).toBeNull();
    expect((await base.load(RUN))?.status).toBe("done");
  });

  it("구독자는 활성 전이마다 통지를 받는다", async () => {
    const { sink } = fakeSink();
    const controller = createRunController(sink);
    let ticks = 0;
    const off = controller.subscribe(() => (ticks += 1));
    controller.ensure({ runId: RUN, pack, spec, store: new MemoryCheckpointStore(), build: () => fakeRuntime() });
    const beforeStart = ticks;
    await controller.start(RUN, pack.definitionDigest);
    expect(ticks - beforeStart).toBeGreaterThanOrEqual(2);
    off();
    const after = ticks;
    controller.dropExcept(null);
    expect(ticks).toBe(after);
  });
});
