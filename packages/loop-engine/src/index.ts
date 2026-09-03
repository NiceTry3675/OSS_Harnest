/** 브라우저 반복 개선 루프 엔진.
 *  계약 (SPEC §5.1.1):
 *  - 첫 커밋부터 체크포인트·재개 가능한 상태 머신: 매 라운드 종료 시 store.save가 계약이다.
 *  - 채택: adoptionRule "scalar_strict" — 후보 스칼라 > 챔피언 스칼라일 때만 교체(동점 유지).
 *  - 게이트 reject 후보는 채택 판정에 진입하지 않는다(기각으로 기록).
 *  - 검증 가드(팩 holdoutPolicy.mode "seeded_split"): 후보 가드 집계가
 *    챔피언 가드 − guardTolerance 미만이면 스칼라가 높아도 기각 — 가시 시험지 전용
 *    과적합 문서가 챔피언이 되는 경로를 막는다. 가드 개별 트레이스는 Generator에 가지 않는다.
 *  - 정체: 연속 plateauRounds 미채택 시 doneReason "plateau"로 종료.
 *  - 상한: 챔피언 스칼라가 척도 상한(100)에 도달하면 doneReason "ceiling"으로 즉시 종료 —
 *    엄격 개선 규칙상 이후 채택이 불가능해 남은 라운드는 결과에 영향을 줄 수 없다.
 *  - 엔진은 평가자(scorer)를 수정할 어떤 경로도 갖지 않는다 — 호출만 한다.
 *  - RNG는 시드 기반이며 상태를 체크포인트에 보존한다(로컬 변이·재개 동일 수열).
 *    비결정적 외부 모델 출력의 재현까지 보장하지 않는다. */

import type {
  EvaluationPack,
  ExperimentStrategy,
  LoopCheckpoint,
  LoopSpec,
  ScoreResult,
} from "@harnest/contracts";

/** 다음 Generator에 전달하는 공개 실험 기록. 가드 기각 시도는 이 계약에 들어오지 않는다. */
export interface PublicExperimentFeedback {
  round: number;
  strategy?: ExperimentStrategy;
  candidateScore: number;
  scoreDelta: number;
  adopted: boolean;
  gateRejected: boolean;
  violations: string[];
}

export interface CheckpointStore<A> {
  save(cp: LoopCheckpoint<A>): Promise<void>;
  load(runId: string): Promise<LoopCheckpoint<A> | null>;
  /** 소유 프로젝트가 runId를 폐기할 때 — 고아 체크포인트를 남기지 않는다(선택) */
  delete?(runId: string): Promise<void>;
  /** 저장된 모든 runId(선택) — 정리 스윕용 */
  keys?(): Promise<string[]>;
  /** keepRunId를 제외한 모든 체크포인트 삭제(선택). null이면 전부 삭제한다.
   *  재컴파일·초기화 뒤 남는 이전 실행분을 하이드레이션 시점에 한꺼번에 정리하는 용도다 —
   *  진행 중 라운드의 지연 commit이 되살린 고아도 다음 로드에서 걷힌다. */
  deleteExcept?(keepRunId: string | null): Promise<void>;
}

/** Generator에게 전달되는 피드백 — **가시 케이스 트레이스만** 담는다.
 *  홀드아웃 점수·트레이스에서 파생된 어떤 신호도 여기로 흘러들 수 없다(SPEC §3 원칙 7).
 *  케이스별 판정 사유가 후보 수정에 유용했던 실측을 근거로 violations를 전달한다. */
export interface GeneratorFeedback {
  round: number;
  championScore: number;
  championViolations: string[];
  /** 직전 기각이 공개 기준만으로 설명될 때만 제공한다. 가드·홀드아웃 신호는 절대 포함하지 않는다. */
  previousPublicAttempt?: {
    candidateScore: number;
    scoreDelta: number;
    gateRejected: boolean;
    violations: string[];
  };
  /** 최근 공개 실험 최대 3개. 가드 기각 시도와 비공개 신호는 포함하지 않는다. */
  recentPublicExperiments?: PublicExperimentFeedback[];
  /** 최근 공개 실패에서 같은 전략이 두 번 반복됐을 때 다음 시도에서 선택할 수 없는 키. */
  blockedStrategyKeys?: string[];
}

export interface LoopRunOptions<A> {
  runId: string;
  pack: EvaluationPack;
  spec: LoopSpec;
  scorer: (artifact: A) => ScoreResult | Promise<ScoreResult>;
  /** 후보 생성 전에 수정 전략을 선언한다. 생략하면 전략 기록 없이 기존 방식으로 생성한다. */
  planStrategy?: (
    champion: A,
    rng: () => number,
    feedback: GeneratorFeedback,
  ) => ExperimentStrategy | Promise<ExperimentStrategy>;
  /** 후보 생성 — 결정적 변이기든 LLM Generator든 같은 자리에 꽂힌다 */
  generate: (
    champion: A,
    rng: () => number,
    feedback: GeneratorFeedback,
    strategy?: ExperimentStrategy,
  ) => A | Promise<A>;
  initial: (rng: () => number) => A | Promise<A>;
  store: CheckpointStore<A>;
  /** 매 라운드(및 상태 전이) 후 최신 체크포인트 통지 — 관제실 라이브 뷰의 소스 */
  onEvent: (cp: LoopCheckpoint<A>) => void;
  /** 라운드 간 지연(ms) — 관제실에서 사람이 볼 수 있는 속도. 테스트는 0 */
  roundDelayMs?: number;
}

export interface LoopHandle {
  /** 새 실행 시작(체크포인트가 있으면 이어서 재개). 이미 진행 중이면 즉시 no-op으로 끝난다.
   *  라운드 0 채점이 실패해 체크포인트 없이 reject되더라도 원샷 산출물은 이 핸들에 남아,
   *  같은 핸들로 다시 start()하면 재생성 없이 그 산출물을 다시 채점한다. */
  start(): Promise<void>;
  pause(): void;
  /** start()가 진행 중(원샷·라운드·커밋 어느 단계든)이면 true — 화면은 이 값으로
   *  "살아 있는 running"과 탭 회수로 남은 저장본의 running을 구분한다 */
  isActive(): boolean;
  getCheckpoint(): LoopCheckpoint<unknown> | null;
  /** 채점·첫 커밋 실패로 아직 체크포인트가 없지만 원샷 산출물이 남아 있으면 true — 다음 start()는
   *  재생성 없이 채점부터 잇는다. 원샷 생성 자체가 실패했으면 false(다시 만든다). */
  hasPendingInitial(): boolean;
}

/** mulberry32 — 상태(uint32) 노출형 시드 RNG. 구현은 engine.ts */
export { createRng } from "./engine";
export {
  createLoopRun,
  CheckpointSaveError,
  PUBLIC_EXPERIMENT_MEMORY_LIMIT,
  REPEATED_STRATEGY_FAILURE_LIMIT,
} from "./engine";
export { MemoryCheckpointStore, IndexedDbCheckpointStore } from "./stores";
