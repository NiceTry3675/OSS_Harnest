/** 프로젝트 상태 — 페이지 간 공유되는 단일 컨텍스트.
 *  흐름: 인터뷰(answers) → 컴파일(compiled) → 승인(approvedAt 고정) → 실행(checkpoint) → 결과.
 *  승인 이후 compiled는 불변으로 취급한다 — 수정하려면 승인부터 다시(재승인 원칙). */

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { LoopCheckpoint } from "@harnest/contracts";
import type { CompiledProject, Timetable } from "@harnest/template-timetable";

export interface ProjectState {
  answers: Record<string, unknown>;
  setAnswers: (a: Record<string, unknown>) => void;
  compiled: CompiledProject | null;
  setCompiled: (c: CompiledProject | null) => void;
  approvedAt: string | null;
  approve: () => void;
  runId: string | null;
  setRunId: (id: string) => void;
  checkpoint: LoopCheckpoint<Timetable> | null;
  setCheckpoint: (cp: LoopCheckpoint<Timetable>) => void;
  reset: () => void;
}

const Ctx = createContext<ProjectState | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [compiled, setCompiled] = useState<CompiledProject | null>(null);
  const [approvedAt, setApprovedAt] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [checkpoint, setCheckpoint] = useState<LoopCheckpoint<Timetable> | null>(null);

  const value = useMemo<ProjectState>(
    () => ({
      answers,
      setAnswers,
      compiled,
      // 재컴파일 = 판정 절차 변경 → 승인·실행 상태를 반드시 무효화한다(재승인 원칙).
      // 이 리셋이 없으면 새 팩이 옛 승인·옛 체크포인트를 물려받아 동결이 뚫린다.
      setCompiled: (c: CompiledProject | null) => {
        setCompiled(c);
        setApprovedAt(null);
        setRunId(null);
        setCheckpoint(null);
      },
      approvedAt,
      approve: () => setApprovedAt(new Date().toISOString()),
      runId,
      setRunId,
      checkpoint,
      setCheckpoint,
      reset: () => {
        setAnswers({});
        setCompiled(null);
        setApprovedAt(null);
        setRunId(null);
        setCheckpoint(null);
      },
    }),
    [answers, compiled, approvedAt, runId, checkpoint],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProject(): ProjectState {
  const v = useContext(Ctx);
  if (!v) throw new Error("ProjectProvider 밖에서 useProject 호출");
  return v;
}
