/** 소설 템플릿의 분석·정본화 도메인 계약.
 *  분석 초안은 AI의 관측이고 NovelCanon은 사용자가 확인한 창작 계약이다. */

export const NOVEL_ANALYSIS_SCHEMA_VERSION = "novel-analysis-v0" as const;
export const NOVEL_CANON_SCHEMA_VERSION = "novel-canon-v0" as const;
export const NOVEL_INTERVIEW_SCHEMA_VERSION = "novel-canon-interview-v0" as const;

export type ReviewState = "unreviewed" | "confirmed" | "edited" | "rejected";
export type AnalysisBasis = "explicit" | "inferred";

export interface EvidenceRef {
  sourceId: string;
  segmentId: string;
  /** 사용자가 근거를 바로 확인할 수 있는 짧은 원문 인용. 해당 segment에 실제로 있어야 한다. */
  quote: string;
}

export interface AnalyzedValue<T> {
  value: T;
  basis: AnalysisBasis;
  reviewState: ReviewState;
  evidence: EvidenceRef[];
}

export type SourceLocator =
  | { kind: "page"; page: number }
  | { kind: "heading"; heading: string; index: number }
  | {
      kind: "paragraph";
      index: number;
      heading?: string;
      startLine?: number;
      endLine?: number;
    }
  | { kind: "line"; start: number; end: number; heading?: string };

export interface SourceSegment {
  id: string;
  locator: SourceLocator;
  text: string;
}

export interface SourceDocument {
  id: string;
  filename: string;
  kind: "markdown" | "text" | "pdf" | "docx";
  /** 추출된 내용의 SHA-256. 원본 바이너리 지문과 혼동하지 않는다. */
  contentDigest: string;
  segments: SourceSegment[];
}

export interface WorkProfile {
  title?: AnalyzedValue<string>;
  language?: AnalyzedValue<string>;
  genres: Array<AnalyzedValue<string>>;
  targetAudience?: AnalyzedValue<string>;
  premise?: AnalyzedValue<string>;
  themes: Array<AnalyzedValue<string>>;
  pointOfView?: AnalyzedValue<string>;
  tense?: AnalyzedValue<string>;
  tone?: AnalyzedValue<string>;
  draftStatus: "settings_only" | "outline" | "partial_draft" | "complete_draft";
}

export interface WorldEntity {
  id: string;
  type: "period" | "location" | "organization" | "culture" | "system" | "object";
  name: string;
  aliases: string[];
  description?: string;
  facts: string[];
  evidence: EvidenceRef[];
  reviewState: ReviewState;
}

export interface WorldRule {
  id: string;
  category:
    | "physical"
    | "social"
    | "political"
    | "economic"
    | "technological"
    | "magical"
    | "custom";
  statement: string;
  condition?: string;
  consequence?: string;
  exceptions: string[];
  evidence: EvidenceRef[];
  reviewState: ReviewState;
}

export interface GlossaryTerm {
  id: string;
  term: string;
  aliases: string[];
  meaning: string;
  evidence: EvidenceRef[];
  reviewState: ReviewState;
}

export interface WorldModel {
  summary?: AnalyzedValue<string>;
  entities: WorldEntity[];
  rules: WorldRule[];
  terminology: GlossaryTerm[];
}

export interface CharacterContradiction {
  id: string;
  sideA: string;
  sideB: string;
  manifestation?: string;
  evidence: EvidenceRef[];
}

export interface CharacterSecret {
  id: string;
  content: string;
  knownByCharacterIds: string[];
  revealedAtEventId?: string;
  evidence: EvidenceRef[];
}

export interface CharacterKnowledge {
  id: string;
  subject: string;
  state: "knows" | "believes" | "suspects" | "does_not_know";
  acquiredAtEventId?: string;
  evidence: EvidenceRef[];
}

export interface CharacterVoice {
  register?: string;
  vocabulary: string[];
  habits: string[];
  avoidedExpressions: string[];
}

