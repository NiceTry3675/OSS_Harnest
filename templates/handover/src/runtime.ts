/** 실행 계층 — 동결 평가자(case_answering)와 LLM Generator를 루프 엔진 슬롯에 맞춘다.
 *  불변식:
 *  - 루프용 scorer는 피드백(가시)·검증 가드 케이스만 채점한다. 가드는 집계 점수만
 *    반환하고 개별 트레이스(violations)에는 싣지 않는다 — Generator로 새는 경로가
 *    구조적으로 없다(SPEC §5.1.1). 홀드아웃은 scoreHoldout으로만 — 호출 시점은
 *    라운드 0과 종료 시(SPEC §3 원칙 7).
 *  - responder는 문서+이번 채점 대상 질문 목록만 본다(prompts.respondersPrompt가 그 형태를
 *    강제). 피드백·가드·홀드아웃 채점은 각각 별도 배치 호출이라 같은 프롬프트에 섞이지 않는다. */

import {
  CallBudgetExceededError,
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
  gradersPrompt,
  gradersRetryPrompt,
  mutatePrompt,
  oneshotPrompt,
  respondersPrompt,
  respondersRetryPrompt,
  type GraderItem,
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

export { CallBudgetExceededError, GradeFormatError };

/** 호출 예산 백스톱 — 예산을 소진하면 이후 호출을 CallBudgetExceededError로 차단한다.
 *  판정 의미에는 관여하지 않는 순수 계수 래퍼이며, 정상 실행에서는 절대 걸리지 않아야 한다. */
export function withCallBudget(llm: LlmClient, budget: number): LlmClient {
  let used = 0;
  return {
    providerId: llm.providerId,
    model: llm.model,
    complete(prompt, opts) {
      if (used >= budget) return Promise.reject(new CallBudgetExceededError(budget));
      used += 1;
      return llm.complete(prompt, opts);
    },
  };
}

export function withoutCodeFence(raw: string): string {
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

/** 배치 출력(JSON 배열)을 요청 케이스 id 집합과 정확히 1:1로 대조 검증한다 —
 *  누락·중복·요청에 없는 id는 전부 형식 오류다(부분 결과로 조용히 채점하지 않는다). */
function parseBatch<T>(
  raw: string,
  label: string,
  ids: string[],
  parseItem: (value: Record<string, unknown>) => T,
): Map<string, T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(withoutCodeFence(raw));
  } catch {
    throw new GradeFormatError(`${label} 출력 형식 오류 — 유효한 JSON 배열이 아닙니다.`);
  }
  if (!Array.isArray(parsed)) {
    throw new GradeFormatError(`${label} 출력 형식 오류 — JSON 배열이 필요합니다.`);
  }
  const wanted = new Set(ids);
  const out = new Map<string, T>();
  for (const item of parsed) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new GradeFormatError(`${label} 출력 형식 오류 — 각 항목은 JSON 객체여야 합니다.`);
    }
    const value = item as Record<string, unknown>;
    if (typeof value.caseId !== "string" || !wanted.has(value.caseId)) {
      throw new GradeFormatError(`${label} 출력 형식 오류 — 요청한 케이스 id가 아닙니다.`);
    }
    if (out.has(value.caseId)) {
      throw new GradeFormatError(`${label} 출력 형식 오류 — 케이스 ${value.caseId}가 중복입니다.`);
    }
    out.set(value.caseId, parseItem(value));
  }
  for (const id of ids) {
    if (!out.has(id)) {
      throw new GradeFormatError(`${label} 출력 형식 오류 — 케이스 ${id}의 항목이 없습니다.`);
    }
  }
  return out;
}

/** 벤더 공통 안전 출력 토큰 상한 — Vertex/Gemini는 65,537 미만만 받는다
 *  (실측 2026-08-26: maxOutputTokens 92,160 요청이 HTTP 400 INVALID_ARGUMENT).
 *  넘치는 예산은 요청 자체를 거부당하므로 여유가 아니라 오류다. */
export const VENDOR_MAX_OUTPUT_TOKENS = 65_536;

