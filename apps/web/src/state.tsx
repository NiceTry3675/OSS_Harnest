/** 프로젝트 상태 — 페이지 간 공유되는 단일 컨텍스트 (템플릿 무관).
 *  흐름: 템플릿 선택 → 인터뷰(answers) → 컴파일(compiled) → 검증(자동) → 승인(approvedAt)
 *  → 실행(checkpoint) → 결과. 재컴파일 = 판정 절차 변경 → 승인·실행 상태를 반드시 무효화한다.
 *  검증 리포트는 재컴파일 시 지우지 않는다 — forDigest 불일치가 재검증 자동 실행의 신호다
 *  (수정→재검증 왕복, SPEC §4.1). 승인 가능 여부는 approvalBlockers가 판단하며,
 *  approve()는 차단 사유가 있으면 무시된다(UI 밖 이중 방어).
 *
 *  화면 수명보다 긴 것들은 여기에 산다: 실행 세션(runController — 라우트 이탈과 무관하게 진행),
 *  검사관 배터리 진행 상태(다이제스트당 자동 1회, SPEC §5.2), 탭 간 쓰기 잠금(readOnly).
 *  비동기로 도착하는 체크포인트·홀드아웃 결과는 runId+packDigest 귀속을 확인한 뒤에만 반영한다.
 *  화면에 내주는 세터는 마운트 동안 정체성이 고정된다(useSyncedState) — 화면 effect가 세터를
 *  의존성에 넣어도 자기 갱신으로 되풀이 발화하지 않는다. */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSyncedState } from "./lib/useSyncedState";
import {
  approvalBlockers,
  type EvaluationPack,
  type ExaminerReport,
  type HoldoutScores,
  type LoopCheckpoint,
  type LoopSpec,
} from "@harnest/contracts";
export type { HoldoutCaseScore, HoldoutEvaluation, HoldoutScores } from "@harnest/contracts";
import { IndexedDbCheckpointStore, type CheckpointStore } from "@harnest/loop-engine";
import {
  IndexedDbProjectStore,
  markUnavailableRestoredHoldout,
  PROJECT_SNAPSHOT_VERSION,
  projectRestoredCheckpoint,
  restoreProjectSnapshot,
  SnapshotConflictError,
  type ProjectSnapshot,
} from "./lib/project-snapshot";
import { idleBattery, type ExaminerBatteryState } from "./lib/examinerBattery";
export type { ExaminerBatteryError, ExaminerBatteryState } from "./lib/examinerBattery";
import { acquireProjectLock } from "./lib/projectLock";
import { readOnlyGuardedStore } from "./lib/readOnlyCheckpointStore";
import { createRunController, type RunController } from "./lib/runController";

export interface CompiledGeneric {
  problem: unknown;
  pack: EvaluationPack;
  loopSpec: LoopSpec;
  /** 템플릿이 컴파일 시점에 계산한 설정 안내(선택) — 승인 화면이 그대로 표시한다 */
  notices?: string[];
}

export type HoldoutUpdate = HoldoutScores | ((prev: HoldoutScores) => HoldoutScores);

