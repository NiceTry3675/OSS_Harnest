/** 소설 분석 초안의 참조·근거 무결성 검사.
 *  모델 출력은 신뢰하지 않고 정본화 인터뷰 전에 전체 구조를 검증한다. */

import type {
  AnalysisIssue,
  AnalyzedValue,
  CanonOperation,
  EvidenceRef,
  NovelAnalysisDraft,
  NovelValidationIssue,
  SourceDocument,
} from "./types";

export class NovelValidationError extends Error {
  constructor(readonly issues: NovelValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
    this.name = "NovelValidationError";
  }
}

const issue = (path: string, message: string): NovelValidationIssue => ({ path, message });

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function duplicateIds(items: Array<{ id: string }>): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) duplicates.add(item.id);
    seen.add(item.id);
  }
  return [...duplicates].sort();
}

function collectAnalyzedEvidence<T>(
  value: AnalyzedValue<T> | undefined,
  path: string,
  out: Array<{ path: string; evidence: EvidenceRef[] }>,
): void {
  if (value) out.push({ path, evidence: value.evidence });
}

function evidenceCollections(draft: NovelAnalysisDraft): Array<{ path: string; evidence: EvidenceRef[] }> {
  const out: Array<{ path: string; evidence: EvidenceRef[] }> = [];
  const work = draft.work;
  collectAnalyzedEvidence(work.title, "work.title", out);
  collectAnalyzedEvidence(work.language, "work.language", out);
  work.genres.forEach((value, index) => collectAnalyzedEvidence(value, `work.genres[${index}]`, out));
  collectAnalyzedEvidence(work.targetAudience, "work.targetAudience", out);
  collectAnalyzedEvidence(work.premise, "work.premise", out);
  work.themes.forEach((value, index) => collectAnalyzedEvidence(value, `work.themes[${index}]`, out));
  collectAnalyzedEvidence(work.pointOfView, "work.pointOfView", out);
  collectAnalyzedEvidence(work.tense, "work.tense", out);
  collectAnalyzedEvidence(work.tone, "work.tone", out);

  collectAnalyzedEvidence(draft.world.summary, "world.summary", out);
  draft.world.entities.forEach((entity, index) =>
    out.push({ path: `world.entities[${index}]`, evidence: entity.evidence }));
  draft.world.rules.forEach((rule, index) =>
    out.push({ path: `world.rules[${index}]`, evidence: rule.evidence }));
  draft.world.terminology.forEach((term, index) =>
    out.push({ path: `world.terminology[${index}]`, evidence: term.evidence }));

  draft.characters.forEach((character, characterIndex) => {
    const base = `characters[${characterIndex}]`;
    out.push({ path: base, evidence: character.evidence });
    character.appearance.forEach((value, index) =>
      collectAnalyzedEvidence(value, `${base}.appearance[${index}]`, out));
    character.background.forEach((value, index) =>
      collectAnalyzedEvidence(value, `${base}.background[${index}]`, out));
    character.traits.forEach((value, index) =>
      collectAnalyzedEvidence(value, `${base}.traits[${index}]`, out));
    character.values.forEach((value, index) =>
      collectAnalyzedEvidence(value, `${base}.values[${index}]`, out));
    character.boundaries.forEach((value, index) =>
      collectAnalyzedEvidence(value, `${base}.boundaries[${index}]`, out));
    collectAnalyzedEvidence(character.externalGoal, `${base}.externalGoal`, out);
    collectAnalyzedEvidence(character.internalNeed, `${base}.internalNeed`, out);
    collectAnalyzedEvidence(character.fear, `${base}.fear`, out);
    collectAnalyzedEvidence(character.wound, `${base}.wound`, out);
    collectAnalyzedEvidence(character.falseBelief, `${base}.falseBelief`, out);
    collectAnalyzedEvidence(character.startState, `${base}.startState`, out);
    collectAnalyzedEvidence(character.expectedEndState, `${base}.expectedEndState`, out);
    collectAnalyzedEvidence(character.plannedArc, `${base}.plannedArc`, out);
    character.contradictions.forEach((value, index) =>
      out.push({ path: `${base}.contradictions[${index}]`, evidence: value.evidence }));
    character.secrets.forEach((value, index) =>
      out.push({ path: `${base}.secrets[${index}]`, evidence: value.evidence }));
    character.knowledge.forEach((value, index) =>
      out.push({ path: `${base}.knowledge[${index}]`, evidence: value.evidence }));
  });

  draft.relationshipGraph.edges.forEach((edge, edgeIndex) => {
    const base = `relationshipGraph.edges[${edgeIndex}]`;
    out.push({ path: base, evidence: edge.evidence });
    edge.states.forEach((state, stateIndex) =>
      out.push({ path: `${base}.states[${stateIndex}]`, evidence: state.evidence }));
  });
  draft.events.forEach((event, index) =>
    out.push({ path: `events[${index}]`, evidence: event.evidence }));
  draft.claims.forEach((claim, index) =>
    out.push({ path: `claims[${index}]`, evidence: claim.evidence }));
  draft.issues.forEach((analysisIssue, issueIndex) => {
    analysisIssue.alternatives.forEach((alternative, alternativeIndex) =>
      out.push({
        path: `issues[${issueIndex}].alternatives[${alternativeIndex}]`,
        evidence: alternative.evidence,
      }));
  });
  return out;
}

