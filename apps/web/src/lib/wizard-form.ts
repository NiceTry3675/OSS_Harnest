/** 위저드 폼 순수 로직 — 스텝 검증과 초안 → 인터뷰 답변 변환.
 *  불변식: 확인되지 않은 AI 초안(needsConfirm)은 answers에 절대 실리지 않는다.
 *  toAnswers가 원천 제거하므로 라이브 블루프린트 경유 컴파일에서도 다이제스트에 못 들어간다. */

import type { Question } from "@harnest/contracts";
import type { CasePair } from "../components/WizardCaseList";

export type DraftValue = string | CasePair[];

/** caseList 안내 기본 범위 — 질문이 min/max를 선언하면 그 값을 따른다 */
export const CASE_MIN_DEFAULT = 4;
export const CASE_MAX_DEFAULT = 9;

export function validate(q: Question, value: DraftValue): string | null {
  if (q.type === "caseList") {
    const pairs = Array.isArray(value) ? value : [];
    if (pairs.some((p) => p.needsConfirm)) {
      return "AI 초안 쌍을 검토한 뒤 확인 버튼을 눌러 주세요 — 확인하지 않은 초안은 제출되지 않습니다.";
    }
    const halfFilled = pairs.some(
      (p) => (p.question.trim() === "") !== (p.expectedAnswer.trim() === ""),
    );
    if (halfFilled) return "각 쌍의 질문과 답을 모두 채워 주세요.";
    const complete = pairs.filter((p) => p.question.trim() && p.expectedAnswer.trim());
    const min = q.min ?? CASE_MIN_DEFAULT;
    if (complete.length < min) return `질문·답 쌍을 ${min}개 이상 채워 주세요.`;
    return null;
  }
  const v = typeof value === "string" ? value.trim() : "";
  if (q.type === "textarea") {
    if (q.maxChars !== undefined && v.length > q.maxChars) {
      return `최대 ${q.maxChars.toLocaleString()}자까지 입력할 수 있습니다 (현재 ${v.length.toLocaleString()}자).`;
    }
    return null; // 선택 입력 — 빈 값 통과
  }
  if (q.type === "staffList") {
    const names = v.split(",").map((s) => s.trim()).filter(Boolean);
    if (names.length < 3) return "쉼표로 구분해 3명 이상 입력해 주세요.";
    return null;
  }
  if (q.type === "number") {
    if (v === "") return "값을 입력해 주세요.";
    const n = Number(v);
    if (!Number.isInteger(n)) return "정수를 입력해 주세요.";
    if (q.min !== undefined && q.max !== undefined && (n < q.min || n > q.max)) {
      return `${q.min}~${q.max} 사이의 정수를 입력해 주세요.`;
    }
    if (q.min !== undefined && n < q.min) return `${q.min} 이상이어야 합니다.`;
    if (q.max !== undefined && n > q.max) return `${q.max} 이하여야 합니다.`;
    return null;
  }
  if (v === "") return "값을 입력해 주세요.";
  return null;
}

/** 폼 초안 → 인터뷰 답변 맵(숫자는 number, caseList는 완성된 쌍 배열 — id는 compile이 부여).
 *  provenance는 "ai"/"ai_edited"만 싣는다 — "user" 생략 규약(직접 입력 다이제스트 보존). */
export function toAnswers(
  questions: Question[],
  draft: Record<string, DraftValue>,
): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  for (const q of questions) {
    const value = draft[q.id];
    if (q.type === "caseList") {
      const pairs = Array.isArray(value) ? value : [];
      answers[q.id] = pairs
        .filter((p) => !p.needsConfirm)
        .map((p) => ({
          question: p.question.trim(),
          expectedAnswer: p.expectedAnswer.trim(),
          ...(p.provenance === "ai" || p.provenance === "ai_edited"
            ? { provenance: p.provenance }
            : {}),
        }))
        .filter((p) => p.question.length > 0 && p.expectedAnswer.length > 0);
      continue;
    }
    const raw = typeof value === "string" ? value.trim() : "";
    answers[q.id] = q.type === "number" ? Number(raw) : raw;
  }
  return answers;
}
