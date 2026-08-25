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

/** responder 배치 — 불변식(SPEC §5.1.1): 문서와 이번 채점 대상 질문 목록만 본다.
 *  정답·원자료는 싣지 않으며, 가시 채점과 홀드아웃 채점은 같은 호출에 섞지 않는다. */
export function respondersPrompt(
  doc: string,
  cases: Array<Pick<CaseDef, "id" | "question">>,
): string {
  const list = cases.map((c) => `### 질문 (${c.id})\n${c.question}`).join("\n\n");
  return `아래 문서만을 근거로 각 질문에 답하세요. 문서에 근거가 없으면 "문서에 없음"이라고 답하고 추측하지 마세요.
질문마다 독립적으로 답하세요 — 다른 질문의 문구를 답의 근거로 삼지 마세요.

## 문서
${doc}

## 질문 목록
${list}

각 질문에 간결하고 구체적으로 답하되, 설명·코드 펜스 없이 JSON 배열 하나만 출력하세요 (질문마다 한 항목):
[{"caseId": "<질문의 id>", "answer": "<답>"}]`;
}

/** 답 내용은 바꾸지 않고 출력 형식만 한 번 고치게 한다 — graderRetryPrompt와 같은 패턴 */
export function respondersRetryPrompt(
  doc: string,
  cases: Array<Pick<CaseDef, "id" | "question">>,
  malformed: string,
): string {
  return `${respondersPrompt(doc, cases)}

이전 출력은 형식 검증에 실패했습니다:
<invalid-output>
${malformed}
</invalid-output>

설명·코드 펜스 없이 위 스키마의 유효한 JSON 배열 하나만 다시 출력하세요.`;
}

export interface GraderItem {
  caseId: string;
  question: string;
  expected: string;
  response: string;
}

/** grader 배치 — 케이스별 (질문·참조 답·응답)을 한 번에 채점, 0 / 0.5 / 1.
 *  점수 앵커링을 줄이기 위해 케이스마다 독립 채점을 명시한다. */
export function gradersPrompt(items: GraderItem[]): string {
  const blocks = items
    .map(
      (it) => `### 케이스 (${it.caseId})
질문: ${it.question}
참조 답 (기록된 실제 답): ${it.expected}
채점할 응답: ${it.response}`,
    )
    .join("\n\n");
  return `## 채점 목록
각 케이스의 응답이 참조 답의 핵심을 담고 있는지, 케이스마다 독립적으로 채점하세요.

${blocks}

엄격하게:
- 1 — 참조 답의 핵심 사실·해법을 담음
- 0.5 — 방향은 맞지만 핵심 요소가 빠졌거나 잘못된 주장 추가
- 0 — 틀림, 무관, 또는 "문서에 없음"

설명·코드 펜스 없이 JSON 배열 하나만 출력하세요 (케이스마다 한 항목):
[{"caseId": "<케이스 id>", "score": 0 | 0.5 | 1, "why": "<한 문장>"}]`;
}

/** 채점 내용은 바꾸지 않고 출력 형식만 한 번 고치게 한다 */
export function gradersRetryPrompt(items: GraderItem[], malformed: string): string {
  return `${gradersPrompt(items)}

이전 출력은 형식 검증에 실패했습니다:
<invalid-output>
${malformed}
</invalid-output>

설명·코드 펜스 없이 위 스키마의 유효한 JSON 배열 하나만 다시 출력하세요.`;
}

/** grader 단건 — 정답 대조 단일 check, 0 / 0.5 / 1. 루프 채점은 배치(gradersPrompt)로
 *  이동했고, 이 형태는 시험관 배터리의 오염 응답 프로브(케이스 1개 조작)만 사용한다. */
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

/** 케이스 초안 보조(인터뷰 단계) 프롬프트 마커 — 모의 클라이언트가 이 문자열로 분기한다.
 *  기존 마커("아래 문서만을 근거로"[responder 배치]·"## 채점 목록"[grader 배치]·
 *  "JSON만 출력"[grader 단건]·"## 실패 목록"[변이])와 겹치면 안 되고,
 *  이 프롬프트 본문에도 그 문자열들이 등장해서는 안 된다(테스트로 고정). */
export const DRAFT_CASES_MARKER = "## 케이스 초안 요청";