function validateSources(
  sources: SourceDocument[],
  issues: NovelValidationIssue[],
): Map<string, Map<string, string>> {
  const sourceIds = duplicateIds(sources);
  if (sourceIds.length > 0) {
    issues.push(issue("sources", `문서 id가 중복입니다: ${sourceIds.join(", ")}`));
  }
  const index = new Map<string, Map<string, string>>();
  sources.forEach((source, sourceIndex) => {
    const path = `sources[${sourceIndex}]`;
    if (source.id.trim().length === 0) issues.push(issue(`${path}.id`, "빈 id는 허용하지 않습니다."));
    if (source.filename.trim().length === 0) {
      issues.push(issue(`${path}.filename`, "파일명이 필요합니다."));
    }
    if (!/^[a-f0-9]{64}$/i.test(source.contentDigest)) {
      issues.push(issue(`${path}.contentDigest`, "SHA-256 hex 형식이어야 합니다."));
    }
    const segmentDuplicates = duplicateIds(source.segments);
    if (segmentDuplicates.length > 0) {
      issues.push(issue(`${path}.segments`, `조각 id가 중복입니다: ${segmentDuplicates.join(", ")}`));
    }
    const segments = new Map<string, string>();
    source.segments.forEach((segment, segmentIndex) => {
      if (segment.id.trim().length === 0) {
        issues.push(issue(`${path}.segments[${segmentIndex}].id`, "빈 id는 허용하지 않습니다."));
      }
      if (segment.text.trim().length === 0) {
        issues.push(issue(`${path}.segments[${segmentIndex}].text`, "빈 원문 조각은 허용하지 않습니다."));
      }
      segments.set(segment.id, segment.text);
    });
    index.set(source.id, segments);
  });
  return index;
}

function validateEvidence(
  draft: NovelAnalysisDraft,
  sourceIndex: Map<string, Map<string, string>>,
  issues: NovelValidationIssue[],
): void {
  for (const collection of evidenceCollections(draft)) {
    collection.evidence.forEach((evidence, evidenceIndex) => {
      const path = `${collection.path}.evidence[${evidenceIndex}]`;
      const segments = sourceIndex.get(evidence.sourceId);
      if (!segments) {
        issues.push(issue(`${path}.sourceId`, `존재하지 않는 문서입니다: ${evidence.sourceId}`));
        return;
      }
      const text = segments.get(evidence.segmentId);
      if (text === undefined) {
        issues.push(issue(`${path}.segmentId`, `존재하지 않는 원문 조각입니다: ${evidence.segmentId}`));
        return;
      }
      const quote = normalizedText(evidence.quote);
      if (quote.length === 0) {
        issues.push(issue(`${path}.quote`, "빈 근거 인용은 허용하지 않습니다."));
      } else if (!normalizedText(text).includes(quote)) {
        issues.push(issue(`${path}.quote`, "인용문이 지정한 원문 조각에 없습니다."));
      }
    });
  }
}

