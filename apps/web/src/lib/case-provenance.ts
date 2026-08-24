/** 케이스 출처 집계 — 공개(디스클로저) 전용. 템플릿 id가 아니라 caseList 질문 선언을
 *  기준으로 동작하므로 템플릿 분기가 아니다(SPEC §4.3 경계 원칙).
 *  완성 쌍 기준(질문·답 모두 비어있지 않음)은 compile의 필터와 동일하게 맞춘다. */

import type { CaseDef, Question } from "@harnest/contracts";

export interface CaseProvenanceCounts {
  total: number;
  user: number;
  ai: number;
  aiEdited: number;
}

export function countCaseProvenance(
  questions: Question[],
  answers: Record<string, unknown>,
): CaseProvenanceCounts | null {
  const caseQuestion = questions.find((q) => q.type === "caseList");
  if (!caseQuestion) return null;
  const raw = answers[caseQuestion.id];
  if (!Array.isArray(raw)) return null;

  const counts: CaseProvenanceCounts = { total: 0, user: 0, ai: 0, aiEdited: 0 };
  for (const item of raw) {
    const c = item as Partial<CaseDef>;
    const question = String(c.question ?? "").trim();
    const expectedAnswer = String(c.expectedAnswer ?? "").trim();
    if (question.length === 0 || expectedAnswer.length === 0) continue;
    counts.total += 1;
    if (c.provenance === "ai") counts.ai += 1;
    else if (c.provenance === "ai_edited") counts.aiEdited += 1;
    else counts.user += 1;
  }
  return counts;
}