/** 배치 출력 토큰 예산 — 항목 수에 비례한 여유. 명시하지 않으면 클라이언트 기본 상한
 *  (8192 토큰)이 큰 배치의 JSON 배열을 중간에 잘라 형식 오류로 만든다.
 *  상한은 초과분에 과금되지 않는 순수 한도라 넉넉해도 비용 부담이 없지만,
 *  벤더 최대치(VENDOR_MAX_OUTPUT_TOKENS)를 넘으면 요청이 거부되므로 클램프한다. */
export function batchOutputTokensFor(itemCount: number): number {
  return Math.min(VENDOR_MAX_OUTPUT_TOKENS, Math.max(8192, itemCount * 1024));
}

/** 배치 호출 공통 경로 — 본 호출 1회 + 형식 수정 재시도 1회 */
async function completeBatch<T>(
  llm: LlmClient,
  prompt: string,
  retryPrompt: (malformed: string) => string,
  label: string,
  ids: string[],
  parseItem: (value: Record<string, unknown>) => T,
): Promise<Map<string, T>> {
  const maxOutputTokens = batchOutputTokensFor(ids.length);
  const first = await llm.complete(prompt, { temperature: 0, maxOutputTokens });
  try {
    return parseBatch(first, label, ids, parseItem);
  } catch (error) {
    if (!(error instanceof GradeFormatError)) throw error;
  }
  const retried = await llm.complete(retryPrompt(first), { temperature: 0, maxOutputTokens });
  try {
    return parseBatch(retried, label, ids, parseItem);
  } catch (error) {
    if (error instanceof GradeFormatError) {
      throw new GradeFormatError(
        `${label} 출력 형식 오류 — 형식 수정 요청 1회 후에도 해석할 수 없습니다. ${error.message}`,
      );
    }
    throw error;
  }
}

/** 배치 채점 — responder 1콜(문서+질문 목록) + grader 1콜(응답 목록).
 *  케이스 수와 무관하게 채점은 콜 2회(+형식 재시도 각 1회)다 — SPEC §5.2 비용 구조의 근거. */
async function gradeCases(
  llm: LlmClient,
  doc: HandoverDoc,
  cases: CaseDef[],
): Promise<CaseGrade[]> {
  if (cases.length === 0) return [];
  const ids = cases.map((c) => c.id);

  const answers = await completeBatch(
    llm,
    respondersPrompt(doc, cases),
    (malformed) => respondersRetryPrompt(doc, cases, malformed),
    "응답",
    ids,
    (value) => {
      if (typeof value.answer !== "string" || value.answer.trim().length === 0) {
        throw new GradeFormatError(
          "응답 출력 형식 오류 — answer는 비어 있지 않은 문자열이어야 합니다.",
        );
      }
      return value.answer.trim();
    },
  );

  const items: GraderItem[] = cases.map((c) => ({
    caseId: c.id,
    question: c.question,
    expected: c.expectedAnswer,
    response: answers.get(c.id)!,
  }));
  const grades = await completeBatch(
    llm,
    gradersPrompt(items),
    (malformed) => gradersRetryPrompt(items, malformed),
    "채점",
    ids,
    (value) => {
      if (value.score !== 0 && value.score !== 0.5 && value.score !== 1) {
        throw new GradeFormatError("채점 출력 형식 오류 — score는 0, 0.5, 1 중 하나여야 합니다.");
      }
      if (typeof value.why !== "string" || value.why.trim().length === 0) {
        throw new GradeFormatError(
          "채점 출력 형식 오류 — why는 비어 있지 않은 문자열이어야 합니다.",
        );
      }
      return { score: value.score as number, why: value.why.trim() };
    },
  );

  return cases.map((c) => {
    const g = grades.get(c.id)!;
    return { caseId: c.id, question: c.question, score: g.score, why: g.why };
  });
}

const summarize = (g: CaseGrade): string =>
  `${g.caseId} (${g.question.slice(0, 30)}${g.question.length > 30 ? "…" : ""}): ` +
  `${g.score === 0.5 ? "부분 정답" : "오답"} — ${g.why}`;

function lengthGateViolation(problem: HandoverProblem, doc: HandoverDoc): string | null {
  return doc.length > problem.lengthCap
    ? `분량 초과 실격: ${doc.length}자 > ${problem.lengthCap}자`
    : null;
}

/** 간결성 사용 시 가중 배분 — 합 1.0 (pack.criteria의 weight와 같은 값이어야 한다).
 *  0.8/0.2: 케이스 4개 기준 케이스 하나의 커버리지 가치(20점)와 간결성 최대 가점(20점)이
 *  같아, 커버된 케이스를 버리고 줄이는 교환이 소케이스 구성에서는 성립하지 않는다. */
