/** 구조화 자료 → NovelAnalysisDraft 분석기.
 *  LLM 출력은 형식 수정 1회 뒤에도 도메인 검증을 통과하지 못하면 명시적으로 중단한다. */

import type { JudgeProvider } from "@harnest/contracts";
import {
  NOVEL_ANALYSIS_SCHEMA_VERSION,
  type AnalysisIssue,
  type CanonClaim,
  type CharacterProfile,
  type CharacterRelationGraph,
  type EvidenceRef,
  type NovelAnalysisDraft,
  type SourceDocument,
  type StoryEvent,
  type WorkProfile,
  type WorldModel,
} from "./types";
import { NovelValidationError, assertNovelAnalysisDraft } from "./validation";

export const MAX_NOVEL_ANALYSIS_INPUT_CHARS = 180_000;
export const MAX_NOVEL_ANALYSIS_OUTPUT_TOKENS = 32_768;

export interface NovelLlmClient {
  readonly providerId: JudgeProvider;
  readonly model: string;
  complete(
    prompt: string,
    opts?: { temperature?: number; maxOutputTokens?: number },
  ): Promise<string>;
}

export class NovelAnalysisFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NovelAnalysisFormatError";
  }
}

interface NovelAnalysisPayload {
  work: WorkProfile;
  world: WorldModel;
  characters: CharacterProfile[];
  relationshipGraph: CharacterRelationGraph;
  events: StoryEvent[];
  claims: CanonClaim[];
  issues: AnalysisIssue[];
}

function withoutCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new NovelAnalysisFormatError(`${path}는 JSON 객체여야 합니다.`);
  return value;
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new NovelAnalysisFormatError(`${path}는 JSON 배열이어야 합니다.`);
  return value;
}

/** 상세 의미 검증 전에 누락 배열로 validator가 중단되지 않게 최소 구조를 확인한다. */
function assertPayloadShape(value: unknown): asserts value is NovelAnalysisPayload {
  const root = requireRecord(value, "분석 결과");
  const work = requireRecord(root.work, "work");
  requireArray(work.genres, "work.genres");
  requireArray(work.themes, "work.themes");
  const world = requireRecord(root.world, "world");
  requireArray(world.entities, "world.entities");
  requireArray(world.rules, "world.rules");
  requireArray(world.terminology, "world.terminology");
  const characters = requireArray(root.characters, "characters");
  characters.forEach((candidate, index) => {
    const character = requireRecord(candidate, `characters[${index}]`);
    [
      "aliases", "roles", "appearance", "background", "traits", "values", "contradictions",
      "boundaries", "secrets", "knowledge", "evidence",
    ].forEach((field) => requireArray(character[field], `characters[${index}].${field}`));
  });
  const graph = requireRecord(root.relationshipGraph, "relationshipGraph");
  requireArray(graph.nodes, "relationshipGraph.nodes");
  const edges = requireArray(graph.edges, "relationshipGraph.edges");
  edges.forEach((candidate, index) => {
    const edge = requireRecord(candidate, `relationshipGraph.edges[${index}]`);
    requireArray(edge.states, `relationshipGraph.edges[${index}].states`);
    requireArray(edge.evidence, `relationshipGraph.edges[${index}].evidence`);
  });
  const events = requireArray(root.events, "events");
  events.forEach((candidate, index) => {
    const event = requireRecord(candidate, `events[${index}]`);
    [
      "locationIds", "participantIds", "causeEventIds", "prerequisiteClaimIds",
      "consequenceEventIds", "stateChanges", "knowledgeChanges", "evidence",
    ].forEach((field) => requireArray(event[field], `events[${index}].${field}`));
  });
  const claims = requireArray(root.claims, "claims");
  claims.forEach((candidate, index) => {
    const claim = requireRecord(candidate, `claims[${index}]`);
    requireArray(claim.evidence, `claims[${index}].evidence`);
  });
  const issues = requireArray(root.issues, "issues");
  issues.forEach((candidate, index) => {
    const analysisIssue = requireRecord(candidate, `issues[${index}]`);
    requireArray(analysisIssue.relatedEntityIds, `issues[${index}].relatedEntityIds`);
    const alternatives = requireArray(analysisIssue.alternatives, `issues[${index}].alternatives`);
    alternatives.forEach((option, optionIndex) => {
      const alternative = requireRecord(option, `issues[${index}].alternatives[${optionIndex}]`);
      requireArray(alternative.evidence, `issues[${index}].alternatives[${optionIndex}].evidence`);
      requireArray(alternative.operations, `issues[${index}].alternatives[${optionIndex}].operations`);
    });
  });
}

