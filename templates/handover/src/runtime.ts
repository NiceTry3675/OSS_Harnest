/** 실행 계층 — 동결 평가자(case_answering)와 LLM Generator를 루프 엔진 슬롯에 맞춘다.
 *  불변식:
 *  - 루프용 scorer는 **가시 케이스만** 채점한다. 홀드아웃은 scoreHoldout으로만 —
 *    호출 시점은 라운드 0과 종료 시(SPEC §3 원칙 7). 이 파일의 어떤 경로도 홀드아웃을
 *    Generator 입력으로 흘리지 않는다.
 *  - responder는 문서+질문만 본다(prompts.responderPrompt가 그 형태를 강제). */

import {
  GradeFormatError,
  type CaseDef,
  type JudgeProvider,
  type ScoreResult,
} from "@harnest/contracts";
import type { GeneratorFeedback } from "@harnest/loop-engine";
import type { HandoverDoc, HandoverProblem } from "./index";
import {
  graderPrompt,
  graderRetryPrompt,
  mutatePrompt,
  oneshotPrompt,
  responderPrompt,
} from "./prompts";

/** LLM 클라이언트 계약 — 웹이 BYO 벤더 또는 모의 모델을 구현해 주입한다 */
export interface LlmClient {
  readonly providerId: JudgeProvider;
  readonly model: string;
  complete(prompt: string, opts?: { temperature?: number; maxOutputTokens?: number }): Promise<string>;
}

export interface CaseGrade {
  caseId: string;
  question: string;
  score: number;
  why: string;
}

export interface HoldoutCaseGrade extends CaseGrade {
  /** 반복은 같은 질문이 가시 세트에도 있다는 뜻이며, 차단하지 않고 결과에서 구분한다. */
  caseType: "repeated" | "new";
}

export type HoldoutScoreResult =
  | {
      gateRejected: true;
      score: null;
      perCase: [];
      violations: string[];
    }
  | {
      gateRejected: false;
      score: number;
      perCase: HoldoutCaseGrade[];
      violations: string[];
    };

export { GradeFormatError };

function withoutCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

function parseGrade(raw: string): { score: number; why: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(withoutCodeFence(raw));
  } catch {
    throw new GradeFormatError("채점 출력 형식 오류 — 유효한 JSON 객체가 아닙니다.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new GradeFormatError("채점 출력 형식 오류 — JSON 객체가 필요합니다.");
  }
  const value = parsed as Record<string, unknown>;
  if (value.score !== 0 && value.score !== 0.5 && value.score !== 1) {
    throw new GradeFormatError("채점 출력 형식 오류 — score는 0, 0.5, 1 중 하나여야 합니다.");
  }
  if (typeof value.why !== "string" || value.why.trim().length === 0) {
    throw new GradeFormatError("채점 출력 형식 오류 — why는 비어 있지 않은 문자열이어야 합니다.");
  }
  return { score: value.score, why: value.why.trim() };
}

/** grader 단독 호출 — 시험관 배터리의 오염 응답 프로브(날조·아첨)가 재사용한다.
 *  채점 의미(프롬프트·파싱)는 이 파일 한 곳에만 존재해야 한다. */
export async function gradeResponse(
  llm: LlmClient,
  question: string,
  expected: string,
  response: string,
): Promise<{ score: number; why: string }> {
  const first = await llm.complete(graderPrompt(question, expected, response), { temperature: 0 });
  try {
    return parseGrade(first);
  } catch (error) {
    if (!(error instanceof GradeFormatError)) throw error;
  }

  const retried = await llm.complete(
    graderRetryPrompt(question, expected, response, first),
    { temperature: 0 },
  );
  try {
    return parseGrade(retried);
  } catch (error) {
    if (error instanceof GradeFormatError) {
      throw new GradeFormatError(
        `채점 출력 형식 오류 — 형식 수정 요청 1회 후에도 해석할 수 없습니다. ${error.message}`,
      );
    }
    throw error;
  }
}

async function gradeCases(
  llm: LlmClient,
  doc: HandoverDoc,
  cases: CaseDef[],
): Promise<CaseGrade[]> {
  const out: CaseGrade[] = [];
  for (const c of cases) {
    const resp = await llm.complete(responderPrompt(doc, c.question), { temperature: 0 });
    const { score, why } = await gradeResponse(llm, c.question, c.expectedAnswer, resp);
    out.push({ caseId: c.id, question: c.question, score, why });
  }
  return out;
}

const summarize = (g: CaseGrade): string =>
  `${g.caseId} (${g.question.slice(0, 30)}${g.question.length > 30 ? "…" : ""}): ` +
  `${g.score === 0.5 ? "부분 정답" : "오답"} — ${g.why}`;

function lengthGateViolation(problem: HandoverProblem, doc: HandoverDoc): string | null {
  return doc.length > problem.lengthCap
    ? `분량 초과 실격: ${doc.length}자 > ${problem.lengthCap}자`
    : null;
}

/** 동결 평가자 — 게이트(분량) → 가시 케이스 실측 평균 ×100 */
export function createScorer(problem: HandoverProblem, llm: LlmClient) {
  return async (doc: HandoverDoc): Promise<ScoreResult> => {
    const gateViolation = lengthGateViolation(problem, doc);
    if (gateViolation !== null) {
      return {
        total: 0,
        violations: [gateViolation],
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
): Promise<HoldoutScoreResult> {
  const gateViolation = lengthGateViolation(problem, doc);
  if (gateViolation !== null) {
    return {
      gateRejected: true,
      score: null,
      perCase: [],
      violations: [gateViolation],
    };
  }
  const grades = await gradeCases(llm, doc, problem.holdoutCases);
  const score =
    Math.round((grades.reduce((a, g) => a + g.score, 0) / grades.length) * 1000) / 10;
  const visibleQuestions = new Set(
    problem.visibleCases.map((c) => normalizeQuestion(c.question)),
  );
  const perCase: HoldoutCaseGrade[] = grades.map((grade) => ({
    ...grade,
    caseType: visibleQuestions.has(normalizeQuestion(grade.question)) ? "repeated" : "new",
  }));
  return { gateRejected: false, score, perCase, violations: [] };
}

/** 반복 여부는 결과 해석용으로만 정규화한다. 중복 입력을 거부하거나 분할을 바꾸지 않는다. */
function normalizeQuestion(question: string): string {
  return question.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
}

/** 라운드당 예상 LLM 콜 수 — 관제실 비용 안내용 */
export function estimateCallsPerRound(problem: HandoverProblem): number {
  return 1 + problem.visibleCases.length * 2;
}