export interface CharacterProfile {
  id: string;
  name: string;
  aliases: string[];
  roles: string[];
  appearance: Array<AnalyzedValue<string>>;
  background: Array<AnalyzedValue<string>>;
  traits: Array<AnalyzedValue<string>>;
  externalGoal?: AnalyzedValue<string>;
  internalNeed?: AnalyzedValue<string>;
  fear?: AnalyzedValue<string>;
  wound?: AnalyzedValue<string>;
  falseBelief?: AnalyzedValue<string>;
  values: Array<AnalyzedValue<string>>;
  contradictions: CharacterContradiction[];
  boundaries: Array<AnalyzedValue<string>>;
  secrets: CharacterSecret[];
  voice?: CharacterVoice;
  knowledge: CharacterKnowledge[];
  startState?: AnalyzedValue<string>;
  expectedEndState?: AnalyzedValue<string>;
  plannedArc?: AnalyzedValue<string>;
  evidence: EvidenceRef[];
  reviewState: ReviewState;
}

export interface CharacterNode {
  id: string;
  characterId: string;
  label: string;
  role?: string;
  factionIds: string[];
  reviewState: ReviewState;
}

export interface RelationshipState {
  id: string;
  validFromEventId?: string;
  validUntilEventId?: string;
  publicStatus?: string;
  privateAttitude?: string;
  perceivedRelationship?: string;
  trust?: number;
  affection?: number;
  hostility?: number;
  dependence?: number;
  power?: number;
  motivation?: string;
  tension?: string;
  basis: AnalysisBasis;
  evidence: EvidenceRef[];
}

export interface CharacterRelationEdge {
  id: string;
  fromCharacterId: string;
  toCharacterId: string;
  kind:
    | "family"
    | "friendship"
    | "romance"
    | "alliance"
    | "conflict"
    | "authority"
    | "dependency"
    | "debt"
    | "rivalry"
    | "custom";
  label: string;
  direction: "directed" | "mutual";
  states: RelationshipState[];
  evidence: EvidenceRef[];
  reviewState: ReviewState;
}

export interface CharacterRelationGraph {
  nodes: CharacterNode[];
  edges: CharacterRelationEdge[];
}

export interface EventTime {
  label?: string;
  earliest?: string;
  latest?: string;
}

export interface StateChange {
  subjectId: string;
  field: string;
  before?: unknown;
  after: unknown;
}

export interface KnowledgeChange {
  characterId: string;
  subject: string;
  before: CharacterKnowledge["state"];
  after: CharacterKnowledge["state"];
}

export interface StoryEvent {
  id: string;
  title: string;
  summary: string;
  role: "backstory" | "story" | "planned" | "possible";
  status: "confirmed" | "candidate" | "contradictory";
  chronologicalOrder?: number;
  narrativeOrder?: number;
  time?: EventTime;
  locationIds: string[];
  participantIds: string[];
  causeEventIds: string[];
  prerequisiteClaimIds: string[];
  consequenceEventIds: string[];
  stateChanges: StateChange[];
  knowledgeChanges: KnowledgeChange[];
  evidence: EvidenceRef[];
}

export type TruthScope =
  | "objective"
  | "character_belief"
  | "rumor"
  | "deception"
  | "narrator_claim"
  | "unresolved";

export interface CanonClaim {
  id: string;
  subjectId: string;
  predicate: string;
  value: unknown;
  truthScope: TruthScope;
  holderCharacterIds?: string[];
  revealedAtEventId?: string;
  validFromEventId?: string;
  validUntilEventId?: string;
  basis: AnalysisBasis;
  reviewState: ReviewState;
  evidence: EvidenceRef[];
}

export type AnalysisIssueKind =
  | "entity_identity"
  | "fact_contradiction"
  | "timeline_conflict"
  | "relationship_conflict"
  | "world_rule_conflict"
  | "causal_gap"
  | "missing_information"
  | "ambiguous_statement"
  | "intentional_mystery";

