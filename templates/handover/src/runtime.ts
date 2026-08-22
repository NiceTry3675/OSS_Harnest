/** 실행 계층 — 동결 평가자(case_answering)와 LLM Generator를 루프 엔진 슬롯에 맞춘다.
 *  불변식:
 *  - 루프용 scorer는 **가시 케이스만** 채점한다. 홀드아웃은 scoreHoldout으로만 —
 *    호출 시점은 라운드 0과 종료 시(SPEC §3 원칙 7). 이 파일의 어떤 경로도 홀드아웃을
 *    Generator 입력으로 흘리지 않는다.
 *  - responder는 문서+질문만 본다(prompts.responderPrompt가 그 형태를 강제). */

import type { CaseDef, ScoreResult } from "@harnest/contracts";
import type { GeneratorFeedback } from "@harnest/loop-engine";
import type { HandoverDoc, HandoverProblem } from "./index";
import { graderPrompt, mutatePrompt, oneshotPrompt, responderPrompt } from "./prompts";

/** LLM 클라이언트 계약 — 웹이 BYO Gemini 또는 모의 모델을 구현해 주입한다 */
export interface LlmClient {
  readonly providerId: "gemini" | "mock";
  readonly model: string;
  complete(prompt: string, opts?: { temperature?: number; maxOutputTokens?: number }): Promise<string>;
}

export interface CaseGrade {
  caseId: string;
  question: string;
  score: number;
  why: string;
}

function parseGrade(raw: string): { score: number; why: string } {
  const m = raw.match(/"score"\s*:\s*(1(?:\.0)?|0\.5|0(?:\.0)?)/);
  const w = raw.match(/"why"\s*:\s*"([^"]*)"/);
  return { score: m ? Number(m[1]) : 0, why: w ? w[1] : "채점 응답 해석 불가" };
}

/** grader 단독 호출 — 시험관 배터리의 오염 응답 프로브(날조·아첨)가 재사용한다.
 *  채점 의미(프롬프트·파싱)는 이 파일 한 곳에만 존재해야 한다. */
export async function gradeResponse(
  llm: LlmClient,
  question: string,
  expected: string,
  response: string,
): Promise<{ score: number; why: string }> {
  return parseGrade(
    await llm.complete(graderPrompt(question, expected, response), { temperature: 0 }),
  );
}

async function gradeCases(
  llm: LlmClient,
  doc: HandoverDoc,
  cases: CaseDef[],
): Promise<CaseGrade[]> {
  const out: CaseGrade[] = [];
  for (const c of cases) {
    const resp = await llm.complete(responderPrompt(doc, c.question), { temperature: 0 });
    const raw = await llm.complete(graderPrompt(c.question, c.expectedAnswer, resp), {
      temperature: 0,
    });
    const { score, why } = parseGrade(raw);
    out.push({ caseId: c.id, question: c.question, score, why });
  }
  return out;
}

const summarize = (g: CaseGrade): string =>
  `${g.caseId} (${g.question.slice(0, 30)}${g.question.length > 30 ? "…" : ""}): ` +
  `${g.score === 0.5 ? "부분 정답" : "오답"} — ${g.why}`;

/** 동결 평가자 — 게이트(분량) → 가시 케이스 실측 평균 ×100 */
export function createScorer(problem: HandoverProblem, llm: LlmClient) {
  return async (doc: HandoverDoc): Promise<ScoreResult> => {
    if (doc.length > problem.lengthCap) {
      return {
        total: 0,
        violations: [`분량 초과 실격: ${doc.length}자 > ${problem.lengthCap}자`],
        parts: {},
        gateRejected: true,
      };
    }
    const grades = await gradeCases(llm, doc, problem.visibleCases);
    const total =
      Math.round((grades.reduce((a, g) => a + g.score, 0) / grades.length) * 1000) / 10;
    return {
      total,
      violations: grades.filter((g) => g.score < 1).map(summarize),
      parts: { case_answerability: total },
      gateRejected: false,
    };
  };
}

/** 원샷 생성 — 루프의 라운드 0 기준선. 엔진 슬롯(initial(rng))에 맞춰 rng를 받되 쓰지 않는다 */
export function createInitial(problem: HandoverProblem, llm: LlmClient) {
  return async (_rng?: () => number): Promise<HandoverDoc> =>
    (await llm.complete(oneshotPrompt(problem), { temperature: 0.7 })).trim();
}

/** 변이 Generator — 엔진이 넘겨주는 피드백(가시 트레이스)이 수정의 재료 */
export function createGenerator(problem: HandoverProblem, llm: LlmClient) {
  return async (
    champion: HandoverDoc,
    _rng: () => number,
    feedback: GeneratorFeedback,
  ): Promise<HandoverDoc> =>
    (
      await llm.complete(
        mutatePrompt(
          problem,
          champion,
          feedback.championScore,
          feedback.championViolations,
          feedback.round,
        ),
        { temperature: 0.7 },
      )
    ).trim();
}

/** 홀드아웃 채점 — 라운드 0과 종료 시에만 호출할 것. 결과는 루프 판단에 유입 금지 */
export async function scoreHoldout(
  problem: HandoverProblem,
  doc: HandoverDoc,
  llm: LlmClient,
): Promise<{ score: number; perCase: CaseGrade[] }> {
  const grades = await gradeCases(llm, doc, problem.holdoutCases);
  const score =
    Math.round((grades.reduce((a, g) => a + g.score, 0) / grades.length) * 1000) / 10;
  return { score, perCase: grades };
}

/** 라운드당 예상 LLM 콜 수 — 관제실 비용 안내용 */
export function estimateCallsPerRound(problem: HandoverProblem): number {
  return 1 + problem.visibleCases.length * 2;
}