function validateOperation(
  operation: CanonOperation,
  path: string,
  ids: {
    characters: Set<string>;
    events: Set<string>;
    claims: Set<string>;
    relationships: Set<string>;
  },
  issues: NovelValidationIssue[],
): void {
  if (operation.kind === "confirm_claim" || operation.kind === "reject_claim" || operation.kind === "classify_claim") {
    if (!ids.claims.has(operation.claimId)) {
      issues.push(issue(`${path}.claimId`, `존재하지 않는 정본 명제입니다: ${operation.claimId}`));
    }
    if (operation.kind === "classify_claim") {
      operation.holderCharacterIds?.forEach((id, index) => {
        if (!ids.characters.has(id)) {
          issues.push(issue(`${path}.holderCharacterIds[${index}]`, `존재하지 않는 인물입니다: ${id}`));
        }
      });
      if (operation.revealedAtEventId && !ids.events.has(operation.revealedAtEventId)) {
        issues.push(issue(`${path}.revealedAtEventId`, `존재하지 않는 사건입니다: ${operation.revealedAtEventId}`));
      }
    }
  } else if (operation.kind === "merge_characters") {
    if (!ids.characters.has(operation.targetCharacterId)) {
      issues.push(issue(`${path}.targetCharacterId`, `존재하지 않는 인물입니다: ${operation.targetCharacterId}`));
    }
    operation.sourceCharacterIds.forEach((id, index) => {
      if (!ids.characters.has(id)) {
        issues.push(issue(`${path}.sourceCharacterIds[${index}]`, `존재하지 않는 인물입니다: ${id}`));
      }
      if (id === operation.targetCharacterId) {
        issues.push(issue(`${path}.sourceCharacterIds[${index}]`, "병합 대상과 기준 인물이 같을 수 없습니다."));
      }
    });
  } else if (operation.kind === "order_event") {
    if (!ids.events.has(operation.eventId)) {
      issues.push(issue(`${path}.eventId`, `존재하지 않는 사건입니다: ${operation.eventId}`));
    }
    if (!Number.isInteger(operation.chronologicalOrder)) {
      issues.push(issue(`${path}.chronologicalOrder`, "사건 순서는 정수여야 합니다."));
    }
  } else if (operation.kind === "confirm_relationship") {
    if (!ids.relationships.has(operation.relationshipId)) {
      issues.push(issue(`${path}.relationshipId`, `존재하지 않는 관계입니다: ${operation.relationshipId}`));
    }
  } else if (operation.text.trim().length === 0) {
    issues.push(issue(`${path}.text`, "사용자 확인 내용은 비어 있을 수 없습니다."));
  }
}

function validateIssueDefinitions(
  definitions: AnalysisIssue[],
  knownIds: Set<string>,
  operationIds: Parameters<typeof validateOperation>[2],
  issues: NovelValidationIssue[],
): void {
  const duplicateIssueIds = duplicateIds(definitions);
  if (duplicateIssueIds.length > 0) {
    issues.push(issue("issues", `분석 문제 id가 중복입니다: ${duplicateIssueIds.join(", ")}`));
  }
  definitions.forEach((definition, issueIndex) => {
    const base = `issues[${issueIndex}]`;
    if (definition.question.trim().length === 0) {
      issues.push(issue(`${base}.question`, "사용자에게 보여줄 질문이 필요합니다."));
    }
    definition.relatedEntityIds.forEach((id, index) => {
      if (!knownIds.has(id)) {
        issues.push(issue(`${base}.relatedEntityIds[${index}]`, `존재하지 않는 관련 항목입니다: ${id}`));
      }
    });
    const duplicates = duplicateIds(definition.alternatives);
    if (duplicates.length > 0) {
      issues.push(issue(`${base}.alternatives`, `선택지 id가 중복입니다: ${duplicates.join(", ")}`));
    }
    definition.alternatives.forEach((alternative, alternativeIndex) => {
      alternative.operations.forEach((operation, operationIndex) =>
        validateOperation(
          operation,
          `${base}.alternatives[${alternativeIndex}].operations[${operationIndex}]`,
          operationIds,
          issues,
        ));
    });
  });
}