export type IssuePriority = "blocking" | "important" | "optional";

export type CanonOperation =
  | { kind: "confirm_claim"; claimId: string }
  | { kind: "reject_claim"; claimId: string }
  | {
      kind: "classify_claim";
      claimId: string;
      truthScope: TruthScope;
      holderCharacterIds?: string[];
      revealedAtEventId?: string;
    }
  | { kind: "merge_characters"; sourceCharacterIds: string[]; targetCharacterId: string }
  | { kind: "order_event"; eventId: string; chronologicalOrder: number }
  | { kind: "confirm_relationship"; relationshipId: string }
  | { kind: "add_user_clarification"; text: string };

export interface IssueAlternative {
  id: string;
  label: string;
  description?: string;
  evidence: EvidenceRef[];
  operations: CanonOperation[];
}

export interface AnalysisIssue {
  id: string;
  kind: AnalysisIssueKind;
  priority: IssuePriority;
  title: string;
  question: string;
  whyItMatters: string;
  relatedEntityIds: string[];
  alternatives: IssueAlternative[];
}

export interface NovelAnalysisDraft {
  schemaVersion: typeof NOVEL_ANALYSIS_SCHEMA_VERSION;
  sources: SourceDocument[];
  work: WorkProfile;
  world: WorldModel;
  characters: CharacterProfile[];
  relationshipGraph: CharacterRelationGraph;
  events: StoryEvent[];
  claims: CanonClaim[];
  issues: AnalysisIssue[];
}

export type CanonQuestionKind =
  | "choose_fact"
  | "confirm_identity"
  | "order_events"
  | "classify_truth"
  | "clarify_relationship"
  | "fill_missing_information"
  | "confirm_intentional_ambiguity";

export interface EvidenceGroup {
  label: string;
  evidence: EvidenceRef[];
}

export interface CanonQuestionOption {
  id: string;
  label: string;
  description?: string;
  evidence: EvidenceRef[];
}

export interface CanonQuestion {
  id: string;
  issueId: string;
  kind: CanonQuestionKind;
  priority: IssuePriority;
  title: string;
  question: string;
  whyItMatters: string;
  relatedEntityIds: string[];
  evidenceGroups: EvidenceGroup[];
  options: CanonQuestionOption[];
  allowCustomAnswer: boolean;
  allowUnresolved: boolean;
}

export interface CanonInterview {
  schemaVersion: typeof NOVEL_INTERVIEW_SCHEMA_VERSION;
  analysisDigest: string;
  questions: CanonQuestion[];
}

export interface CanonAnswer {
  questionId: string;
  selectedOptionId?: string;
  customAnswer?: string;
  leaveUnresolved?: boolean;
  unresolvedRule?: "do_not_assert" | "preserve_ambiguity" | "may_propose_later";
}

export interface CanonDecision {
  id: string;
  questionId: string;
  issueId: string;
  selectedOptionId?: string;
  customAnswer?: string;
  operations: CanonOperation[];
}

export interface UnresolvedCanon {
  issueId: string;
  rule: "do_not_assert" | "preserve_ambiguity" | "may_propose_later";
}

export interface UserClarification {
  issueId: string;
  text: string;
}

export interface NovelCanon {
  schemaVersion: typeof NOVEL_CANON_SCHEMA_VERSION;
  sourceDigest: string;
  analysisDigest: string;
  canonDigest: string;
  sources: SourceDocument[];
  work: WorkProfile;
  world: WorldModel;
  characters: CharacterProfile[];
  relationshipGraph: CharacterRelationGraph;
  events: StoryEvent[];
  claims: CanonClaim[];
  decisions: CanonDecision[];
  userClarifications: UserClarification[];
  unresolved: UnresolvedCanon[];
}

export interface NovelValidationIssue {
  path: string;
  message: string;
}
