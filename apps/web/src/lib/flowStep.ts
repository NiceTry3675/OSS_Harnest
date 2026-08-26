/** 템플릿별 흐름 단계와 현재 위치를 연결하는 표시 전용 상태.
 *
 * 라우트나 전역 숫자 인덱스에 단계를 결속하지 않는다. 질문 순서가 바뀌어도 현재 질문은
 * questionId로 찾고, 승인 칸은 현재 definitionDigest에 결속된 승인만 "동결"로 표시한다. */

import { useSyncExternalStore } from "react";
import type { Question } from "@harnest/contracts";

export type FlowCursor =
  | { kind: "outside" }
  | { kind: "question"; questionId: string }
  | { kind: "approval" }
  | { kind: "run" }
  | { kind: "result" };

/** 질문 뒤에 이어지는 공통 흐름의 템플릿별 사용자 문구. */
export interface TemplateFlow {
  approval: {
    pending: string;
    approved: string;
  };
  run: string;
  result: string;
}

type FlowQuestion = Pick<Question, "id" | "label" | "shortLabel" | "sameStep">;

export interface FlowStep {
  id: `question:${string}` | "approval:pending" | "approval:approved" | "run" | "result";
  label: string;
}

export interface FlowSource {
  questions: readonly FlowQuestion[];
  flow: TemplateFlow;
}

export interface FlowApprovalState {
  definitionDigest: string | null;
  approvedDigest: string | null;
  approvedAt: string | null;
}

export interface ResolvedFlow {
  steps: FlowStep[];
  index: number;
  current: FlowStep;
  approvedForCurrentDigest: boolean;
}

/** 자기 칸을 갖는 질문만 — 앞 질문에 붙은 것은 뺀다 */
function ownSteps(questions: readonly FlowQuestion[]): readonly FlowQuestion[] {
  return questions.filter((question) => !question.sameStep);
}

/** 질문은 템플릿 선언에서 자동 생성하고, 승인 전·후는 서로 다른 두 칸으로 유지한다. */
export function buildFlowSteps(
  questions: readonly FlowQuestion[],
  flow: TemplateFlow,
): FlowStep[] {
  return [
    // 앞 질문에 붙은 질문은 자기 칸을 갖지 않는다 — 같은 화면에서 함께 묻는다
    ...ownSteps(questions).map((question) => ({
      id: `question:${question.id}` as const,
      label: question.shortLabel ?? question.label,
    })),
    { id: "approval:pending", label: flow.approval.pending },
    { id: "approval:approved", label: flow.approval.approved },
    { id: "run", label: flow.run },
    { id: "result", label: flow.result },
  ];
}

/** 승인 시각과 다이제스트가 모두 있어야 하며, 현재 Pack의 다이제스트와 정확히 같아야 한다. */
export function isApprovedForDigest({
  definitionDigest,
  approvedDigest,
  approvedAt,
}: FlowApprovalState): boolean {
  return (
    approvedAt !== null &&
    definitionDigest !== null &&
    approvedDigest === definitionDigest
  );
}

/** 의미 커서를 템플릿별 단계 인덱스로 바꾼다. 알 수 없는 질문은 안전하게 흐름 밖으로 본다. */
export function resolveFlowIndex(
  cursor: FlowCursor,
  questions: readonly FlowQuestion[],
  approvedForCurrentDigest: boolean,
): number {
  switch (cursor.kind) {
    case "outside":
      return -1;
    case "question":
      return ownSteps(questions).findIndex((question) => question.id === cursor.questionId);
    case "approval":
      return ownSteps(questions).length + (approvedForCurrentDigest ? 1 : 0);
    case "run":
      return ownSteps(questions).length + 2;
    case "result":
      return ownSteps(questions).length + 3;
  }
}

/** StepBar가 소비하는 최종 표시 모델을 만드는 순수 resolver. */
export function resolveFlow(
  source: FlowSource | null,
  cursor: FlowCursor,
  approval: FlowApprovalState,
): ResolvedFlow | null {
  if (source === null || cursor.kind === "outside") return null;

  const approvedForCurrentDigest = isApprovedForDigest(approval);
  const steps = buildFlowSteps(source.questions, source.flow);
  const index = resolveFlowIndex(cursor, source.questions, approvedForCurrentDigest);
  const current = steps[index];
  if (index < 0 || current === undefined) return null;

  return { steps, index, current, approvedForCurrentDigest };
}

const OUTSIDE: FlowCursor = { kind: "outside" };
let currentCursor: FlowCursor = OUTSIDE;
const listeners = new Set<() => void>();

function sameCursor(a: FlowCursor, b: FlowCursor): boolean {
  return (
    a.kind === b.kind &&
    (a.kind !== "question" || (b.kind === "question" && a.questionId === b.questionId))
  );
}

export function setFlowStep(cursor: FlowCursor): void {
  if (sameCursor(currentCursor, cursor)) return;
  currentCursor = cursor;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFlowStep(): FlowCursor {
  return useSyncExternalStore(
    subscribe,
    () => currentCursor,
    () => OUTSIDE,
  );
}
