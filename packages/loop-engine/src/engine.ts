/** 루프 엔진 구현 — 계약은 ./index.ts 문서 주석 (SPEC §5.1.1).
 *  엔진은 scorer/pack을 수정할 어떤 경로도 갖지 않는다: 옵션으로 받은 함수를 호출만 한다. */

import { SCORE_CEILING, type LoopCheckpoint, type ProvenanceType } from "@harnest/contracts";
import type { LoopHandle, LoopRunOptions } from "./index";

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
  const { runId, pack, spec, scorer, generate, initial, store, onEvent } = opts;
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
          curve: [first.total],
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
        const candidate = await generate(c.champion, rng, {
          round,
          championScore: c.championScore,
          championViolations: c.championViolations,
        });
        const result = await scorer(candidate);
        const prevScore = c.championScore;
        // 게이트 기각 후보는 채택 판정에 진입하지 않는다; 동점은 챔피언 유지(scalar_strict)
        const adopted = !result.gateRejected && result.total > prevScore;
        if (adopted) {
          c.champion = candidate;
          c.championScore = result.total;
          c.championViolations = result.violations;
        }
        c.round = round;
        // 곡선에는 후보 점수가 아니라 "채택 확정 후 챔피언" 점수를 기록한다 (§5.1.1)
        c.curve.push(c.championScore);
        c.tree.push({
          round,
          candidateScore: result.total,
          championScore: c.championScore,
          adopted,
          gateRejected: result.gateRejected,
          violations: result.violations,
        });
        note(
          c,
          "round",
          result.gateRejected
            ? `라운드 ${round}: 후보 게이트 기각 — 채택 판정 미진입`
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
