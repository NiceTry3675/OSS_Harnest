/** 분석 문제 → 사용자 정본화 질문 → 승인된 NovelCanon 변환.
 *  같은 분석과 같은 답변은 항상 같은 결정·정본 다이제스트를 만든다. */

import { sha256Canonical } from "@harnest/contracts";
import {
  NOVEL_CANON_SCHEMA_VERSION,
  NOVEL_INTERVIEW_SCHEMA_VERSION,
  type AnalysisIssue,
  type CanonAnswer,
  type CanonDecision,
  type CanonInterview,
  type CanonOperation,
  type CanonQuestion,
  type CanonQuestionKind,
  type CharacterProfile,
  type EvidenceRef,
  type NovelAnalysisDraft,
  type NovelCanon,
  type UnresolvedCanon,
  type UserClarification,
} from "./types";
import { assertNovelAnalysisDraft } from "./validation";

export class CanonInterviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonInterviewError";
  }
}

const questionKind: Record<AnalysisIssue["kind"], CanonQuestionKind> = {
  entity_identity: "confirm_identity",
  fact_contradiction: "choose_fact",
  timeline_conflict: "order_events",
  relationship_conflict: "clarify_relationship",
  world_rule_conflict: "choose_fact",
  causal_gap: "fill_missing_information",
  missing_information: "fill_missing_information",
  ambiguous_statement: "classify_truth",
  intentional_mystery: "confirm_intentional_ambiguity",
};

function questionFromIssue(issue: AnalysisIssue): CanonQuestion {
  return {
    id: `question-${issue.id}`,
    issueId: issue.id,
    kind: questionKind[issue.kind],
    priority: issue.priority,
    title: issue.title,
    question: issue.question,
    whyItMatters: issue.whyItMatters,
    relatedEntityIds: [...issue.relatedEntityIds],
    evidenceGroups: issue.alternatives.map((alternative) => ({
      label: alternative.label,
      evidence: structuredClone(alternative.evidence),
    })),
    options: issue.alternatives.map((alternative) => ({
      id: alternative.id,
      label: alternative.label,
      ...(alternative.description === undefined ? {} : { description: alternative.description }),
      evidence: structuredClone(alternative.evidence),
    })),
    allowCustomAnswer: true,
    allowUnresolved: issue.priority !== "blocking",
  };
}

export async function analysisDigest(draft: NovelAnalysisDraft): Promise<string> {
  return sha256Canonical(draft);
}

export async function buildCanonInterview(draft: NovelAnalysisDraft): Promise<CanonInterview> {
  assertNovelAnalysisDraft(draft);
  return {
    schemaVersion: NOVEL_INTERVIEW_SCHEMA_VERSION,
    analysisDigest: await analysisDigest(draft),
    questions: draft.issues.map(questionFromIssue),
  };
}

function evidenceKey(evidence: EvidenceRef): string {
  return `${evidence.sourceId}\u0000${evidence.segmentId}\u0000${evidence.quote}`;
}