export interface ProjectState {
  /** IndexedDB 복원이 끝나기 전 페이지가 빈 상태로 마운트되는 것을 막는다 */
  hydrated: boolean;
  /** 다른 탭이 이 프로젝트의 쓰기 잠금을 쥐고 있다(또는 잠금이 없는 환경에서 다른 탭의 저장이
   *  먼저 반영됐다) — 저장·시작·재개·승인이 막힌다. 읽기 전용 탭은 표시만 하며 어떤 모델 호출도
   *  내지 않는다: 실행 세션을 만들지 않고, 완료본 복구 홀드아웃 채점도 시작하지 않는다.
   *  잠금은 탭이 닫혀도 이 탭에 넘어오지 않으므로, 이어서 쓰려면 새로고침해야 한다. */
  readOnly: boolean;
  templateId: string | null;
  setTemplateId: (id: string | null) => void;
  answers: Record<string, unknown>;
  setAnswers: (a: Record<string, unknown>) => void;
  compiled: CompiledGeneric | null;
  setCompiled: (c: CompiledGeneric | null) => void;
  examinerReport: ExaminerReport | null;
  /** 현재 다이제스트에 결속된(forDigest 일치) 리포트만 반영한다. 이미 승인된 다이제스트의
   *  증거는 바꾸지 않는다 — 늦게 도착한 배터리 결과가 승인 근거를 갈아치우지 못하게 */
  setExaminerReport: (r: ExaminerReport) => void;
  examinerBattery: ExaminerBatteryState;
  setExaminerBattery: (update: (prev: ExaminerBatteryState) => ExaminerBatteryState) => void;
  /** 현재 팩 기준 승인 차단 사유 — 비어 있어야 approve()가 동작한다 */
  blockers: string[];
  /** 승인 순간 캡처된 다이제스트 — 정식 기록도 이 값을 사용하며 현재 Pack에서 재파생하지 않는다. */
  approvedDigest: string | null;
  approvedAt: string | null;
  approve: () => void;
  runId: string | null;
  setRunId: (id: string) => void;
  checkpoint: LoopCheckpoint<unknown> | null;
  /** 저장본을 화면 상태로 투영할 때만 쓴다(탭 회수 복원). 엔진 통지는 run 컨트롤러가 귀속을
   *  확인해 넣는다 */
  setCheckpoint: (cp: LoopCheckpoint<unknown>) => void;
  /** 복원 시 running 저장본이 남아 있던 실행의 runId — 탭이 닫혀 진행 중이던 회차가 저장되지
   *  않았다는 뜻이다(잠금을 쥔 탭만 기록). 관제실이 그 실행을 재개하면 dismissInterruptedRun으로
   *  지운다. 복원 뒤 세션이 살아 있는 동안 저장본이 running인 것은 탭 회수가 아니므로 여기 실리지
   *  않는다. */
  interruptedRunId: string | null;
  dismissInterruptedRun: () => void;
  holdout: HoldoutScores;
  setHoldout: (h: HoldoutUpdate) => void;
  /** 실행 오케스트레이션 — 세션은 프로젝트 수명에 묶여 라우트 이탈과 무관하게 산다 */
  run: RunController;
  /** 체크포인트 저장소 — 관제실과 컨트롤러가 같은 연결을 쓴다. 읽기 전용 탭에서는 save가 거부된다
   *  (잠금 없는 환경에서 뒤늦게 소유권을 잃은 탭의 진행 중 라운드가 커밋되지 않게) */
  checkpointStore: CheckpointStore<unknown>;
  reset: () => void;
}

