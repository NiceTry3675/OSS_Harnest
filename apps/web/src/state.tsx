/** 프로젝트 상태 — 페이지 간 공유되는 단일 컨텍스트 (템플릿 무관).
 *  흐름: 템플릿 선택 → 인터뷰(answers) → 컴파일(compiled) → 검증·캘리브레이션 → 승인(approvedAt)
 *  → 실행(checkpoint) → 결과. 재컴파일 = 판정 절차 변경 → 승인·실행 상태를 반드시 무효화한다.
 *  검증 리포트·캘리브레이션은 재컴파일 시 지우지 않는다 — forDigest 불일치가 "기준이 수정되어
 *  무효화됨"을 화면에 알리는 재료다(수정→재검증 왕복, SPEC §4.1). 승인 가능 여부는
 *  approvalBlockers가 판단하며, approve()는 차단 사유가 있으면 무시된다(UI 밖 이중 방어). */

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import {
  approvalBlockers,
  type CalibrationResult,
  type EvaluationPack,
  type ExaminerReport,
  type LoopCheckpoint,
  type LoopSpec,
} from "@harnest/contracts";

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

/** 홀드아웃 채점 결과 — 라운드 0(원샷)과 종료 시에만 기록된다 */
export interface HoldoutScores {
  baseline: number | null;
  final: number | null;
}

export interface ProjectState {
  templateId: string | null;
  setTemplateId: (id: string | null) => void;
  answers: Record<string, unknown>;
  setAnswers: (a: Record<string, unknown>) => void;
  compiled: CompiledGeneric | null;
  setCompiled: (c: CompiledGeneric | null) => void;
  examinerRun: ExaminerRunGeneric | null;
  setExaminerRun: (r: ExaminerRunGeneric | null) => void;
  calibration: CalibrationResult | null;
  setCalibration: (c: CalibrationResult | null) => void;
  /** 현재 팩 기준 승인 차단 사유 — 비어 있어야 approve()가 동작한다 */
  blockers: string[];
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

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [compiled, setCompiled] = useState<CompiledGeneric | null>(null);
  const [examinerRun, setExaminerRun] = useState<ExaminerRunGeneric | null>(null);
  const [calibration, setCalibration] = useState<CalibrationResult | null>(null);
  const [approvedAt, setApprovedAt] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [checkpoint, setCheckpoint] = useState<LoopCheckpoint<unknown> | null>(null);
  const [holdout, setHoldout] = useState<HoldoutScores>({ baseline: null, final: null });

  const blockers = useMemo(
    () =>
      compiled
        ? approvalBlockers(compiled.pack, examinerRun?.report ?? null, calibration)
        : [],
    [compiled, examinerRun, calibration],
  );

  const value = useMemo<ProjectState>(
    () => ({
      templateId,
      setTemplateId,
      answers,
      setAnswers,
      compiled,
      // 이 리셋이 없으면 새 팩이 옛 승인·옛 체크포인트를 물려받아 동결이 뚫린다
      setCompiled: (c: CompiledGeneric | null) => {
        setCompiled(c);
        setApprovedAt(null);
        setRunId(null);
        setCheckpoint(null);
        setHoldout({ baseline: null, final: null });
      },
      examinerRun,
      setExaminerRun,
      calibration,
      setCalibration,
      blockers,
      approvedAt,
      // 차단 사유가 있으면 승인은 성립하지 않는다 — 화면 가드가 뚫려도 여기서 막힌다
      approve: () => {
        if (blockers.length > 0) return;
        setApprovedAt(new Date().toISOString());
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
        setCalibration(null);
        setApprovedAt(null);
        setRunId(null);
        setCheckpoint(null);
        setHoldout({ baseline: null, final: null });
      },
    }),
    [templateId, answers, compiled, examinerRun, calibration, blockers, approvedAt, runId, checkpoint, holdout],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProject(): ProjectState {
  const v = useContext(Ctx);
  if (!v) throw new Error("ProjectProvider 밖에서 useProject 호출");
  return v;
}
