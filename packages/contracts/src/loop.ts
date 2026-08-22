/** 루프 계약 — SPEC §5.1.1. 스켈레톤 채택 규칙은 결정적 전용 특례:
 *  스칼라가 엄격히 개선될 때만 채택, 동점은 챔피언 유지. */

export type AdoptionRule = "scalar_strict";

export interface LoopSpec {
  maxRounds: number;
  /** 연속 미채택이 이 수에 달하면 정체 조기 종료 */
  plateauRounds: number;
  adoptionRule: AdoptionRule;
  /** 시드 고정 = 리플레이 가능(부가 기능 1 리플레이 모드의 기반) */
  seed: number;
}

export interface ScoreResult {
  /** 0~100. 곡선·채택 판정에 쓰이는 동결 스칼라 */
  total: number;
  /** 케이스/항목별 트레이스 — Generator 피드백(§5.1.1 v1 승격)의 재료 */
  violations: string[];
  parts: Record<string, number>;
  gateRejected: boolean;
}

export interface RoundRecord {
  round: number;
  candidateScore: number;
  championScore: number;
  adopted: boolean;
  gateRejected: boolean;
  violations: string[];
}

export type ProvenanceType =
  | "run_started" | "round" | "adopted" | "paused" | "resumed"
  | "finished" | "plateau_stop";

/** 읽기는 자유·기록되지 않는다. 기록되는 것은 결과에 영향을 주는 사건뿐 (PHILOSOPHY §2) */
export interface ProvenanceEntry {
  at: string;
  type: ProvenanceType;
  detail: string;
}

export type LoopStatus = "idle" | "running" | "paused" | "done";

/** 체크포인트 — 루프 엔진은 첫 커밋부터 재개 가능한 상태 머신 (SPEC §5.1).
 *  매 라운드 저장이 계약이다: 탭 회수·중단 후 재개, 체크포인트 로그 = 리플레이 데이터. */
export interface LoopCheckpoint<A> {
  runId: string;
  packDigest: string;
  status: LoopStatus;
  doneReason?: "max_rounds" | "plateau";
  round: number;
  champion: A;
  championScore: number;
  championViolations: string[];
  /** 라운드별 챔피언 스칼라 — 개선 곡선. 하락도 그대로 기록한다 */
  curve: number[];
  tree: RoundRecord[];
  provenance: ProvenanceEntry[];
  /** RNG 내부 상태 — 재개 시 이어서 같은 수열 */
  rngState: number;
}
