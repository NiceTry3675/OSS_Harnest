/** 프로젝트 상태 — 페이지 간 공유되는 단일 컨텍스트 (템플릿 무관).
 *  흐름: 템플릿 선택 → 인터뷰(answers) → 컴파일(compiled) → 검증·캘리브레이션 → 승인(approvedAt)
 *  → 실행(checkpoint) → 결과. 재컴파일 = 판정 절차 변경 → 승인·실행 상태를 반드시 무효화한다.
 *  검증 리포트·캘리브레이션은 재컴파일 시 지우지 않는다 — forDigest 불일치가 "기준이 수정되어
 *  무효화됨"을 화면에 알리는 재료다(수정→재검증 왕복, SPEC §4.1). 승인 가능 여부는
 *  approvalBlockers가 판단하며, approve()는 차단 사유가 있으면 무시된다(UI 밖 이중 방어). */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  approvalBlockers,
  type CalibrationResult,
  type EvaluationPack,
  type ExaminerReport,
  type HoldoutScores,
  type LoopCheckpoint,
  type LoopSpec,
} from "@harnest/contracts";
export type { HoldoutCaseScore, HoldoutEvaluation, HoldoutScores } from "@harnest/contracts";
import { IndexedDbCheckpointStore } from "@harnest/loop-engine";
import {
  IndexedDbProjectStore,
  markUnavailableRestoredHoldout,
  PROJECT_SNAPSHOT_VERSION,
  restoreProjectSnapshot,
  type ProjectSnapshot,
} from "./lib/project-snapshot";

export interface CompiledGeneric {
  problem: unknown;
  pack: EvaluationPack;
  loopSpec: LoopSpec;
}

/** 배터리 실행 결과 — report는 계약 타입, artifacts는 템플릿 소유(캘리브레이션 쌍 재료) */
export interface ExaminerRunGeneric {
  report: ExaminerReport;
  artifacts: unknown;
}

/** 검증 배터리 실행 횟수 — 다이제스트에 결속된 비용 쿼터 재료(SPEC §5.2).
 *  전송 실패도 호출을 소모하므로 완료가 아니라 시작 시점에 계수한다. */
export interface ExaminerAttempts {
  forDigest: string;
  count: number;
}

export interface ProjectState {
  /** IndexedDB 복원이 끝나기 전 페이지가 빈 상태로 마운트되는 것을 막는다 */
  hydrated: boolean;
  templateId: string | null;
  setTemplateId: (id: string | null) => void;
  answers: Record<string, unknown>;
  setAnswers: (a: Record<string, unknown>) => void;
  compiled: CompiledGeneric | null;
  setCompiled: (c: CompiledGeneric | null) => void;
  examinerRun: ExaminerRunGeneric | null;
  setExaminerRun: (r: ExaminerRunGeneric | null) => void;
  examinerAttempts: ExaminerAttempts | null;
  /** 배터리 시작 1회 = 1 계수. 다른 다이제스트의 첫 시도는 계수를 새로 시작한다 */
  noteExaminerAttempt: (digest: string) => void;
  calibration: CalibrationResult | null;
  setCalibration: (c: CalibrationResult | null) => void;
  /** 현재 팩 기준 승인 차단 사유 — 비어 있어야 approve()가 동작한다 */
  blockers: string[];
  /** 승인 순간 캡처된 다이제스트 — 정식 기록도 이 값을 사용하며 현재 Pack에서 재파생하지 않는다. */
  approvedDigest: string | null;
  approvedAt: string | null;
  approve: () => void;
  runId: string | null;
  setRunId: (id: string) => void;
  checkpoint: LoopCheckpoint<unknown> | null;
  setCheckpoint: (cp: LoopCheckpoint<unknown>) => void;
  holdout: HoldoutScores;
  setHoldout: (h: HoldoutScores) => void;
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
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [compiled, setCompiled] = useState<CompiledGeneric | null>(null);
  const [examinerRun, setExaminerRun] = useState<ExaminerRunGeneric | null>(null);
  const [examinerAttempts, setExaminerAttempts] = useState<ExaminerAttempts | null>(null);
  const [calibration, setCalibration] = useState<CalibrationResult | null>(null);
  const [approvedAt, setApprovedAt] = useState<string | null>(null);
  // 승인 순간 캡처된 다이제스트 — 저장 시점에 현재 팩에서 파생하면 재결속 위험이 생긴다
  const [approvedDigest, setApprovedDigest] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [checkpoint, setCheckpoint] = useState<LoopCheckpoint<unknown> | null>(null);
  const [holdout, setHoldout] = useState<HoldoutScores>(emptyHoldout);

