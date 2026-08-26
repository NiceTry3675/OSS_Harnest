/** 루프 엔진 구현 — 계약은 ./index.ts 문서 주석 (SPEC §5.1.1).
 *  엔진은 scorer/pack을 수정할 어떤 경로도 갖지 않는다: 옵션으로 받은 함수를 호출만 한다. */

import {
  SCORE_CEILING,
  type ExperimentStrategy,
  type LoopCheckpoint,
  type ProvenanceType,
} from "@harnest/contracts";
import type {
  GeneratorFeedback,
  LoopHandle,
  LoopRunOptions,
  PublicExperimentFeedback,
} from "./index";

export const PUBLIC_EXPERIMENT_MEMORY_LIMIT = 3;
export const REPEATED_STRATEGY_FAILURE_LIMIT = 2;

/** 가드 비퇴보 비교의 이진 표현 여유.
 *
 *  가드 점수와 허용 오차는 모두 소수 첫째 자리의 십진값인데, 이진 부동소수점에서는
 *  `66.7 - 8.4`가 58.300000000000004가 되어 정확히 경계에 놓인 후보가 기각된다.
 *  허용 오차를 넓히는 값이 아니라, 십진 비교를 십진처럼 하기 위한 여유다. */
const GUARD_EPSILON = 1e-9;

export interface SeededRng {
  (): number;
  /** mulberry32 내부 상태(uint32) — 체크포인트 보존·복원용 */
  state: number;
}

