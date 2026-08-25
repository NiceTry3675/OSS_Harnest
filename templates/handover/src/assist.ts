/** 인터뷰 단계 케이스 초안 보조 — 동결·실행 예산과 무관한 편의 계층.
 *  산출물은 사용자가 확인·수정해야만 제출에 포함되며(위저드가 강제), 여기서 만든 어떤 값도
 *  판정 절차나 루프에 직접 유입되지 않는다. 호출 상한은 SPEC §5.2의 보조 호출 정책을 따른다. */

import { draftCasesPrompt, draftCasesRetryPrompt } from "./prompts";
import {
  batchOutputTokensFor,
  normalizeQuestion,
  withCallBudget,
  withoutCodeFence,
  type LlmClient,
} from "./runtime";

/** 클릭 1회 호출 상한 = 본 호출 1 + 형식 재시도 1 (실행 예산 밖의 별도 백스톱).
 *  초안 개수는 호출 수와 무관하므로 따로 상한하지 않는다 — 남은 슬롯 계산은 호출자(위저드) 몫. */
export const ASSIST_CALLS_PER_CLICK = 2;
/** 초안의 근거가 될 최소 자료 분량 */
export const ASSIST_MIN_MATERIAL_CHARS = 50;

/** 멀티홉 초안의 근거 인용 — 확인 UI 표시 전용이며 제출·다이제스트에 실리지 않는다.
 *  found는 공백 정규화 부분 문자열 대조 결과(실측 multihop-01: 실존율 93~100%). */
export interface DraftEvidence {
  quote: string;
  found: boolean;
}

export interface DraftedCase {
  question: string;
  expectedAnswer: string;
  evidence?: DraftEvidence[];
}

/** 형식 오류 구분용 모듈 지역 타입 — 위저드 인라인 표시 전용이라 계약 오류로 승격하지 않는다 */
class DraftFormatError extends Error {}

/** 근거 대조용 정규화 — 모델 인용의 공백·개행 차이를 흡수한다 */
function normalizeForMatch(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function parseDraftedCases(raw: string, hops: number): DraftedCase[] {
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
    const drafted: DraftedCase = {
      question: value.question.trim(),
      expectedAnswer: value.expectedAnswer.trim(),
    };
    if (hops >= 2) {
      const quotes = Array.isArray(value.evidence)
        ? value.evidence.filter((e): e is string => typeof e === "string" && e.trim().length > 0)
        : [];
      if (quotes.length < hops) {
        throw new DraftFormatError(`초안의 evidence는 자료 인용 ${hops}개를 담은 배열이어야 합니다.`);
      }
      drafted.evidence = quotes.slice(0, hops).map((quote) => ({ quote: quote.trim(), found: false }));
    }
    return drafted;
  });
}

/** 케이스 초안 생성 — 클릭당 본 호출 1회, 형식 재시도 1회. 기존 질문과 중복은 제거한다.
 *  hops ≥ 2면 서로 다른 위치의 사실 hops개 교차를 요구하고(멀티홉·단일 답 강제),
 *  근거 인용을 원료와 로컬 대조해 표시용 found를 채운다 — drop 필터가 아니다. */
export async function draftCases(
  llm: LlmClient,
  material: string,
  existing: DraftedCase[],
  count: number,
  hops = 1,
): Promise<DraftedCase[]> {
  if (material.trim().length < ASSIST_MIN_MATERIAL_CHARS) {
    throw new Error(
      `참고 자료가 너무 짧아 초안을 만들 수 없습니다 — 자료를 ${ASSIST_MIN_MATERIAL_CHARS}자 이상 먼저 채워 주세요.`,
    );
  }
  const clamped = Math.max(1, Math.floor(count));
  const clampedHops = Math.max(1, Math.floor(hops));
  const existingQuestions = existing.map((c) => c.question);
  const budgeted = withCallBudget(llm, ASSIST_CALLS_PER_CLICK);
  // 초안은 항목당 질문+답 쌍이라 채점 배치보다 길다 — 2항목분(근거 포함 시 3항목분) 예산으로 절단을 막는다
  const maxOutputTokens = batchOutputTokensFor(clamped * (clampedHops >= 2 ? 3 : 2));

  const first = await budgeted.complete(
    draftCasesPrompt(material, existingQuestions, clamped, clampedHops),
    { temperature: 0.7, maxOutputTokens },
  );
  let drafted: DraftedCase[];
  try {
    drafted = parseDraftedCases(first, clampedHops);
  } catch (error) {
    if (!(error instanceof DraftFormatError)) throw error;
    const retried = await budgeted.complete(
      draftCasesRetryPrompt(material, existingQuestions, clamped, first, clampedHops),
      { temperature: 0.7, maxOutputTokens },
    );
    try {
      drafted = parseDraftedCases(retried, clampedHops);
    } catch (retryError) {
      if (retryError instanceof DraftFormatError) {
        throw new Error(
          "초안 출력을 해석할 수 없습니다 — 잠시 후 다시 시도하거나 다른 모델을 선택해 주세요.",
        );
      }
      throw retryError;
    }
  }

  // 근거 실존 대조 — 표시용 신호일 뿐 초안을 걸러내지 않는다(확인·수정은 사용자 몫)
  const normalizedMaterial = normalizeForMatch(material);
  for (const c of drafted) {
    for (const e of c.evidence ?? []) {
      e.found = normalizedMaterial.includes(normalizeForMatch(e.quote));
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