const Ctx = createContext<ProjectState | null>(null);
const snapshotStore = new IndexedDbProjectStore();
const checkpointStore = new IndexedDbCheckpointStore<unknown>();
const emptyHoldout = (): HoldoutScores => ({
  baseline: null,
  final: null,
  errors: { baseline: null, final: null },
});

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [examinerReport, setExaminerReportState] = useState<ExaminerReport | null>(null);
  const [approvedAt, setApprovedAt] = useState<string | null>(null);
  const [checkpoint, setCheckpointState] = useState<LoopCheckpoint<unknown> | null>(null);
  const [interruptedRunId, setInterruptedRunId] = useState<string | null>(null);

  // 비동기 통지(엔진·홀드아웃·배터리)가 귀속을 확인할 때 읽는 동기 참조가 붙은 상태 — 세터를
  // 거칠 때마다 렌더보다 먼저 갱신되므로, 같은 틱에 도착한 결과도 최신 실행 기준으로 판정된다.
  // 세터(apply*)는 마운트 동안 같은 참조다 — 화면 effect 의존성에 실려도 되풀이 발화하지 않는다.
  const [compiled, compiledRef, applyCompiled] = useSyncedState<CompiledGeneric | null>(() => null);
  const [examinerBattery, batteryRef, applyBattery] = useSyncedState<ExaminerBatteryState>(idleBattery);
  // 승인 순간 캡처된 다이제스트 — 저장 시점에 현재 팩에서 파생하면 재결속 위험이 생긴다
  const [approvedDigest, approvedDigestRef, applyApprovedDigest] = useSyncedState<string | null>(
    () => null,
  );
  const [runId, runIdRef, applyRunId] = useSyncedState<string | null>(() => null);
  const [holdout, holdoutRef, applyHoldout] = useSyncedState<HoldoutScores>(emptyHoldout);
  const readOnlyRef = useRef(false);
  // 화면·컨트롤러에 내주는 저장소 — 읽기 전용 탭의 save를 거부한다. 소유권 상실은 동기 참조로
  // 판정하므로 진행 중 라운드의 지연 commit도 같은 틱에 막힌다.
  const [guardedStore] = useState<CheckpointStore<unknown>>(() =>
    readOnlyGuardedStore(checkpointStore, () => readOnlyRef.current),
  );

  const currentDigest = (): string | null => compiledRef.current?.pack.definitionDigest ?? null;
  const owns = (id: string, digest: string): boolean =>
    id === runIdRef.current && digest === currentDigest();
  /** 잠금 없는 탭으로 전환 — 저장·시작·재개·승인·복구 채점이 멈춘다. 진행 중 세션은 라운드
   *  경계에서 정지시켜 버리고, 그 라운드의 commit은 guardedStore가 거부한다(같은 runId를 다른
   *  탭과 번갈아 커밋하지 않게). */
  const becomeReadOnly = (): void => {
    if (readOnlyRef.current) return;
    readOnlyRef.current = true;
    setReadOnly(true);
  };

  // 실행 컨트롤러는 Provider 수명 동안 하나다 — 세션이 화면 마운트에 묶이지 않는다
  const [run] = useState<RunController>(() =>
    createRunController({
      onCheckpoint: (cp) => {
        if (!owns(cp.runId, cp.packDigest)) return;
        setCheckpointState(cp);
      },
      updateHoldout: (id, digest, update) => {
        if (!owns(id, digest)) return;
        applyHoldout(update);
      },
      // 읽기 전용 탭은 채점을 시작하지 않는다 — 소유 탭이 같은 산출물을 재고 있을 수 있고,
      // 이 탭의 결과는 저장되지 않아 갈 곳이 없다(이중 과금 방지)
      getHoldout: (id, digest) =>
        !readOnlyRef.current && owns(id, digest) ? holdoutRef.current : null,
    }),
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 쓰기 잠금을 먼저 시도한다 — 못 얻은 탭은 읽기만 하고 저장·실행·승인을 하지 않는다
      const owned = await acquireProjectLock();
      if (cancelled) return;
      readOnlyRef.current = !owned;
      setReadOnly(!owned);
      const snapshot = await snapshotStore.load();
      if (cancelled) return;
      const restored = snapshot === null ? null : restoreProjectSnapshot(snapshot);
      // 이 프로젝트의 runId 외 체크포인트는 전부 고아다(재컴파일·초기화·승인 불일치로 폐기된 실행).
      // 진행 중 라운드의 지연 commit이 되살린 것도 다음 로드에서 걷힌다. 잠금을 쥔 탭만 정리한다.
      if (owned) {
        const keep = restored !== null ? restored.runId : (snapshot?.runId ?? null);
        void checkpointStore.deleteExcept(keep).catch((error: unknown) => {
          console.warn("고아 체크포인트를 정리하지 못했습니다.", error);
        });
      }
      if (restored === null) return;
      let restoredCheckpoint: LoopCheckpoint<unknown> | null = null;
      let interrupted: string | null = null;
      if (restored.runId !== null && restored.compiled !== null) {
        try {
          const saved = await checkpointStore.load(restored.runId);
          // 탭 회수로 남은 running은 사용자가 재개할 수 있게 화면에서만 paused로 투영하고,
          // 진행 중이던 회차가 저장되지 않았다는 안내를 위해 그 runId를 기록한다(잠금을 쥔 탭만).
          const projected = projectRestoredCheckpoint(
            saved,
            restored.compiled.pack.definitionDigest,
            owned,
          );
          restoredCheckpoint = projected.checkpoint;
          interrupted = projected.interruptedRunId;
        } catch (error) {
          console.warn("체크포인트를 복원하지 못했습니다.", error);
        }
      }
      if (cancelled) return;
      setTemplateId(restored.templateId);
      setAnswers(restored.answers);
      applyCompiled(restored.compiled);
      setExaminerReportState(restored.examinerReport);
      setApprovedAt(restored.approvedAt);
      applyApprovedDigest(restored.approvedDigest);
      applyRunId(restored.runId);
      setCheckpointState(restoredCheckpoint);
      setInterruptedRunId(interrupted);
      applyHoldout(
        markUnavailableRestoredHoldout(
          restored.holdout,
          restoredCheckpoint,
          restored.compiled?.pack.holdoutPolicy.mode !== "none",
        ),
      );
    })()
      .catch((error: unknown) => {
        console.warn("프로젝트 스냅샷을 복원하지 못했습니다.", error);
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // 잠금이 없는 탭은 저장하지 않는다 — 오래된 상태로 다른 탭의 승인·runId를 덮어쓰지 않게
    if (!hydrated || readOnly) return;
    const snapshot: ProjectSnapshot = {
      schemaVersion: PROJECT_SNAPSHOT_VERSION,
      templateId,
      answers,
      compiled,
      examinerReport,
      approvedDigest,
      approvedAt,
      runId,
      holdout,
    };
    void snapshotStore.save(snapshot).catch((error: unknown) => {
      if (error instanceof SnapshotConflictError) {
        // Web Locks가 없는 환경(비보안 컨텍스트·구형 브라우저)의 최소 방어 — 다른 탭이 먼저 저장했다.
        // 이 탭의 오래된 상태로 덮어쓰지 않고 읽기 전용으로 물러난다(새로고침하면 이어받는다).
        console.warn("다른 탭이 먼저 저장해 이 탭을 읽기 전용으로 전환합니다.", error);
        becomeReadOnly();
        run.dropExcept(null);
        return;
      }
      console.warn("프로젝트 스냅샷을 저장하지 못했습니다.", error);
    });
    // eslint 미사용 — becomeReadOnly·run은 마운트 동안 고정이다
  }, [hydrated, readOnly, templateId, answers, compiled, examinerReport, approvedDigest, approvedAt, runId, holdout]);

  // 실행·배터리가 도는 동안 새로고침·탭 닫기를 확인한다 — 진행 중 라운드의 모델 호출은 저장되지
  // 않으므로 조용히 버려지면 사용자는 왜 회차가 안 늘었는지 알 수 없다. 라우트와 무관하게 건다.
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent): void => {
      if (!run.anyActive() && batteryRef.current.inFlightDigest === null) return;
      event.preventDefault();
      // 구형 Chromium·Safari는 returnValue가 비어 있지 않아야 대화상자를 띄운다(문구는 브라우저가 대체)
      event.returnValue = "진행 중인 작업이 있습니다. 지금 나가면 진행 중이던 회차는 저장되지 않습니다.";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [run]);

  const blockers = useMemo(
    () => (compiled ? approvalBlockers(compiled.pack, examinerReport) : []),
    [compiled, examinerReport],
  );

  const value = useMemo<ProjectState>(
    () => ({
      hydrated,
      readOnly,
      templateId,
      setTemplateId,
      answers,
      setAnswers,
      compiled,
      // 이 리셋이 없으면 새 팩이 옛 승인·옛 체크포인트를 물려받아 동결이 뚫린다
      setCompiled: (c: CompiledGeneric | null) => {
        applyCompiled(c);
        setApprovedAt(null);
        applyApprovedDigest(null);
        applyRunId(null);
        setCheckpointState(null);
        setInterruptedRunId(null);
        applyHoldout(emptyHoldout());
        // 이전 실행 세션은 이 프로젝트의 것이 아니다 — 라운드 경계에서 멈추고 버린다
        run.dropExcept(null);
      },
      examinerReport,
      setExaminerReport: (report: ExaminerReport) => {
        // 리포트는 forDigest로 결속된다 — 현재 다이제스트가 아니거나 이미 승인된 다이제스트면 무시
        if (report.forDigest !== currentDigest()) return;
        if (approvedDigestRef.current === report.forDigest) return;
        setExaminerReportState(report);
      },
      examinerBattery,
      setExaminerBattery: applyBattery,
      blockers,
      approvedDigest,
      approvedAt,
      // 차단 사유가 있으면 승인은 성립하지 않는다 — 화면 가드가 뚫려도 여기서 막힌다
      approve: () => {
        if (readOnlyRef.current || compiled === null || blockers.length > 0) return;
        setApprovedAt(new Date().toISOString());
        // 승인이 결속하는 다이제스트는 이 순간 캡처한다 — 이후 팩이 바뀌어도 따라가지 않는다
        applyApprovedDigest(compiled.pack.definitionDigest);
      },
      runId,
      setRunId: applyRunId,
      checkpoint,
      setCheckpoint: setCheckpointState,
      interruptedRunId,
      dismissInterruptedRun: () => setInterruptedRunId(null),
      holdout,
      setHoldout: applyHoldout,
      run,
      checkpointStore: guardedStore,
      reset: () => {
        setTemplateId(null);
        setAnswers({});
        applyCompiled(null);
        setExaminerReportState(null);
        applyBattery(idleBattery);
        setApprovedAt(null);
        applyApprovedDigest(null);
        applyRunId(null);
        setCheckpointState(null);
        setInterruptedRunId(null);
        applyHoldout(emptyHoldout());
        run.dropExcept(null);
      },
    }),
    // eslint 미사용 — apply* 세터는 useSyncedState가 정체성을 고정하므로 의존성에 넣지 않는다
    [
      hydrated,
      readOnly,
      templateId,
      answers,
      compiled,
      examinerReport,
      examinerBattery,
      blockers,
      approvedDigest,
      approvedAt,
      runId,
      checkpoint,
      interruptedRunId,
      holdout,
      run,
      guardedStore,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProject(): ProjectState {
  const v = useContext(Ctx);
  if (!v) throw new Error("ProjectProvider 밖에서 useProject 호출");
  return v;
}