function parsePayload(raw: string, sources: SourceDocument[]): NovelAnalysisDraft {
  let parsed: unknown;
  try {
    parsed = JSON.parse(withoutCodeFence(raw));
  } catch {
    throw new NovelAnalysisFormatError("분석 출력이 유효한 JSON 객체가 아닙니다.");
  }
  assertPayloadShape(parsed);
  const draft: NovelAnalysisDraft = {
    schemaVersion: NOVEL_ANALYSIS_SCHEMA_VERSION,
    sources: structuredClone(sources),
    ...parsed,
  };
  try {
    assertNovelAnalysisDraft(draft);
  } catch (error) {
    if (error instanceof NovelValidationError) {
      throw new NovelAnalysisFormatError(`분석 결과의 근거·참조가 올바르지 않습니다.\n${error.message}`);
    }
    throw error;
  }
  return draft;
}

function sourcePayload(sources: SourceDocument[]): string {
  return JSON.stringify(
    sources.map((source) => ({
      sourceId: source.id,
      filename: source.filename,
      kind: source.kind,
      segments: source.segments.map((segment) => ({
        segmentId: segment.id,
        locator: segment.locator,
        text: segment.text,
      })),
    })),
  );
}

function analysisPrompt(sources: SourceDocument[], creativeDirection: string): string {
  return `당신은 소설 설정 정본화 분석기다. 사용자의 자료를 요약하는 데서 끝내지 말고,
뒤에서 설정 오류와 인물 일관성을 기계적으로 확인할 수 있는 JSON을 만든다.

창작 의도:
${creativeDirection.trim()}

절대 규칙:
1. 출력은 JSON 객체 하나뿐이다. 코드펜스와 설명을 쓰지 않는다.
2. 모든 id는 영문 소문자·숫자·하이픈으로 만든 안정적인 문자열이며 전체 도메인에서 중복하지 않는다.
3. 원문에 직접 있는 정보는 basis="explicit", 해석한 정보는 basis="inferred"다.
4. evidence는 반드시 아래 자료의 sourceId와 segmentId를 그대로 쓰고, quote는 해당 segment text에
   공백 정규화 후 실제로 포함되는 짧은 원문이어야 한다. 근거가 없으면 evidence=[]로 둔다.
5. 문서끼리 충돌하면 하나를 몰래 선택하지 말고 claims를 각각 남기고 issues에 질문을 만든다.
6. 객관적 사실, 인물의 믿음, 소문, 거짓말, 화자의 주장, 미정 상태를 truthScope로 구분한다.
7. 관계의 감정·신뢰처럼 비대칭인 것은 directed edge로 만들고 사건에 따른 변화는 states의
   validFromEventId/validUntilEventId로 연결한다.
8. 사용자가 답하지 않으면 집필이 달라지는 충돌만 blocking으로 둔다. 나머지는 important/optional이다.
9. 선택지 operations는 confirm_claim, reject_claim, classify_claim, merge_characters,
   order_event, confirm_relationship, add_user_clarification 중 필요한 것만 쓴다.

필수 최상위 형태:
{
  "work": { "genres": [], "themes": [], "draftStatus": "settings_only|outline|partial_draft|complete_draft" },
  "world": { "entities": [], "rules": [], "terminology": [] },
  "characters": [],
  "relationshipGraph": { "nodes": [], "edges": [] },
  "events": [],
  "claims": [],
  "issues": []
}

각 세부 필드는 novel-analysis-v0 의미를 따른다. 배열 필드는 내용이 없어도 생략하지 말고 []로 쓴다.
reviewState는 분석 단계에서 "unreviewed"다. 모순이 없어도 창작 의도가 자료와 맞는지 확인할
important 질문 하나는 만들 수 있다.

자료 JSON:
${sourcePayload(sources)}`;
}