export const COVERAGE_WEIGHT = 0.8;
export const CONCISENESS_WEIGHT = 0.2;

const round1 = (x: number): number => Math.round(x * 10) / 10;

/** 동결 평가자 — 게이트(분량) → 피드백 케이스 실측 평균 ×100 (+ 선택적 간결성 가중)
 *  + 검증 가드 집계. 가드는 별도 배치로 채점하고 집계 점수만 반환한다 — 개별 트레이스는
 *  violations에 싣지 않으므로 Generator 피드백으로 흘러갈 수 없다. */
export function createScorer(problem: HandoverProblem, llm: LlmClient) {
  return async (doc: HandoverDoc): Promise<ScoreResult> => {
    const gateViolation = lengthGateViolation(problem, doc);
    if (gateViolation !== null) {
      return {
        total: 0,
        violations: [gateViolation],
        parts: {},
        gateRejected: true,
        guardScore: null,
      };
    }
    const grades = await gradeCases(llm, doc, problem.visibleCases);
    const coverage = (grades.reduce((a, g) => a + g.score, 0) / grades.length) * 100;
    const violations = grades.filter((g) => g.score < 1).map(summarize);

    // 검증 가드 — 피드백과 별도 배치 호출(혼합 금지 불변식), 집계 점수만 남긴다
    let guardScore: number | null = null;
    if (problem.guardCases.length > 0) {
      const guardGrades = await gradeCases(llm, doc, problem.guardCases);
      guardScore = round1(
        (guardGrades.reduce((a, g) => a + g.score, 0) / guardGrades.length) * 100,
      );
    }

    if (!problem.useConciseness) {
      const total = round1(coverage);
      return {
        total,
        violations,
        parts: { case_answerability: total },
        gateRejected: false,
        guardScore,
      };
    }
    // 답변력이 0이면 간결성도 0 — 빈 문서가 간결성만으로 저커버리지 문서를 이기는 역전 방지
    const headroom =
      coverage > 0 ? Math.max(0, 1 - doc.length / problem.lengthCap) * 100 : 0;
    return {
      total: round1(COVERAGE_WEIGHT * coverage + CONCISENESS_WEIGHT * headroom),
      violations,
      parts: { case_answerability: round1(coverage), conciseness: round1(headroom) },
      gateRejected: false,
      guardScore,
    };
  };
}

/** 문서 생성 출력 토큰 예산 — 분량 상한(자)의 2배 여유. 명시하지 않으면 클라이언트 기본
 *  상한(8192 토큰)이 긴 문서를 조용히 잘라, 게이트는 통과하되 내용이 끊긴 문서가 채점된다
 *  (한국어 ≈ 글자당 1토큰 안팎). */
export function maxOutputTokensFor(lengthCap: number): number {
  // 현재 상한(LENGTH_CAP_MAX 20,000 → 40,000토큰)에서는 벤더 최대치에 닿지 않지만,
  // 상한을 올려도 요청 거부로 번지지 않게 같은 클램프를 적용한다.
  return Math.min(VENDOR_MAX_OUTPUT_TOKENS, lengthCap * 2);
}

/** 원샷 생성 — 루프의 라운드 0 기준선. 엔진 슬롯(initial(rng))에 맞춰 rng를 받되 쓰지 않는다 */
export function createInitial(problem: HandoverProblem, llm: LlmClient) {
  return async (_rng?: () => number): Promise<HandoverDoc> =>
    (
      await llm.complete(oneshotPrompt(problem), {
        temperature: 0.7,
        maxOutputTokens: maxOutputTokensFor(problem.lengthCap),
      })
    ).trim();
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
        { temperature: 0.7, maxOutputTokens: maxOutputTokensFor(problem.lengthCap) },
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
export function normalizeQuestion(question: string): string {
  return question.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
}

/** 라운드당 예상 LLM 콜 수 — 관제실 비용 안내용.
 *  배치 채점으로 케이스 수와 무관하다: 생성 1 + 피드백 배치 2 (+ 가드 배치 2). */
export function estimateCallsPerRound(problem: HandoverProblem): number {
  return problem.guardCases.length > 0 ? 5 : 3;
}
