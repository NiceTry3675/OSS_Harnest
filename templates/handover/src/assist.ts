/** 인터뷰 단계 케이스 초안 보조 — 동결·실행 예산과 무관한 편의 계층.
 *  산출물은 사용자가 확인·수정해야만 제출에 포함되며(위저드가 강제), 여기서 만든 어떤 값도
 *  판정 절차나 루프에 직접 유입되지 않는다. 호출 상한은 SPEC §5.2의 보조 호출 정책을 따른다. */

import { draftCasesPrompt, draftCasesRetryPrompt } from "./prompts";
import { normalizeQuestion, withCallBudget, withoutCodeFence, type LlmClient } from "./runtime";

/** 클릭 1회의 초안 개수 상한 — 남은 슬롯이 더 커도 이 수를 넘지 않는다 */
export const MAX_DRAFTS_PER_CLICK = 3;
/** 클릭 1회 호출 상한 = 본 호출 1 + 형식 재시도 1 (실행 예산 밖의 별도 백스톱) */
export const ASSIST_CALLS_PER_CLICK = 2;
/** 초안의 근거가 될 최소 자료 분량 */
export const ASSIST_MIN_MATERIAL_CHARS = 50;

export interface DraftedCase {
  question: string;
  expectedAnswer: string;
}

/** 형식 오류 구분용 모듈 지역 타입 — 위저드 인라인 표시 전용이라 계약 오류로 승격하지 않는다 */
class DraftFormatError extends Error {}

function parseDraftedCases(raw: string): DraftedCase[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(withoutCodeFence(raw));
  } catch {
    throw new DraftFormatError("초안 출력이 유효한 JSON 배열이 아닙니다.");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new DraftFormatError("초안 출력은 비어 있지 않은 JSON 배열이어야 합니다.");
  }
  return parsed.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new DraftFormatError("초안의 각 항목은 JSON 객체여야 합니다.");
    }
    const value = item as Record<string, unknown>;
    if (typeof value.question !== "string" || value.question.trim().length === 0) {
      throw new DraftFormatError("초안의 question은 비어 있지 않은 문자열이어야 합니다.");
    }
    if (typeof value.expectedAnswer !== "string" || value.expectedAnswer.trim().length === 0) {
      throw new DraftFormatError("초안의 expectedAnswer는 비어 있지 않은 문자열이어야 합니다.");
    }
    return { question: value.question.trim(), expectedAnswer: value.expectedAnswer.trim() };
  });
}

/** 케이스 초안 생성 — 클릭당 본 호출 1회, 형식 재시도 1회. 기존 질문과 중복은 제거한다. */
export async function draftCases(
  llm: LlmClient,
  material: string,
  existing: DraftedCase[],
  count: number,
): Promise<DraftedCase[]> {
  if (material.trim().length < ASSIST_MIN_MATERIAL_CHARS) {
    throw new Error(
      `참고 자료가 너무 짧아 초안을 만들 수 없습니다 — 자료를 ${ASSIST_MIN_MATERIAL_CHARS}자 이상 먼저 채워 주세요.`,
    );
  }
  const clamped = Math.max(1, Math.min(count, MAX_DRAFTS_PER_CLICK));
  const existingQuestions = existing.map((c) => c.question);
  const budgeted = withCallBudget(llm, ASSIST_CALLS_PER_CLICK);

  const first = await budgeted.complete(
    draftCasesPrompt(material, existingQuestions, clamped),
    { temperature: 0.7 },
  );
  let drafted: DraftedCase[];
  try {
    drafted = parseDraftedCases(first);
  } catch (error) {
    if (!(error instanceof DraftFormatError)) throw error;
    const retried = await budgeted.complete(
      draftCasesRetryPrompt(material, existingQuestions, clamped, first),
      { temperature: 0.7 },
    );
    try {
      drafted = parseDraftedCases(retried);
    } catch (retryError) {
      if (retryError instanceof DraftFormatError) {
        throw new Error(
          "초안 출력을 해석할 수 없습니다 — 잠시 후 다시 시도하거나 다른 모델을 선택해 주세요.",
        );
      }
      throw retryError;
    }
  }

  const seen = new Set(existingQuestions.map(normalizeQuestion));
  const fresh: DraftedCase[] = [];
  for (const c of drafted) {
    const key = normalizeQuestion(c.question);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(c);
  }
  return fresh.slice(0, clamped);
}
