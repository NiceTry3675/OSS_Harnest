/** 프로젝트 상태 — 페이지 간 공유되는 단일 컨텍스트 (템플릿 무관).
 *  흐름: 템플릿 선택 → 인터뷰(answers) → 컴파일(compiled) → 승인(approvedAt) → 실행(checkpoint) → 결과.
 *  재컴파일 = 판정 절차 변경 → 승인·실행 상태를 반드시 무효화한다(재승인 원칙). */

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { EvaluationPack, LoopCheckpoint, LoopSpec } from "@harnest/contracts";

export interface CompiledGeneric {
  problem: unknown;
  pack: EvaluationPack;
  loopSpec: LoopSpec;
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
  const [approvedAt, setApprovedAt] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [checkpoint, setCheckpoint] = useState<LoopCheckpoint<unknown> | null>(null);
  const [holdout, setHoldout] = useState<HoldoutScores>({ baseline: null, final: null });

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
      approvedAt,
      approve: () => setApprovedAt(new Date().toISOString()),
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
        setApprovedAt(null);
        setRunId(null);
        setCheckpoint(null);
        setHoldout({ baseline: null, final: null });
      },
    }),
    [templateId, answers, compiled, approvedAt, runId, checkpoint, holdout],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProject(): ProjectState {
  const v = useContext(Ctx);
  if (!v) throw new Error("ProjectProvider 밖에서 useProject 호출");
  return v;
}