/** 케이스 초안 — 자료에 명시된 내용만 근거로 질답쌍을 제안한다. 산출물은 사용자가
 *  확인·수정한 뒤에만 제출에 포함되므로 이 프롬프트는 동결 판정 절차의 일부가 아니다. */
export function draftCasesPrompt(
  material: string,
  existingQuestions: string[],
  count: number,
  hops = 1,
): string {
  const existingBlock =
    existingQuestions.length > 0
      ? `\n## 이미 입력된 질문 (중복 금지)\n${existingQuestions.map((q) => `- ${q}`).join("\n")}\n`
      : "";
  // 멀티홉(hops ≥ 2) — 실측(experiments/multihop-01) 교훈: "종합하라"만으로는 모델이
  // 복합 질문(두 질문을 '그리고'로 병렬 연결)을 만들어 오히려 쉬워진다.
  // 단일 답 강제 + 교차 필수 + verbatim 근거 인용이 효과의 실체다(arm C).
  const multihopRules =
    hops >= 2
      ? `
- 질문은 하나여야 하고, 답은 짧은 사실 하나(1~3문장)여야 합니다. 독립된 두 질문을 '그리고'로 잇는 복합 질문은 무효입니다.
- 답을 도출하려면 자료의 서로 다른 위치(다른 항목·절·단락)에 있는 사실 ${hops}개가 모두 필요해야 합니다. 한 사실만으로 답할 수 있으면 무효입니다.
- 각 초안에 "evidence"로, 답의 근거가 된 서로 다른 위치의 대목 ${hops}곳을 자료에서 글자 그대로 복사해(각 20~200자) 담으세요.`
      : "";
  const schema =
    hops >= 2
      ? `[{"question": "<질문>", "expectedAnswer": "<답>", "evidence": ["<자료에서 그대로 복사한 인용>", ...]}]`
      : `[{"question": "<질문>", "expectedAnswer": "<답>"}]`;
  return `${DRAFT_CASES_MARKER}
생성 개수: ${count}
교차 사실 수: ${hops}

당신은 인수인계 문서 검증에 쓸 질문·답 쌍의 초안을 만듭니다.
아래 참고 자료를 근거로, 이 업무를 넘겨받는 후임자가 실제로 물을 법한 질문과 그 답 ${count}쌍을 작성하세요.

규칙:
- 답은 자료에 명시된 내용만 근거로 작성하고, 자료에 없는 내용은 지어내지 마세요.
- 자료 밖의 지식(구두로만 전해지던 규칙, 예외 상황)은 이 초안에 담을 수 없습니다 — 그런 질문은 만들지 마세요.
- 이미 입력된 질문과 같거나 사실상 같은 질문은 만들지 마세요.
- 질문은 구체적으로, 답은 간결하고 실행 가능하게 쓰세요.${multihopRules}

## 참고 자료
${material}
${existingBlock}
설명·코드 펜스 없이 JSON 배열 하나만 출력하세요:
${schema}`;
}

/** 초안 내용은 바꾸지 않고 출력 형식만 한 번 고치게 한다 — graderRetryPrompt와 같은 패턴 */
export function draftCasesRetryPrompt(
  material: string,
  existingQuestions: string[],
  count: number,
  malformed: string,
  hops = 1,
): string {
  return `${draftCasesPrompt(material, existingQuestions, count, hops)}

이전 출력은 형식 검증에 실패했습니다:
<invalid-output>
${malformed}
</invalid-output>

설명·코드 펜스 없이 위 스키마의 유효한 JSON 배열 하나만 다시 출력하세요.`;
}

/** 채점 내용은 바꾸지 않고 출력 형식만 한 번 고치게 한다. 클라이언트 호출은 대화 상태가
 *  없으므로 원래 채점 문맥을 다시 싣는다. */
export function graderRetryPrompt(
  question: string,
  expected: string,
  response: string,
  malformed: string,
): string {
  return `${graderPrompt(question, expected, response)}

이전 출력은 JSON 형식 검증에 실패했습니다:
<invalid-output>
${malformed}
</invalid-output>

설명·코드 펜스 없이 위 스키마의 유효한 JSON 객체 하나만 다시 출력하세요.`;
}