export function createRng(seed: number): SeededRng {
  let s = seed >>> 0;
  const rng = (() => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as SeededRng;
  return Object.defineProperty(rng, "state", {
    get: () => s,
    set: (v: number) => {
      s = v >>> 0;
    },
  });
}

export function createLoopRun<A>(opts: LoopRunOptions<A>): LoopHandle {
  const { runId, pack, spec, scorer, planStrategy, generate, initial, store, onEvent } = opts;
  const roundDelayMs = opts.roundDelayMs ?? 0;

  let cp: LoopCheckpoint<A> | null = null;
  let pauseRequested = false;
  let active = false;

  const note = (c: LoopCheckpoint<A>, type: ProvenanceType, detail: string): void => {
    c.provenance.push({ at: new Date().toISOString(), type, detail });
  };

  /** 저장 후 통지 — 매 라운드·상태 전이의 계약 순서. 스냅샷을 넘겨 이후 변이와 격리한다. */
  const commit = async (c: LoopCheckpoint<A>): Promise<void> => {
    const snapshot = structuredClone(c);
    await store.save(snapshot);
    onEvent(snapshot);
  };

  // 가드 허용 오차는 팩의 분할 정책에 동결돼 있다 — 엔진은 값을 읽기만 한다
  const guardTolerance =
    pack.holdoutPolicy.mode === "seeded_split" ? pack.holdoutPolicy.guardTolerance : 0;

  const publicExperimentMemory = (c: LoopCheckpoint<A>): PublicExperimentFeedback[] => {
    if (spec.feedbackMode !== "recent_public_experiments_v1") return [];
    return c.tree
      .map((record, index): PublicExperimentFeedback | null =>
        record.guardSafe
          ? {
              round: record.round,
              ...(record.strategy === undefined
                ? {}
                : { strategy: { ...record.strategy } }),
              candidateScore: record.candidateScore,
              scoreDelta: record.candidateScore - c.curve[index],
              adopted: record.adopted,
              gateRejected: record.gateRejected,
              violations: [...record.violations],
            }
          : null,
      )
      .filter((record): record is PublicExperimentFeedback => record !== null)
      .slice(-PUBLIC_EXPERIMENT_MEMORY_LIMIT);
  };

  const blockedStrategyKeys = (records: PublicExperimentFeedback[]): string[] => {
    const failures = new Map<string, number>();
    for (const record of records) {
      if (record.adopted || record.strategy === undefined) continue;
      failures.set(record.strategy.key, (failures.get(record.strategy.key) ?? 0) + 1);
    }
    return [...failures.entries()]
      .filter(([, count]) => count >= REPEATED_STRATEGY_FAILURE_LIMIT)
      .map(([key]) => key)
      .sort();
  };

  async function start(): Promise<void> {
    if (active) return;
    active = true;
    pauseRequested = false;
    try {
      const rng = createRng(spec.seed);
      let c = await store.load(runId);
      if (c) {
        // 체크포인트는 그것을 만든 판정 절차에만 귀속된다 — 다이제스트 불일치 재개는 거부
        if (c.packDigest !== pack.definitionDigest) {
          throw new Error(
            "체크포인트의 판정 절차가 현재 승인본과 다릅니다 — 이어받을 수 없습니다(재승인 필요).",
          );
        }
        // 가드 도입 전(같은 다이제스트의 결정적 팩) 체크포인트 정규화 — 필드 부재를 null로 승격
        const stored = c as {
          championGuardScore?: number | null;
          guardCurve?: Array<number | null>;
          tree: Array<{ candidateGuardScore?: number | null; guardSafe?: boolean }>;
        };
        stored.championGuardScore ??= null;
        stored.guardCurve ??= Array<number | null>(c.curve.length).fill(null);
        for (const record of stored.tree) {
          record.candidateGuardScore ??= null;
          record.guardSafe ??= true;
        }
        cp = c;
        if (c.status === "done") return;
        rng.state = c.rngState;
        c.status = "running";
        note(c, "resumed", `체크포인트에서 재개 — 라운드 ${c.round} 이후부터 계속`);
        await commit(c);
      } else {
        const champion = await initial(rng);
        const first = await scorer(champion);
        c = {
          runId,
          packDigest: pack.definitionDigest,
          status: "running",
          round: 0,
          champion,
          championScore: first.total,
          championViolations: first.violations,
          championGuardScore: first.guardScore ?? null,
          curve: [first.total],
          guardCurve: [first.guardScore ?? null],
          tree: [],
          provenance: [],
          rngState: rng.state,
        };
        cp = c;
        note(c, "run_started", `실행 시작 — 원샷 기준선 ${first.total}점 (라운드 0)`);
        await commit(c);
      }

      // 연속 미채택 수 — 체크포인트 스키마를 늘리지 않고 tree 꼬리에서 복원
      let sinceAdoption = 0;
      for (let i = c.tree.length - 1; i >= 0 && !c.tree[i].adopted; i--) sinceAdoption++;

      // 척도 상한 도달 = 엄격 개선 채택이 불가능 — 라운드 0 만점·재개 시점 모두 즉시 종료
      if (c.championScore >= SCORE_CEILING) {
        c.status = "done";
        c.doneReason = "ceiling";
        note(c, "ceiling_stop", `척도 상한 ${SCORE_CEILING}점 도달 — 추가 채택 불가, 조기 종료`);
        c.rngState = rng.state;
        await commit(c);
        return;
      }

      while (c.round < spec.maxRounds) {
        if (pauseRequested) {
          c.status = "paused";
          c.rngState = rng.state;
          note(c, "paused", `일시정지 — 라운드 ${c.round} 완료 시점`);
          await commit(c);
          return;
        }

        const round = c.round + 1;
        const previousRecord = c.tree[c.tree.length - 1];
        // 공개 기준으로 설명할 수 있는 직전 기각만 다음 실험의 재료로 쓴다. 가드 실패 후보는
        // 점수·트레이스가 공개 기준에서 좋아 보여도 비공개 신호를 추론할 수 있으므로 제외한다.
        const previousPublicAttempt =
          spec.feedbackMode === "champion_and_last_public_rejection" &&
          previousRecord !== undefined &&
          !previousRecord.adopted &&
          previousRecord.guardSafe
            ? {
                candidateScore: previousRecord.candidateScore,
                scoreDelta: previousRecord.candidateScore - previousRecord.championScore,
                gateRejected: previousRecord.gateRejected,
                violations: [...previousRecord.violations],
              }
            : undefined;
        const recentPublicExperiments = publicExperimentMemory(c);
        const blockedKeys = blockedStrategyKeys(recentPublicExperiments);
        const feedback: GeneratorFeedback = {
          round,
          championScore: c.championScore,
          championViolations: c.championViolations,
          ...(previousPublicAttempt === undefined ? {} : { previousPublicAttempt }),
          ...(spec.feedbackMode === "recent_public_experiments_v1"
            ? {
                recentPublicExperiments,
                blockedStrategyKeys: blockedKeys,
              }
            : {}),
        };
        const strategy = planStrategy === undefined
          ? undefined
          : await planStrategy(c.champion, rng, feedback);
        if (strategy !== undefined && blockedKeys.includes(strategy.key)) {
          throw new Error(
            `반복 실패한 수정 전략(${strategy.key})을 다시 선택했습니다 — 다른 전략이 필요합니다.`,
          );
        }
        const candidate = await generate(c.champion, rng, feedback, strategy);
        const result = await scorer(candidate);
        const prevScore = c.championScore;
        const prevGuardScore = c.championGuardScore;
        const candidateGuardScore = result.guardScore ?? null;
        // 검증 가드 비퇴보 — 가드가 없거나 챔피언 가드가 없으면 공허 참(비교 대상 부재)
        const guardSafe =
          candidateGuardScore === null || prevGuardScore === null
            ? true
            : candidateGuardScore + GUARD_EPSILON >= prevGuardScore - guardTolerance;
        // 게이트 기각 후보는 채택 판정에 진입하지 않는다; 가드 퇴보 후보도 기각;
        // 동점은 챔피언 유지(scalar_strict)
        const adopted = !result.gateRejected && guardSafe && result.total > prevScore;
        if (adopted) {
          c.champion = candidate;
          c.championScore = result.total;
          c.championViolations = result.violations;
          c.championGuardScore = candidateGuardScore;
        }
        c.round = round;
        // 곡선에는 후보 점수가 아니라 "채택 확정 후 챔피언" 점수를 기록한다 (§5.1.1)
        c.curve.push(c.championScore);
        c.guardCurve.push(c.championGuardScore);
        c.tree.push({
          round,
          candidateScore: result.total,
          championScore: c.championScore,
          adopted,
          gateRejected: result.gateRejected,
          violations: result.violations,
          ...(strategy === undefined
            ? {}
            : { strategy: { ...strategy } satisfies ExperimentStrategy }),
          candidateGuardScore,
          guardSafe,
        });
        note(
          c,
          "round",
          result.gateRejected
            ? `라운드 ${round}: 후보 게이트 기각 — 채택 판정 미진입`
            : !guardSafe
              ? `라운드 ${round}: 후보 ${result.total}점 — 검증 가드 퇴보(${prevGuardScore}점 → ${candidateGuardScore}점)로 기각`
              : `라운드 ${round}: 후보 ${result.total}점 / 챔피언 ${prevScore}점 — ${adopted ? "채택" : "기각"}`,
        );
        if (adopted) note(c, "adopted", `챔피언 교체: ${prevScore}점 → ${result.total}점`);

        sinceAdoption = adopted ? 0 : sinceAdoption + 1;
        if (c.championScore >= SCORE_CEILING) {
          c.status = "done";
          c.doneReason = "ceiling";
          note(c, "ceiling_stop", `척도 상한 ${SCORE_CEILING}점 도달 — 추가 채택 불가, 조기 종료`);
        } else if (sinceAdoption >= spec.plateauRounds) {
          c.status = "done";
          c.doneReason = "plateau";
          note(c, "plateau_stop", `연속 ${sinceAdoption}라운드 미채택 — 정체 종료`);
        } else if (c.round >= spec.maxRounds) {
          c.status = "done";
          c.doneReason = "max_rounds";
          note(c, "finished", `최대 ${spec.maxRounds}라운드 도달 — 종료`);
        }
        c.rngState = rng.state;
        await commit(c);
        if (c.status === "done") return;
        if (roundDelayMs > 0) await new Promise((r) => setTimeout(r, roundDelayMs));
      }

      // 재개 시 이미 maxRounds에 도달해 있던 방어적 경계
      if (c.status !== "done") {
        c.status = "done";
        c.doneReason = "max_rounds";
        note(c, "finished", `최대 ${spec.maxRounds}라운드 도달 — 종료`);
        await commit(c);
      }
    } finally {
      active = false;
    }
  }

  return {
    start,
    pause() {
      // 진행 중 라운드를 완료한 뒤 루프가 정지·저장·통지한다
      pauseRequested = true;
    },
    getCheckpoint() {
      return cp;
    },
  };
}
