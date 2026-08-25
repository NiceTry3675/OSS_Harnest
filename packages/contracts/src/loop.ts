/** 현재 루프 계약 — SPEC §5.1.1.
 *  스칼라가 엄격히 개선될 때만 채택하고 동점은 챔피언을 유지한다. */

export type AdoptionRule = "scalar_strict";

/** 동결 스칼라 척도의 상한. 챔피언이 도달하면 엄격 개선 채택이 더는 불가능하다 */
export const SCORE_CEILING = 100;

export interface LoopSpec {
  maxRounds: number;
  /** 연속 미채택이 이 수에 달하면 정체 조기 종료 */
  plateauRounds: number;
  adoptionRule: AdoptionRule;
  /** 시드 고정 = 로컬 RNG 수열 재현. 비결정적 외부 모델 출력까지 보장하지 않는다. */
  seed: number;
}

export interface ScoreResult {
  /** 0~100. 곡선·채택 판정에 쓰이는 동결 스칼라 */
  total: number;
  /** 케이스/항목별 트레이스 — Generator 피드백(§5.1.1 v1 승격)의 재료 */
  violations: string[];
  parts: Record<string, number>;
  gateRejected: boolean;
  /** 검증 가드 집계(0~100) — 채택의 비퇴보 조건에만 쓰이고 Generator에는 개별 트레이스가
   *  노출되지 않는다(SPEC §5.1.1). 가드 미구성 템플릿·게이트 기각 시 null 또는 생략. */
  guardScore?: number | null;
}

export interface RoundRecord {
  round: number;
  candidateScore: number;
  championScore: number;
  adopted: boolean;
  gateRejected: boolean;
  violations: string[];
  /** 후보의 검증 가드 집계 — 가드 미구성·게이트 기각이면 null */
  candidateGuardScore: number | null;
  /** 가드 비퇴보 조건 통과 여부 — 가드가 없으면 항상 true(공허 참) */
  guardSafe: boolean;
}

export type ProvenanceType =
  | "run_started" | "round" | "adopted" | "paused" | "resumed"
  | "finished" | "plateau_stop" | "ceiling_stop";

/** 읽기는 자유·기록되지 않는다. 기록되는 것은 결과에 영향을 주는 사건뿐 (SPEC §3 원칙 7) */
export interface ProvenanceEntry {
  at: string;
  type: ProvenanceType;
  detail: string;
}

export type LoopStatus = "idle" | "running" | "paused" | "done";

/** 체크포인트 — 매 라운드 저장하는 재개 가능한 상태 머신 (SPEC §4.2·§5.1.1).
 *  매 라운드 저장이 계약이다: 탭 회수·중단 후 재개, 체크포인트 로그 = 기록 재생 자료. */
export interface LoopCheckpoint<A> {
  runId: string;
  packDigest: string;
  status: LoopStatus;
  doneReason?: "max_rounds" | "plateau" | "ceiling";
  round: number;
  champion: A;
  championScore: number;
  championViolations: string[];
  /** 챔피언의 검증 가드 집계 — 가드 미구성·게이트 기각 챔피언이면 null */
  championGuardScore: number | null;
  /** 라운드별 채택 확정 후 챔피언 스칼라 — strict 채택에서는 내려가지 않는다 */
  curve: number[];
  /** 라운드별 채택 확정 후 챔피언 가드 집계 — 허용 오차 안에서는 내려갈 수 있다 */
  guardCurve: Array<number | null>;
  tree: RoundRecord[];
  provenance: ProvenanceEntry[];
  /** RNG 내부 상태 — 재개 시 이어서 같은 수열 */
  rngState: number;
}
