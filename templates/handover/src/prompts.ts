/** 생성·채점 프롬프트 — 실측(experiments/delta-01)에서 검증된 형태의 한국어 이식.
 *  반영된 교훈: ① 분량은 여유 목표를 함께 명시(02a — 상한만 주면 준수 불가)
 *  ② 변이에는 교환 예산 지침(04 — "더하면서 깎기"를 명시해야 함)
 *  ③ 트레이스(케이스별 실패 사유)가 피드백의 핵심(03·04 — 점수만으로는 개선 없음). */

import type { CaseDef, ExperimentStrategy } from "@harnest/contracts";
import type { GeneratorFeedback } from "@harnest/loop-engine";
import type { HandoverProblem } from "./index";
import { hardLengthCapFor, MAX_LENGTH_OVERFLOW_PENALTY } from "./length";

export function limitBlock(cap: number): string {
  const target = Math.floor(cap * 0.8);
  const hardCap = hardLengthCapFor(cap);
  return (
    `권장 분량 상한: ${cap}자 — 초과분은 ${hardCap}자까지 점진적으로 최대 ${MAX_LENGTH_OVERFLOW_PENALTY}점 감점되고, ` +
    `${hardCap}자를 넘으면 실격 처리됩니다. 약 ${target}자를 목표로 여유 있게 쓰세요.`
  );
}

function casesBlock(cases: CaseDef[]): string {
  return cases
    .map((c) => `### 질문 (${c.id})\n${c.question}\n\n### 그때의 답\n${c.expectedAnswer}`)
    .join("\n\n");
}

export const HANDOVER_STRATEGIES = [
  {
    key: "targeted_repair",
    label: "누락 항목 직접 보강",
    description: "현재 실패 질문의 누락 정보만 좁게 보강하고 이미 맞는 부분을 최대한 유지한다.",
  },
  {
    key: "restructure_for_retrieval",
    label: "검색 가능한 구조로 재편",
    description: "제목·순서·표·체크리스트를 재구성해 필요한 답을 더 쉽게 찾게 한다.",
  },
  {
    key: "compress_and_reallocate",
    label: "중복 압축 후 분량 재배치",
    description: "중복과 저가치 설명을 줄여 확보한 분량을 부족한 주제에 배분한다.",
  },
  {
    key: "source_regrounding",
    label: "참고 자료 재검토",
    description: "현재 문서보다 참고 자료를 다시 중심에 두고 빠진 주제와 예외를 복원한다.",
  },
  {
    key: "consistency_pass",
    label: "전체 일관성 교정",
    description: "서로 충돌하는 절차·용어·예외를 정리하면서 기존 커버리지를 보존한다.",
  },
] as const;

function publicExperimentsBlock(
  records: GeneratorFeedback["recentPublicExperiments"],
): string {
  if (!records || records.length === 0) return "(아직 기록된 공개 실험이 없음)";
  return records
    .map((record) => {
      const strategy = record.strategy
        ? `${record.strategy.key} — ${record.strategy.summary}`
        : "전략 기록 없음";
      const delta = `${record.scoreDelta >= 0 ? "+" : ""}${record.scoreDelta.toFixed(1)}점`;
      const verdict = record.adopted
        ? "채택"
        : record.gateRejected
          ? "필수 조건 위반으로 기각"
          : "점수 개선 없음으로 기각";
      const shownViolations = record.violations.slice(0, 5);
      const violations = shownViolations.length === 0
        ? "공개 실패 사유 없음"
        : shownViolations.join(" / ") +
          (record.violations.length > shownViolations.length
            ? ` / 외 ${record.violations.length - shownViolations.length}개`
            : "");
      return `- ${record.round}회차 | 전략: ${strategy} | 후보 ${record.candidateScore}점 (${delta}) | ${verdict} | ${violations}`;
    })
    .join("\n");
}

/** 후보를 쓰기 전에 이번 수정 전략을 하나 고른다. 가드·홀드아웃 정보는 입력 계약에 없다. */
export function strategyPrompt(
  problem: HandoverProblem,
  championDoc: string,
  feedback: GeneratorFeedback,
): string {
  const blocked = new Set(feedback.blockedStrategyKeys ?? []);
  const available = HANDOVER_STRATEGIES.filter((strategy) => !blocked.has(strategy.key));
  return `당신은 인수인계 문서 개선 실험의 전략을 선택합니다.
후보 문서를 아직 작성하지 말고, 이번 회차에 사용할 수정 전략 하나만 결정하세요.
최근 공개 실험에서 반복 실패한 전략은 다시 선택할 수 없습니다.

## 선택 가능한 전략
${available.map((strategy) => `- ${strategy.key}: ${strategy.label} — ${strategy.description}`).join("\n")}

## 이번에 선택할 수 없는 전략
${blocked.size === 0 ? "(없음)" : [...blocked].join(", ")}

## 최근 공개 실험 기록
${publicExperimentsBlock(feedback.recentPublicExperiments)}

## 현재 챔피언 (${feedback.championScore}/100)
${championDoc}

## 현재 공개 실패 목록
${feedback.championViolations.length > 0 ? feedback.championViolations.join("\n") : "(없음)"}

## 참고 자료
${problem.material || "(제공되지 않음)"}

## 공개 질문과 기대 답
${casesBlock(problem.visibleCases)}

반드시 선택 가능한 key 하나와 이번 문서에서 실제로 할 일을 구체적으로 설명하세요.
설명·코드 펜스 없이 JSON 객체 하나만 출력하세요:
{"key":"<전략 key>","summary":"<구체적인 수정 계획, 1~2문장>"}`;
}

