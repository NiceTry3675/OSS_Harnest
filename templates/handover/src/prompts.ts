/** 생성·채점 프롬프트 — 실측(experiments/delta-01)에서 검증된 형태의 한국어 이식.
 *  반영된 교훈: ① 분량은 여유 목표를 함께 명시(02a — 상한만 주면 준수 불가)
 *  ② 변이에는 교환 예산 지침(04 — "더하면서 깎기"를 명시해야 함)
 *  ③ 트레이스(케이스별 실패 사유)가 피드백의 핵심(03·04 — 점수만으로는 개선 없음). */

import type { CaseDef } from "@harnest/contracts";
import type { HandoverProblem } from "./index";

export function limitBlock(cap: number): string {
  const target = Math.floor(cap * 0.8);
  return (
    `절대 분량 제한: ${cap}자 — 이를 넘는 문서는 실격(0점) 처리됩니다. ` +
    `문자 수를 정확히 맞추기는 어려우니 약 ${target}자를 목표로 여유 있게 쓰세요.`
  );
}

function casesBlock(cases: CaseDef[]): string {
  return cases
    .map((c) => `### 질문 (${c.id})\n${c.question}\n\n### 그때의 답\n${c.expectedAnswer}`)
    .join("\n\n");
}

/** 원샷 생성 — 원료는 소개 자료 + 가시 케이스의 Q&A 기록. 홀드아웃은 여기 없다. */
export function oneshotPrompt(problem: HandoverProblem): string {
  return `당신은 인수인계·온보딩 문서를 작성합니다.
목표: 후임자가 아래 기록의 저자에게 묻지 않고, 이 문서만 읽고도 실제로 들어오는 질문들에 답할 수 있게 하는 것.
${limitBlock(problem.lengthCap)}

## 업무 소개 · 참고 자료
${problem.material || "(제공되지 않음)"}

## 실제로 받았던 질문과 답의 기록
${casesBlock(problem.visibleCases)}

문서 본문만 출력하세요 (마크다운 허용).`;
}

/** 변이 — 챔피언 문서 + 가시 채점 트레이스를 받아 수정한다 */
export function mutatePrompt(
  problem: HandoverProblem,
  championDoc: string,
  championScore: number,
  violations: string[],
  round: number,
): string {
  return `아래는 인수인계 문서와, 동결된 평가 절차의 채점 결과입니다.
평가 방식: 문서만 읽은 응답자가 실제 질문들에 답하고, 기록된 정답과 대조했습니다.
실패 목록을 고치되 이미 맞는 내용을 깨지 마세요.
내용을 추가해야 한다면 먼저 덜 중요한 내용을 비슷한 분량만큼 삭제하세요 — 분량 제한이 있습니다.
${limitBlock(problem.lengthCap)}

## 업무 소개 · 참고 자료
${problem.material || "(제공되지 않음)"}

## 실제로 받았던 질문과 답의 기록
${casesBlock(problem.visibleCases)}

## 현재 문서 (점수 ${championScore}/100)
${championDoc}

## 실패 목록
${violations.length > 0 ? violations.join("\n") : "(없음 — 표현을 다듬되 내용 커버리지를 유지하세요)"}

수정한 문서 전문만 출력하세요. <!-- 라운드 ${round} -->`;
}

/** responder — 불변식: 문서와 해당 케이스 질문만 본다. 원문 자료도, 정답도, 다른 케이스도 없다. */
export function responderPrompt(doc: string, question: string): string {
  return `아래 문서만을 근거로 질문에 답하세요. 문서에 근거가 없으면 "문서에 없음"이라고 답하고 추측하지 마세요.

## 문서
${doc}

## 질문
${question}

간결하고 구체적으로 답하세요.`;
}

/** grader — 정답 대조 단일 check, 0 / 0.5 / 1 */
export function graderPrompt(question: string, expected: string, response: string): string {
  return `응답이 참조 답의 핵심을 담고 있는지 채점하세요.

## 질문
${question}

## 참조 답 (기록된 실제 답)
${expected}

## 채점할 응답
${response}

엄격하게:
- 1 — 참조 답의 핵심 사실·해법을 담음
- 0.5 — 방향은 맞지만 핵심 요소가 빠졌거나 잘못된 주장 추가
- 0 — 틀림, 무관, 또는 "문서에 없음"

JSON만 출력: {"score": 0 | 0.5 | 1, "why": "<한 문장>"}`;
}
