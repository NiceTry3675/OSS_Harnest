/** 인수인계 문서 분량 정책 — 권장 상한부터 최대 안전 상한까지 선형 감점한다. */

/** 저장 승인본의 scorer 의미를 코드 업데이트 뒤에도 바꾸지 않기 위한 정책 식별자. */
export const LENGTH_POLICY = "soft_overflow_v1" as const;
export type LengthPolicy = typeof LENGTH_POLICY;

/** 권장 상한에 더해 허용하는 초과 구간. 이 값을 넘으면 비용·폭주 방지용 hard gate다. */
export const HARD_LENGTH_OVERFLOW_RATIO = 0.25;
/** 권장 상한부터 hard gate까지 선형으로 누적되는 최대 감점. */
export const MAX_LENGTH_OVERFLOW_PENALTY = 20;

const round1 = (value: number): number => Math.round(value * 10) / 10;

export function hardLengthCapFor(lengthCap: number): number {
  return Math.floor(lengthCap * (1 + HARD_LENGTH_OVERFLOW_RATIO));
}

export function lengthOverflowPenalty(lengthCap: number, docLength: number): number {
  if (docLength <= lengthCap) return 0;
  const hardCap = hardLengthCapFor(lengthCap);
  const progress = (docLength - lengthCap) / (hardCap - lengthCap);
  return round1(Math.min(1, Math.max(0, progress)) * MAX_LENGTH_OVERFLOW_PENALTY);
}

/** 정책 필드가 없는 구버전 승인본을 새 scorer로 조용히 실행하지 않는다. */
export function assertCurrentLengthPolicy(problem: { lengthPolicy?: unknown }): void {
  if (problem.lengthPolicy !== LENGTH_POLICY) {
    throw new Error(
      "저장된 평가 구성은 이전 분량 채점 방식으로 승인되었습니다 — 평가 구성을 다시 만들어 승인해 주세요.",
    );
  }
}