export function strategyRetryPrompt(
  problem: HandoverProblem,
  championDoc: string,
  feedback: GeneratorFeedback,
  malformed: string,
): string {
  return `${strategyPrompt(problem, championDoc, feedback)}

이전 출력은 사용할 수 없었습니다:
${malformed}

후보 문서는 쓰지 말고 위 형식의 JSON 객체만 다시 출력하세요.`;
}

/** 원샷 생성 — 원료는 소개 자료 + 피드백(가시) 케이스의 Q&A 기록. 가드·홀드아웃은 여기 없다. */
export function oneshotPrompt(problem: HandoverProblem): string {
  return `당신은 인수인계·온보딩 문서를 작성합니다.
목표: 후임자가 아래 기록의 저자에게 묻지 않고, 이 문서만 읽고도 실제로 들어오는 질문들에 답할 수 있게 하는 것.
아래 기록은 실제 질문의 표본일 뿐입니다 — 기록에 없는 질문도 들어오므로, 참고 자료의 주제 전반을 고르게 다루세요.
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
  previousPublicAttempt?: GeneratorFeedback["previousPublicAttempt"],
  strategy?: ExperimentStrategy,
  recentPublicExperiments?: GeneratorFeedback["recentPublicExperiments"],
): string {
  const previousAttemptBlock = previousPublicAttempt
    ? `
## 직전 기각 시도에서 공개 기준으로 확인한 것
후보 점수: ${previousPublicAttempt.candidateScore}/100 (${previousPublicAttempt.scoreDelta >= 0 ? "+" : ""}${previousPublicAttempt.scoreDelta.toFixed(1)}점)
판정: ${previousPublicAttempt.gateRejected ? "최대 분량 위반" : "현재 챔피언보다 점수가 높지 않음"}
${
  previousPublicAttempt.violations.length > 0
    ? previousPublicAttempt.violations.join("\n")
    : "공개 기준의 추가 실패 사유는 없습니다."
}
같은 실패를 반복하지 말고 다른 수정 전략을 사용하세요.
`
    : "";
  const strategyBlock = strategy
    ? `
## 이번 수정 전략
${strategy.key}: ${strategy.summary}
이 전략을 실제 문서 수정에 반영하세요.
`
    : "";
  const experimentBlock = recentPublicExperiments
    ? `
## 최근 공개 실험 기록
${publicExperimentsBlock(recentPublicExperiments)}
`
    : "";
  return `아래는 인수인계 문서와, 동결된 평가 절차의 채점 결과입니다.
평가 방식: 문서만 읽은 응답자가 실제 질문들에 답하고, 기록된 정답과 대조했습니다.
실패 목록을 고치되 이미 맞는 내용을 깨지 마세요.
내용을 추가해야 한다면 먼저 덜 중요한 내용을 비슷한 분량만큼 삭제하세요 — 분량 제한이 있습니다.${
    problem.guardCases.length > 0
      ? `\n채점에는 아래 기록 외에 공개되지 않는 검증 질문들도 쓰입니다 — 검증 점수가 나빠진 수정본은 채택되지 않습니다.
실패 목록만 좁게 때우거나 기록의 문답을 그대로 옮겨 적지 말고, 참고 자료의 다른 주제 커버리지도 함께 유지하세요.`
      : ""
  }
${limitBlock(problem.lengthCap)}${
    problem.useConciseness
      ? `\n간결성 가점: 같은 커버리지면 짧은 문서가 더 높은 점수를 받습니다 (현재 ${championDoc.length.toLocaleString()}자).`
      : ""
  }

## 업무 소개 · 참고 자료
${problem.material || "(제공되지 않음)"}

## 실제로 받았던 질문과 답의 기록
${casesBlock(problem.visibleCases)}

## 현재 문서 (점수 ${championScore}/100)
${championDoc}

## 실패 목록
${violations.length > 0 ? violations.join("\n") : "(없음 — 표현을 다듬되 내용 커버리지를 유지하세요)"}
${previousAttemptBlock}
${experimentBlock}
${strategyBlock}

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

why는 점수를 되풀이하지 말고 판정의 근거를 밝히세요. 응답이 참조 답의 어느 핵심을
담았는지(또는 무엇이 빠지고 무엇이 틀렸는지)를 먼저 짚고, 그래서 이 점수라는 것을
한 문장으로 이으세요.

설명·코드 펜스 없이 JSON 배열 하나만 출력하세요 (케이스마다 한 항목):
[{"caseId": "<케이스 id>", "score": 0 | 0.5 | 1, "why": "<근거 → 판정, 한 문장>"}]`;
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

why는 점수를 되풀이하지 말고 판정의 근거를 밝히세요 — 참조 답의 어느 핵심을 담았는지
(또는 무엇이 빠졌는지)를 짚고 그래서 이 점수라는 것을 한 문장으로 이으세요.

JSON만 출력: {"score": 0 | 0.5 | 1, "why": "<근거 → 판정, 한 문장>"}`;
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