  useEffect(() => {
    let cancelled = false;
    void snapshotStore
      .load()
      .then(async (snapshot) => {
        if (cancelled || snapshot === null) return;
        const restored = restoreProjectSnapshot(snapshot);
        if (restored === null) return;
        // 승인 불일치로 실행 흔적을 폐기할 때, 그 runId의 체크포인트도 고아로 남기지 않는다
        if (snapshot.runId !== null && restored.runId === null) {
          void checkpointStore.delete(snapshot.runId).catch((error: unknown) => {
            console.warn("고아 체크포인트를 정리하지 못했습니다.", error);
          });
        }
        let restoredCheckpoint: LoopCheckpoint<unknown> | null = null;
        if (restored.runId !== null && restored.compiled !== null) {
          try {
            const saved = await checkpointStore.load(restored.runId);
            if (saved?.packDigest === restored.compiled.pack.definitionDigest) {
              // 탭 회수로 남은 running은 사용자가 재개할 수 있게 화면에서만 paused로 투영한다.
              restoredCheckpoint =
                saved.status === "running" ? { ...saved, status: "paused" } : saved;
            }
          } catch (error) {
            console.warn("체크포인트를 복원하지 못했습니다.", error);
          }
        }
        if (cancelled) return;
        setTemplateId(restored.templateId);
        setAnswers(restored.answers);
        setCompiled(restored.compiled);
        setExaminerRun(restored.examinerRun);
        setExaminerAttempts(restored.examinerAttempts);
        setCalibration(restored.calibration);
        setApprovedAt(restored.approvedAt);
        setApprovedDigest(restored.approvedDigest);
        setRunId(restored.runId);
        setCheckpoint(restoredCheckpoint);
        setHoldout(
          markUnavailableRestoredHoldout(
            restored.holdout,
            restoredCheckpoint,
            restored.compiled?.pack.holdoutPolicy.mode !== "none",
          ),
        );
      })
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
    if (!hydrated) return;
    const snapshot: ProjectSnapshot = {
      schemaVersion: PROJECT_SNAPSHOT_VERSION,
      templateId,
      answers,
      compiled,
      examinerRun,
      examinerAttempts,
      calibration,
      approvedDigest,
      approvedAt,
      runId,
      holdout,
    };
    void snapshotStore.save(snapshot).catch((error: unknown) => {
      console.warn("프로젝트 스냅샷을 저장하지 못했습니다.", error);
    });
  }, [hydrated, templateId, answers, compiled, examinerRun, examinerAttempts, calibration, approvedDigest, approvedAt, runId, holdout]);

  const blockers = useMemo(
    () =>
      compiled
        ? approvalBlockers(compiled.pack, examinerRun?.report ?? null, calibration)
        : [],
    [compiled, examinerRun, calibration],
  );

  const value = useMemo<ProjectState>(
    () => ({
      hydrated,
      templateId,
      setTemplateId,
      answers,
      setAnswers,
      compiled,
      // 이 리셋이 없으면 새 팩이 옛 승인·옛 체크포인트를 물려받아 동결이 뚫린다
      setCompiled: (c: CompiledGeneric | null) => {
        setCompiled(c);
        setApprovedAt(null);
        setApprovedDigest(null);
        setRunId(null);
        setCheckpoint(null);
        setHoldout(emptyHoldout());
      },
      examinerRun,
      setExaminerRun,
      examinerAttempts,
      // 같은 다이제스트로 되돌아온 재컴파일에도 계수가 유지되도록 다이제스트 결속으로만 관리한다
      noteExaminerAttempt: (digest: string) => {
        setExaminerAttempts((prev) =>
          prev !== null && prev.forDigest === digest
            ? { forDigest: digest, count: prev.count + 1 }
            : { forDigest: digest, count: 1 },
        );
      },
      calibration,
      setCalibration,
      blockers,
      approvedDigest,
      approvedAt,
      // 차단 사유가 있으면 승인은 성립하지 않는다 — 화면 가드가 뚫려도 여기서 막힌다
      approve: () => {
        if (compiled === null || blockers.length > 0) return;
        setApprovedAt(new Date().toISOString());
        // 승인이 결속하는 다이제스트는 이 순간 캡처한다 — 이후 팩이 바뀌어도 따라가지 않는다
        setApprovedDigest(compiled.pack.definitionDigest);
      },
      runId,
      setRunId,
      checkpoint,
      setCheckpoint,
      holdout,
      setHoldout,
      reset: () => {
        setTemplateId(null);
        setAnswers({});
        setCompiled(null);
        setExaminerRun(null);
        setExaminerAttempts(null);
        setCalibration(null);
        setApprovedAt(null);
        setApprovedDigest(null);
        setRunId(null);
        setCheckpoint(null);
        setHoldout(emptyHoldout());
      },
    }),
    [hydrated, templateId, answers, compiled, examinerRun, examinerAttempts, calibration, blockers, approvedDigest, approvedAt, runId, checkpoint, holdout],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProject(): ProjectState {
  const v = useContext(Ctx);
  if (!v) throw new Error("ProjectProvider 밖에서 useProject 호출");
  return v;
}