function retryPrompt(
  sources: SourceDocument[],
  creativeDirection: string,
  malformed: string,
  reason: string,
): string {
  return `${analysisPrompt(sources, creativeDirection)}

직전 출력은 다음 이유로 거부되었다:
${reason.slice(0, 4_000)}

직전 출력:
${malformed.slice(0, 24_000)}

원문의 의미를 새로 만들지 말고 형식·id·근거 참조만 고쳐 JSON 객체 하나를 다시 출력하라.`;
}

function sourceCharacterCount(sources: SourceDocument[]): number {
  return sources.reduce(
    (sum, source) => sum + source.segments.reduce((inner, segment) => inner + segment.text.length, 0),
    0,
  );
}

export async function analyzeNovelSources(
  sources: SourceDocument[],
  creativeDirection: string,
  llm: NovelLlmClient,
): Promise<NovelAnalysisDraft> {
  if (sources.length === 0) throw new Error("분석할 소설 자료가 없습니다.");
  const chars = sourceCharacterCount(sources);
  if (chars > MAX_NOVEL_ANALYSIS_INPUT_CHARS) {
    throw new Error(
      `현재 분석 1회는 추출 글 ${MAX_NOVEL_ANALYSIS_INPUT_CHARS.toLocaleString()}자까지 지원합니다 ` +
      `(현재 ${chars.toLocaleString()}자). 자료를 나누거나 핵심 설정·초고만 선택해 주세요.`,
    );
  }
  const prompt = analysisPrompt(sources, creativeDirection);
  const first = await llm.complete(prompt, {
    temperature: 0,
    maxOutputTokens: MAX_NOVEL_ANALYSIS_OUTPUT_TOKENS,
  });
  try {
    return parsePayload(first, sources);
  } catch (error) {
    if (!(error instanceof NovelAnalysisFormatError)) throw error;
    const retried = await llm.complete(
      retryPrompt(sources, creativeDirection, first, error.message),
      { temperature: 0, maxOutputTokens: MAX_NOVEL_ANALYSIS_OUTPUT_TOKENS },
    );
    try {
      return parsePayload(retried, sources);
    } catch (retryError) {
      if (retryError instanceof NovelAnalysisFormatError) {
        throw new NovelAnalysisFormatError(
          `분석 출력 형식 오류 — 수정 요청 1회 후에도 사용할 수 없습니다. ${retryError.message}`,
        );
      }
      throw retryError;
    }
  }
}

/** 외부 호출 없는 개발·체험 경로. 실제 작품 분석 품질을 주장하지 않는다. */
export function createMockNovelAnalysis(
  sources: SourceDocument[],
  creativeDirection: string,
): NovelAnalysisDraft {
  if (sources.length === 0) throw new Error("분석할 소설 자료가 없습니다.");
  const firstSegment = sources.flatMap((source) => source.segments)[0];
  if (!firstSegment) throw new Error("분석할 원문 조각이 없습니다.");
  const quote = firstSegment.text.slice(0, Math.min(120, firstSegment.text.length));
  const evidence: EvidenceRef[] = [{
    sourceId: sources[0].id,
    segmentId: firstSegment.id,
    quote,
  }];
  const direction = creativeDirection.trim();
  const issue: AnalysisIssue = {
    id: "issue-creative-direction",
    kind: "ambiguous_statement",
    priority: direction.length > 0 ? "important" : "blocking",
    title: "이 작품에서 가장 지킬 방향",
    question: "자료를 바탕으로 집필할 때 가장 우선할 창작 의도를 확인해 주세요.",
    whyItMatters: "원고를 개선하면서도 사용자가 의도한 이야기의 중심을 잃지 않기 위해 필요합니다.",
    relatedEntityIds: [],
    alternatives: direction.length === 0
      ? []
      : [{
          id: "use-entered-direction",
          label: direction,
          evidence: [],
          operations: [{ kind: "add_user_clarification", text: direction }],
        }],
  };
  const draft: NovelAnalysisDraft = {
    schemaVersion: NOVEL_ANALYSIS_SCHEMA_VERSION,
    sources: structuredClone(sources),
    work: {
      genres: [],
      themes: [],
      premise: {
        value: quote,
        basis: "inferred",
        reviewState: "unreviewed",
        evidence,
      },
      draftStatus: "partial_draft",
    },
    world: { entities: [], rules: [], terminology: [] },
    characters: [],
    relationshipGraph: { nodes: [], edges: [] },
    events: [],
    claims: [],
    issues: [issue],
  };
  assertNovelAnalysisDraft(draft);
  return draft;
}
