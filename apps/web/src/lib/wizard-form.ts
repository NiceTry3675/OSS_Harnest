/** 위저드 폼 순수 로직 — 스텝 검증과 초안 → 인터뷰 답변 변환.
 *  불변식: 확인되지 않은 AI 초안(needsConfirm)은 answers에 절대 실리지 않는다.
 *  toAnswers가 원천 제거하므로 라이브 블루프린트 경유 컴파일에서도 다이제스트에 못 들어간다. */

import type { Question } from "@harnest/contracts";
import type { CasePair } from "../components/WizardCaseList";

export type DraftValue = string | CasePair[] | unknown[];

/** caseList 안내 기본 범위 — 질문이 min/max를 선언하면 그 값을 따른다 */
export const CASE_MIN_DEFAULT = 4;
export const CASE_MAX_DEFAULT = 9;

export function validate(q: Question, value: DraftValue): string | null {
  if (q.type === "sourceDocuments") {
    const documents = Array.isArray(value) ? value : [];
    const min = q.min ?? (q.required ? 1 : 0);
    if (documents.length < min) return `자료 파일을 ${min}개 이상 첨부해 주세요.`;
    if (q.max !== undefined && documents.length > q.max) {
      return `자료 파일은 ${q.max}개까지 첨부할 수 있습니다.`;
    }
    return null;
  }
  if (q.type === "caseList") {
    const pairs = (Array.isArray(value) ? value : []) as CasePair[];
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
  if (q.type === "toggle") return null; // 켬/끔 — 기본값이 있으므로 항상 유효
  // 채점 모델은 답변 맵이 아니라 위저드가 따로 들고 있다(공급자·키·모델 이름).
  // 여기에 실릴 값이 없으므로 빈 값 검사에 걸려선 안 된다.
  if (q.type === "judgeModel") return null;
  if (q.type === "textarea") {
    if (q.required && v === "") return "내용을 입력해 주세요.";
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
      const pairs = (Array.isArray(value) ? value : []) as CasePair[];
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
    if (q.type === "sourceDocuments") {
      answers[q.id] = Array.isArray(value) ? structuredClone(value) : [];
      continue;
    }
    const raw = typeof value === "string" ? value.trim() : "";
    if (q.type === "toggle") {
      // 명시적 "false"만 끔 — 손대지 않은 초안은 선언된 기본값(없으면 켬)을 따른다
      answers[q.id] = raw === "" ? q.defaultValue !== false : raw !== "false";
      continue;
    }
    // 채점 모델은 judgeProcedure로 따로 들어간다 — 답변 맵에 빈 값을 남기지 않는다
    if (q.type === "judgeModel") continue;
    answers[q.id] = q.type === "number" ? Number(raw) : raw;
  }
  return answers;
}
