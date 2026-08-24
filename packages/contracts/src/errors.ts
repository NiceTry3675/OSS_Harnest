/** 판정 실행 오류 계약 — 형식 오류는 점수가 아니라 오류다 (SPEC §5.1.1).
 *  채점 출력 해석 실패를 0점으로 변환하면 가짜 점수가 채택 판정·개선 곡선을 오염시킨다.
 *  템플릿은 이 타입을 던지고, 페이지는 이 타입으로만 판별한다 — 메시지 문자열 매칭 금지(경계 원칙 §6). */

export class GradeFormatError extends Error {
  override readonly name = "GradeFormatError";
}
