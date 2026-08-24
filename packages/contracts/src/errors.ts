/** 판정 실행 오류 계약 — 형식 오류는 점수가 아니라 오류다 (SPEC §5.1.1).
 *  채점 출력 해석 실패를 0점으로 변환하면 가짜 점수가 채택 판정·개선 곡선을 오염시킨다.
 *  템플릿은 이 타입을 던지고, 페이지는 이 타입으로만 판별한다 — 메시지 문자열 매칭 금지(경계 원칙 §6). */

export class GradeFormatError extends Error {
  override readonly name = "GradeFormatError";
}

/** 실행 1회의 모델 호출 예산 소진 — 판정 결과가 아니라 운영 한도다 (SPEC §5.2).
 *  폭주 루프·무한 재시도가 BYO 키 비용을 태우지 않게 하는 백스톱이며,
 *  진행은 체크포인트에 남으므로 점수로 변환하지 않고 실행을 중단시킨다. */
export class CallBudgetExceededError extends Error {
  constructor(readonly budget: number) {
    super(`실행 1회의 모델 호출 예산(${budget}회)을 모두 사용했습니다.`);
  }
  override readonly name = "CallBudgetExceededError";
}