export function validateNovelAnalysisDraft(draft: NovelAnalysisDraft): NovelValidationIssue[] {
  const issues: NovelValidationIssue[] = [];
  if (draft.schemaVersion !== "novel-analysis-v0") {
    issues.push(issue("schemaVersion", "지원하지 않는 소설 분석 스키마 버전입니다."));
  }

  const sourceIndex = validateSources(draft.sources, issues);
  const idGroups = [
    ...draft.world.entities,
    ...draft.world.rules,
    ...draft.world.terminology,
    ...draft.characters,
    ...draft.relationshipGraph.nodes,
    ...draft.relationshipGraph.edges,
    ...draft.events,
    ...draft.claims,
  ];
  const globalDuplicates = duplicateIds(idGroups);
  if (globalDuplicates.length > 0) {
    issues.push(issue("$", `도메인 id는 종류와 관계없이 고유해야 합니다: ${globalDuplicates.join(", ")}`));
  }

  const characterIds = new Set(draft.characters.map((character) => character.id));
  const eventIds = new Set(draft.events.map((event) => event.id));
  const claimIds = new Set(draft.claims.map((claim) => claim.id));
  const relationshipIds = new Set(draft.relationshipGraph.edges.map((edge) => edge.id));
  const worldIds = new Set(draft.world.entities.map((entity) => entity.id));
  const locationIds = new Set(
    draft.world.entities.filter((entity) => entity.type === "location").map((entity) => entity.id),
  );
  const knownSubjectIds = new Set([...characterIds, ...worldIds, ...eventIds, ...relationshipIds]);
  const knownIds = new Set(idGroups.map((item) => item.id));

  draft.relationshipGraph.nodes.forEach((node, index) => {
    if (!characterIds.has(node.characterId)) {
      issues.push(issue(`relationshipGraph.nodes[${index}].characterId`, `존재하지 않는 인물입니다: ${node.characterId}`));
    }
    node.factionIds.forEach((id, factionIndex) => {
      if (!worldIds.has(id)) {
        issues.push(issue(`relationshipGraph.nodes[${index}].factionIds[${factionIndex}]`, `존재하지 않는 세계관 항목입니다: ${id}`));
      }
    });
  });
  const nodeCharacters = draft.relationshipGraph.nodes.map((node) => ({ id: node.characterId }));
  const duplicateNodeCharacters = duplicateIds(nodeCharacters);
  if (duplicateNodeCharacters.length > 0) {
    issues.push(issue("relationshipGraph.nodes", `한 인물에 그래프 노드가 여러 개입니다: ${duplicateNodeCharacters.join(", ")}`));
  }

  draft.relationshipGraph.edges.forEach((edge, edgeIndex) => {
    const base = `relationshipGraph.edges[${edgeIndex}]`;
    if (!characterIds.has(edge.fromCharacterId)) {
      issues.push(issue(`${base}.fromCharacterId`, `존재하지 않는 인물입니다: ${edge.fromCharacterId}`));
    }
    if (!characterIds.has(edge.toCharacterId)) {
      issues.push(issue(`${base}.toCharacterId`, `존재하지 않는 인물입니다: ${edge.toCharacterId}`));
    }
    const stateDuplicates = duplicateIds(edge.states);
    if (stateDuplicates.length > 0) {
      issues.push(issue(`${base}.states`, `관계 상태 id가 중복입니다: ${stateDuplicates.join(", ")}`));
    }
    edge.states.forEach((state, stateIndex) => {
      const statePath = `${base}.states[${stateIndex}]`;
      if (state.validFromEventId && !eventIds.has(state.validFromEventId)) {
        issues.push(issue(`${statePath}.validFromEventId`, `존재하지 않는 사건입니다: ${state.validFromEventId}`));
      }
      if (state.validUntilEventId && !eventIds.has(state.validUntilEventId)) {
        issues.push(issue(`${statePath}.validUntilEventId`, `존재하지 않는 사건입니다: ${state.validUntilEventId}`));
      }
      (["trust", "affection", "hostility", "dependence", "power"] as const).forEach((field) => {
        const value = state[field];
        if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 100)) {
          issues.push(issue(`${statePath}.${field}`, "관계 강도는 0~100이어야 합니다."));
        }
      });
    });
  });

  draft.characters.forEach((character, characterIndex) => {
    character.secrets.forEach((secret, secretIndex) => {
      secret.knownByCharacterIds.forEach((id, knownIndex) => {
        if (!characterIds.has(id)) {
          issues.push(issue(`characters[${characterIndex}].secrets[${secretIndex}].knownByCharacterIds[${knownIndex}]`, `존재하지 않는 인물입니다: ${id}`));
        }
      });
      if (secret.revealedAtEventId && !eventIds.has(secret.revealedAtEventId)) {
        issues.push(issue(`characters[${characterIndex}].secrets[${secretIndex}].revealedAtEventId`, `존재하지 않는 사건입니다: ${secret.revealedAtEventId}`));
      }
    });
    character.knowledge.forEach((knowledge, knowledgeIndex) => {
      if (knowledge.acquiredAtEventId && !eventIds.has(knowledge.acquiredAtEventId)) {
        issues.push(issue(`characters[${characterIndex}].knowledge[${knowledgeIndex}].acquiredAtEventId`, `존재하지 않는 사건입니다: ${knowledge.acquiredAtEventId}`));
      }
    });
  });

  draft.events.forEach((event, eventIndex) => {
    const base = `events[${eventIndex}]`;
    if (event.chronologicalOrder !== undefined && !Number.isInteger(event.chronologicalOrder)) {
      issues.push(issue(`${base}.chronologicalOrder`, "사건 순서는 정수여야 합니다."));
    }
    event.locationIds.forEach((id, index) => {
      if (!locationIds.has(id)) issues.push(issue(`${base}.locationIds[${index}]`, `존재하지 않는 장소입니다: ${id}`));
    });
    event.participantIds.forEach((id, index) => {
      if (!characterIds.has(id)) issues.push(issue(`${base}.participantIds[${index}]`, `존재하지 않는 인물입니다: ${id}`));
    });
    [...event.causeEventIds, ...event.consequenceEventIds].forEach((id) => {
      if (!eventIds.has(id)) issues.push(issue(base, `존재하지 않는 연결 사건입니다: ${id}`));
    });
    event.prerequisiteClaimIds.forEach((id, index) => {
      if (!claimIds.has(id)) issues.push(issue(`${base}.prerequisiteClaimIds[${index}]`, `존재하지 않는 정본 명제입니다: ${id}`));
    });
    event.stateChanges.forEach((change, index) => {
      if (!knownSubjectIds.has(change.subjectId)) {
        issues.push(issue(`${base}.stateChanges[${index}].subjectId`, `존재하지 않는 상태 주체입니다: ${change.subjectId}`));
      }
    });
    event.knowledgeChanges.forEach((change, index) => {
      if (!characterIds.has(change.characterId)) {
        issues.push(issue(`${base}.knowledgeChanges[${index}].characterId`, `존재하지 않는 인물입니다: ${change.characterId}`));
      }
    });
  });

  draft.claims.forEach((claim, claimIndex) => {
    const base = `claims[${claimIndex}]`;
    if (!knownSubjectIds.has(claim.subjectId)) {
      issues.push(issue(`${base}.subjectId`, `존재하지 않는 정본 주체입니다: ${claim.subjectId}`));
    }
    claim.holderCharacterIds?.forEach((id, index) => {
      if (!characterIds.has(id)) issues.push(issue(`${base}.holderCharacterIds[${index}]`, `존재하지 않는 인물입니다: ${id}`));
    });
    [claim.revealedAtEventId, claim.validFromEventId, claim.validUntilEventId]
      .filter((id): id is string => id !== undefined)
      .forEach((id) => {
        if (!eventIds.has(id)) issues.push(issue(base, `존재하지 않는 사건 참조입니다: ${id}`));
      });
  });

  validateIssueDefinitions(
    draft.issues,
    knownIds,
    { characters: characterIds, events: eventIds, claims: claimIds, relationships: relationshipIds },
    issues,
  );
  validateEvidence(draft, sourceIndex, issues);
  return issues;
}

export function assertNovelAnalysisDraft(draft: NovelAnalysisDraft): void {
  const issues = validateNovelAnalysisDraft(draft);
  if (issues.length > 0) throw new NovelValidationError(issues);
}