function uniqueEvidence(values: EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = evidenceKey(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function mergeProfiles(target: CharacterProfile, sources: CharacterProfile[]): CharacterProfile {
  const first = <T>(read: (profile: CharacterProfile) => T | undefined): T | undefined =>
    read(target) ?? sources.map(read).find((value) => value !== undefined);
  const externalGoal = first((profile) => profile.externalGoal);
  const internalNeed = first((profile) => profile.internalNeed);
  const fear = first((profile) => profile.fear);
  const wound = first((profile) => profile.wound);
  const falseBelief = first((profile) => profile.falseBelief);
  const voice = first((profile) => profile.voice);
  const startState = first((profile) => profile.startState);
  const expectedEndState = first((profile) => profile.expectedEndState);
  const plannedArc = first((profile) => profile.plannedArc);
  return {
    ...target,
    aliases: uniqueStrings([
      ...target.aliases,
      ...sources.flatMap((source) => [source.name, ...source.aliases]),
    ]).filter((alias) => alias !== target.name),
    roles: uniqueStrings([...target.roles, ...sources.flatMap((source) => source.roles)]),
    appearance: [...target.appearance, ...sources.flatMap((source) => source.appearance)],
    background: [...target.background, ...sources.flatMap((source) => source.background)],
    traits: [...target.traits, ...sources.flatMap((source) => source.traits)],
    ...(externalGoal === undefined ? {} : { externalGoal }),
    ...(internalNeed === undefined ? {} : { internalNeed }),
    ...(fear === undefined ? {} : { fear }),
    ...(wound === undefined ? {} : { wound }),
    ...(falseBelief === undefined ? {} : { falseBelief }),
    values: [...target.values, ...sources.flatMap((source) => source.values)],
    contradictions: [
      ...target.contradictions,
      ...sources.flatMap((source) => source.contradictions),
    ],
    boundaries: [...target.boundaries, ...sources.flatMap((source) => source.boundaries)],
    secrets: [...target.secrets, ...sources.flatMap((source) => source.secrets)],
    ...(voice === undefined ? {} : { voice }),
    knowledge: [...target.knowledge, ...sources.flatMap((source) => source.knowledge)],
    ...(startState === undefined ? {} : { startState }),
    ...(expectedEndState === undefined ? {} : { expectedEndState }),
    ...(plannedArc === undefined ? {} : { plannedArc }),
    evidence: uniqueEvidence([
      ...target.evidence,
      ...sources.flatMap((source) => source.evidence),
    ]),
    reviewState: "edited",
  };
}

function mergeCharacters(
  draft: NovelAnalysisDraft,
  sourceCharacterIds: string[],
  targetCharacterId: string,
): void {
  const sourceSet = new Set(sourceCharacterIds);
  if (sourceSet.has(targetCharacterId)) {
    throw new CanonInterviewError("병합 대상과 기준 인물이 같을 수 없습니다.");
  }
  const target = draft.characters.find((character) => character.id === targetCharacterId);
  if (!target) throw new CanonInterviewError(`기준 인물을 찾을 수 없습니다: ${targetCharacterId}`);
  const sources = sourceCharacterIds.map((id) => {
    const source = draft.characters.find((character) => character.id === id);
    if (!source) throw new CanonInterviewError(`병합할 인물을 찾을 수 없습니다: ${id}`);
    return source;
  });
  const remap = (id: string): string => sourceSet.has(id) ? targetCharacterId : id;
  const merged = mergeProfiles(target, sources);
  merged.secrets = merged.secrets.map((secret) => ({
    ...secret,
    knownByCharacterIds: uniqueStrings(secret.knownByCharacterIds.map(remap)),
  }));
  draft.characters = draft.characters
    .filter((character) => !sourceSet.has(character.id) && character.id !== targetCharacterId)
    .concat(merged);

  const seenNodeCharacters = new Set<string>();
  draft.relationshipGraph.nodes = draft.relationshipGraph.nodes
    .map((node) => ({ ...node, characterId: remap(node.characterId) }))
    .filter((node) => {
      if (seenNodeCharacters.has(node.characterId)) return false;
      seenNodeCharacters.add(node.characterId);
      return true;
    });
  draft.relationshipGraph.edges = draft.relationshipGraph.edges
    .map((edge) => ({
      ...edge,
      fromCharacterId: remap(edge.fromCharacterId),
      toCharacterId: remap(edge.toCharacterId),
    }))
    // 서로 다른 인물이라고 잘못 분석해 생긴 자기 자신과의 관계는 정본에서 제거한다.
    .filter((edge) => edge.fromCharacterId !== edge.toCharacterId);

  draft.events = draft.events.map((event) => ({
    ...event,
    participantIds: uniqueStrings(event.participantIds.map(remap)),
    stateChanges: event.stateChanges.map((change) => ({
      ...change,
      subjectId: remap(change.subjectId),
    })),
    knowledgeChanges: event.knowledgeChanges.map((change) => ({
      ...change,
      characterId: remap(change.characterId),
    })),
  }));
  draft.claims = draft.claims.map((claim) => ({
    ...claim,
    subjectId: remap(claim.subjectId),
    ...(claim.holderCharacterIds === undefined
      ? {}
      : { holderCharacterIds: uniqueStrings(claim.holderCharacterIds.map(remap)) }),
  }));
}

function applyOperation(
  draft: NovelAnalysisDraft,
  operation: CanonOperation,
  clarifications: UserClarification[],
  issueId: string,
): void {
  if (operation.kind === "confirm_claim" || operation.kind === "reject_claim") {
    const claim = draft.claims.find((candidate) => candidate.id === operation.claimId);
    if (!claim) throw new CanonInterviewError(`정본 명제를 찾을 수 없습니다: ${operation.claimId}`);
    claim.reviewState = operation.kind === "confirm_claim" ? "confirmed" : "rejected";
    return;
  }
  if (operation.kind === "classify_claim") {
    const claim = draft.claims.find((candidate) => candidate.id === operation.claimId);
    if (!claim) throw new CanonInterviewError(`정본 명제를 찾을 수 없습니다: ${operation.claimId}`);
    claim.truthScope = operation.truthScope;
    claim.reviewState = "edited";
    if (operation.holderCharacterIds === undefined) delete claim.holderCharacterIds;
    else claim.holderCharacterIds = [...operation.holderCharacterIds];
    if (operation.revealedAtEventId === undefined) delete claim.revealedAtEventId;
    else claim.revealedAtEventId = operation.revealedAtEventId;
    return;
  }
  if (operation.kind === "merge_characters") {
    mergeCharacters(draft, operation.sourceCharacterIds, operation.targetCharacterId);
    return;
  }
  if (operation.kind === "order_event") {
    const event = draft.events.find((candidate) => candidate.id === operation.eventId);
    if (!event) throw new CanonInterviewError(`사건을 찾을 수 없습니다: ${operation.eventId}`);
    event.chronologicalOrder = operation.chronologicalOrder;
    event.status = "confirmed";
    return;
  }
  if (operation.kind === "confirm_relationship") {
    const relationship = draft.relationshipGraph.edges.find(
      (candidate) => candidate.id === operation.relationshipId,
    );
    if (!relationship) {
      throw new CanonInterviewError(`관계를 찾을 수 없습니다: ${operation.relationshipId}`);
    }
    relationship.reviewState = "confirmed";
    return;
  }
  clarifications.push({ issueId, text: operation.text.trim() });
}

function defaultUnresolvedRule(issue: AnalysisIssue): UnresolvedCanon["rule"] {
  return issue.kind === "intentional_mystery" ? "preserve_ambiguity" : "do_not_assert";
}

export function canonDigestScope(canon: Omit<NovelCanon, "canonDigest">): unknown {
  return canon;
}

export async function applyCanonAnswers(
  draft: NovelAnalysisDraft,
  interview: CanonInterview,
  answers: CanonAnswer[],
): Promise<NovelCanon> {
  assertNovelAnalysisDraft(draft);
  const currentAnalysisDigest = await analysisDigest(draft);
  if (interview.analysisDigest !== currentAnalysisDigest) {
    throw new CanonInterviewError("인터뷰가 현재 분석본에 속하지 않습니다 — 분석을 다시 확인해 주세요.");
  }
  if (interview.schemaVersion !== NOVEL_INTERVIEW_SCHEMA_VERSION) {
    throw new CanonInterviewError("지원하지 않는 정본화 인터뷰 버전입니다.");
  }

  const questionById = new Map(interview.questions.map((question) => [question.id, question]));
  const issueById = new Map(draft.issues.map((analysisIssue) => [analysisIssue.id, analysisIssue]));
  const answerByQuestion = new Map<string, CanonAnswer>();
  for (const answer of answers) {
    if (!questionById.has(answer.questionId)) {
      throw new CanonInterviewError(`현재 인터뷰에 없는 질문입니다: ${answer.questionId}`);
    }
    if (answerByQuestion.has(answer.questionId)) {
      throw new CanonInterviewError(`같은 질문에 답변이 중복되었습니다: ${answer.questionId}`);
    }
    answerByQuestion.set(answer.questionId, answer);
  }

  for (const question of interview.questions) {
    const answer = answerByQuestion.get(question.id);
    if (question.priority === "blocking" && answer === undefined) {
      throw new CanonInterviewError(`필수 질문에 답해 주세요: ${question.title}`);
    }
    if (question.priority === "blocking" && answer?.leaveUnresolved) {
      throw new CanonInterviewError(`필수 질문은 미정으로 남길 수 없습니다: ${question.title}`);
    }
  }

  const working = structuredClone(draft);
  const decisions: CanonDecision[] = [];
  const clarifications: UserClarification[] = [];
  const unresolved: UnresolvedCanon[] = [];

  for (const question of interview.questions) {
    const issue = issueById.get(question.issueId);
    if (!issue) throw new CanonInterviewError(`질문의 분석 문제를 찾을 수 없습니다: ${question.issueId}`);
    const answer = answerByQuestion.get(question.id);
    if (answer === undefined) {
      unresolved.push({ issueId: issue.id, rule: defaultUnresolvedRule(issue) });
      continue;
    }
    const selected = answer.selectedOptionId !== undefined;
    const custom = answer.customAnswer?.trim() ?? "";
    const leftUnresolved = answer.leaveUnresolved === true;
    const modes = Number(selected) + Number(custom.length > 0) + Number(leftUnresolved);
    if (modes !== 1) {
      throw new CanonInterviewError(
        `질문에는 선택지, 직접 답변 또는 미정 가운데 하나만 답해야 합니다: ${question.title}`,
      );
    }
    if (leftUnresolved) {
      if (!question.allowUnresolved) {
        throw new CanonInterviewError(`이 질문은 미정으로 남길 수 없습니다: ${question.title}`);
      }
      unresolved.push({
        issueId: issue.id,
        rule: answer.unresolvedRule ?? defaultUnresolvedRule(issue),
      });
      continue;
    }

    let operations: CanonOperation[] = [];
    if (selected) {
      const alternative = issue.alternatives.find(
        (candidate) => candidate.id === answer.selectedOptionId,
      );
      if (!alternative) {
        throw new CanonInterviewError(
          `질문에 없는 선택지입니다: ${question.title} / ${answer.selectedOptionId}`,
        );
      }
      operations = structuredClone(alternative.operations);
    } else {
      operations = [{ kind: "add_user_clarification", text: custom }];
    }
    const decision: CanonDecision = {
      id: `decision-${question.id}`,
      questionId: question.id,
      issueId: issue.id,
      ...(answer.selectedOptionId === undefined ? {} : { selectedOptionId: answer.selectedOptionId }),
      ...(custom.length === 0 ? {} : { customAnswer: custom }),
      operations: structuredClone(operations),
    };
    decisions.push(decision);
    operations.forEach((operation) => applyOperation(working, operation, clarifications, issue.id));
  }

  // 인터뷰 정의는 정본 내용이 아니다. 적용 결과의 끊어진 참조만 재검사한다.
  working.issues = [];
  assertNovelAnalysisDraft(working);

  const sourceDigest = await sha256Canonical(working.sources);
  const withoutDigest: Omit<NovelCanon, "canonDigest"> = {
    schemaVersion: NOVEL_CANON_SCHEMA_VERSION,
    sourceDigest,
    analysisDigest: currentAnalysisDigest,
    sources: structuredClone(working.sources),
    work: structuredClone(working.work),
    world: structuredClone(working.world),
    characters: structuredClone(working.characters),
    relationshipGraph: structuredClone(working.relationshipGraph),
    events: structuredClone(working.events),
    claims: structuredClone(working.claims),
    decisions,
    userClarifications: clarifications,
    unresolved,
  };
  return {
    ...withoutDigest,
    canonDigest: await sha256Canonical(canonDigestScope(withoutDigest)),
  };
}
