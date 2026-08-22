/** 브라우저 자율 개선 루프 엔진 — 독립 배포 예정 부품 (SPEC §8).
 *  계약 (SPEC §5.1·§5.1.1):
 *  - 첫 커밋부터 체크포인트·재개 가능한 상태 머신: 매 라운드 종료 시 store.save가 계약이다.
 *  - 채택: adoptionRule "scalar_strict" — 후보 스칼라 > 챔피언 스칼라일 때만 교체(동점 유지).
 *  - 게이트 reject 후보는 채택 판정에 진입하지 않는다(기각으로 기록).
 *  - 정체: 연속 plateauRounds 미채택 시 doneReason "plateau"로 종료.
 *  - 엔진은 평가자(scorer)를 수정할 어떤 경로도 갖지 않는다 — 호출만 한다.
 *  - RNG는 시드 기반이며 상태를 체크포인트에 보존한다(리플레이·재개 동일 수열). */

import type { EvaluationPack, LoopCheckpoint, LoopSpec, ScoreResult } from "@harnest/contracts";

export interface CheckpointStore<A> {
  save(cp: LoopCheckpoint<A>): Promise<void>;
  load(runId: string): Promise<LoopCheckpoint<A> | null>;
}

/** Generator에게 전달되는 피드백 — **가시 케이스 트레이스만** 담는다.
 *  홀드아웃 점수·트레이스에서 파생된 어떤 신호도 여기로 흘러들 수 없다(SPEC §3 원칙 7 불변식).
 *  "점수만 피드백하면 개선 없음"(실측 03·04에서 표본 9로 확정)이 violations 전달의 근거다. */
export interface GeneratorFeedback {
  round: number;
  championScore: number;
  championViolations: string[];
}

export interface LoopRunOptions<A> {
  runId: string;
  pack: EvaluationPack;
  spec: LoopSpec;
  scorer: (artifact: A) => ScoreResult | Promise<ScoreResult>;
  /** 후보 생성 — 결정적 변이기든 LLM Generator든 같은 자리에 꽂힌다 */
  generate: (champion: A, rng: () => number, feedback: GeneratorFeedback) => A | Promise<A>;
  initial: (rng: () => number) => A | Promise<A>;
  store: CheckpointStore<A>;
  /** 매 라운드(및 상태 전이) 후 최신 체크포인트 통지 — 관제실 라이브 뷰의 소스 */
  onEvent: (cp: LoopCheckpoint<A>) => void;
  /** 라운드 간 지연(ms) — 관제실에서 사람이 볼 수 있는 속도. 테스트는 0 */
  roundDelayMs?: number;
}

export interface LoopHandle {
  /** 새 실행 시작(체크포인트가 있으면 이어서 재개) */
  start(): Promise<void>;
  pause(): void;
  getCheckpoint(): LoopCheckpoint<unknown> | null;
}

/** mulberry32 — 상태(uint32) 노출형 시드 RNG. 구현은 engine.ts */
export { createRng } from "./engine";
export { createLoopRun } from "./engine";
export { MemoryCheckpointStore, IndexedDbCheckpointStore } from "./stores";
