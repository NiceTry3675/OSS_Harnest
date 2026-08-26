import { describe, expect, it } from "vitest";
import {
  CanonInterviewError,
  NovelValidationError,
  applyCanonAnswers,
  assertNovelAnalysisDraft,
  buildCanonInterview,
  validateNovelAnalysisDraft,
  type AnalyzedValue,
  type CharacterProfile,
  type EvidenceRef,
  type NovelAnalysisDraft,
} from "./index";

const evidence: EvidenceRef = {
  sourceId: "source-settings",
  segmentId: "segment-1",
  quote: "민지는 27세다",
};

const analyzed = <T>(value: T, refs: EvidenceRef[] = [evidence]): AnalyzedValue<T> => ({
  value,
  basis: "explicit",
  reviewState: "unreviewed",
  evidence: refs,
});

function character(id: string, name: string): CharacterProfile {
  return {
    id,
    name,
    aliases: [],
    roles: [],
    appearance: [],
    background: [],
    traits: [],
    values: [],
    contradictions: [],
    boundaries: [],
    secrets: [],
    knowledge: [],
    evidence: [evidence],
    reviewState: "unreviewed",
  };
}

function draft(): NovelAnalysisDraft {
  return {
    schemaVersion: "novel-analysis-v0",
    sources: [
      {
        id: "source-settings",
        filename: "설정집.md",
        kind: "markdown",
        contentDigest: "0".repeat(64),
        segments: [
          {
            id: "segment-1",
            locator: { kind: "heading", heading: "등장인물", index: 1 },
            text: "민지는 27세다. 다른 초고에는 29세라고 적혀 있다. 준은 민지를 경계한다.",
          },
        ],
      },
    ],
    work: {
      genres: [analyzed("판타지")],
      themes: [],
      draftStatus: "partial_draft",
    },
    world: {
      entities: [
        {
          id: "location-capital",
          type: "location",
          name: "수도",
          aliases: [],
          facts: [],
          evidence: [evidence],
          reviewState: "unreviewed",
        },
      ],
      rules: [],
      terminology: [],
    },
    characters: [character("character-minji", "민지"), character("character-jun", "준")],
    relationshipGraph: {
      nodes: [
        {
          id: "node-minji",
          characterId: "character-minji",
          label: "민지",
          factionIds: [],
          reviewState: "unreviewed",
        },
        {
          id: "node-jun",
          characterId: "character-jun",
          label: "준",
          factionIds: [],
          reviewState: "unreviewed",
        },
      ],
      edges: [
        {
          id: "relationship-distrust",
          fromCharacterId: "character-jun",
          toCharacterId: "character-minji",
          kind: "conflict",
          label: "경계",
          direction: "directed",
          states: [],
          evidence: [
            { ...evidence, quote: "준은 민지를 경계한다" },
          ],
          reviewState: "unreviewed",
        },
      ],
    },
    events: [
      {
        id: "event-arrival",
        title: "수도 도착",
        summary: "민지와 준이 수도에 도착한다.",
        role: "story",
        status: "candidate",
        locationIds: ["location-capital"],
        participantIds: ["character-minji", "character-jun"],
        causeEventIds: [],
        prerequisiteClaimIds: [],
        consequenceEventIds: [],
        stateChanges: [],
        knowledgeChanges: [],
        evidence: [evidence],
      },
    ],
    claims: [
      {
        id: "claim-age-27",
        subjectId: "character-minji",
        predicate: "age",
        value: 27,
        truthScope: "objective",
        basis: "explicit",
        reviewState: "unreviewed",
        evidence: [evidence],
      },
      {
        id: "claim-age-29",
        subjectId: "character-minji",
        predicate: "age",
        value: 29,
        truthScope: "objective",
        basis: "explicit",
        reviewState: "unreviewed",
        evidence: [{ ...evidence, quote: "29세라고 적혀 있다" }],
      },
    ],
    issues: [
      {
        id: "issue-age",
        kind: "fact_contradiction",
        priority: "blocking",
        title: "민지의 나이",
        question: "민지의 나이는 어느 쪽이 정본인가요?",
        whyItMatters: "사건 당시의 나이와 경력을 일관되게 계산해야 합니다.",
        relatedEntityIds: ["character-minji", "claim-age-27", "claim-age-29"],
        alternatives: [
          {
            id: "age-27",
            label: "27세",
            evidence: [evidence],
            operations: [
              { kind: "confirm_claim", claimId: "claim-age-27" },
              { kind: "reject_claim", claimId: "claim-age-29" },
            ],
          },
          {
            id: "age-29",
            label: "29세",
            evidence: [{ ...evidence, quote: "29세라고 적혀 있다" }],
            operations: [
              { kind: "confirm_claim", claimId: "claim-age-29" },
              { kind: "reject_claim", claimId: "claim-age-27" },
            ],
          },
        ],
      },
      {
        id: "issue-rumor",
        kind: "intentional_mystery",
        priority: "optional",
        title: "민지의 과거",
        question: "민지의 과거를 의도적으로 숨길까요?",
        whyItMatters: "생성기가 미정인 과거를 단정하지 않아야 합니다.",
        relatedEntityIds: ["character-minji"],
        alternatives: [],
      },
    ],
  };
}

describe("소설 분석 스키마 검증", () => {
  it("근거와 그래프·사건 참조가 온전한 분석 초안을 허용한다", () => {
    expect(validateNovelAnalysisDraft(draft())).toEqual([]);
    expect(() => assertNovelAnalysisDraft(draft())).not.toThrow();
  });

  it("끊어진 관계 참조와 원문에 없는 인용을 함께 거부한다", () => {
    const invalid = draft();
    invalid.relationshipGraph.edges[0].toCharacterId = "character-missing";
    invalid.claims[0].evidence[0] = {
      ...invalid.claims[0].evidence[0],
      quote: "원문에 없는 문장",
    };
    const issues = validateNovelAnalysisDraft(invalid);
    expect(issues.some((value) => value.path.endsWith("toCharacterId"))).toBe(true);
    expect(issues.some((value) => value.path.endsWith("quote"))).toBe(true);
    expect(() => assertNovelAnalysisDraft(invalid)).toThrow(NovelValidationError);
  });
});

describe("정본화 인터뷰", () => {
  it("분석 문제를 근거가 결속된 질문으로 바꾼다", async () => {
    const interview = await buildCanonInterview(draft());
    expect(interview.schemaVersion).toBe("novel-canon-interview-v0");
    expect(interview.questions[0]).toMatchObject({
      id: "question-issue-age",
      kind: "choose_fact",
      priority: "blocking",
      allowUnresolved: false,
    });
    expect(interview.questions[0].options.map((option) => option.id)).toEqual(["age-27", "age-29"]);
  });

  it("필수 질문을 건너뛰면 정본을 만들지 않는다", async () => {
    const analysis = draft();
    const interview = await buildCanonInterview(analysis);
    await expect(applyCanonAnswers(analysis, interview, [])).rejects.toThrow(CanonInterviewError);
    await expect(applyCanonAnswers(analysis, interview, [])).rejects.toThrow("필수 질문");
  });

  it("선택한 사실을 확정하고 선택 질문은 안전한 미정 규칙으로 남긴다", async () => {
    const analysis = draft();
    const interview = await buildCanonInterview(analysis);
    const canon = await applyCanonAnswers(analysis, interview, [
      { questionId: "question-issue-age", selectedOptionId: "age-27" },
    ]);
    expect(canon.claims.find((claim) => claim.id === "claim-age-27")?.reviewState).toBe("confirmed");
    expect(canon.claims.find((claim) => claim.id === "claim-age-29")?.reviewState).toBe("rejected");
    expect(canon.unresolved).toEqual([
      { issueId: "issue-rumor", rule: "preserve_ambiguity" },
    ]);
    expect(canon.canonDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("같은 분석과 답변은 같은 정본 다이제스트를 만든다", async () => {
    const analysis = draft();
    const interview = await buildCanonInterview(analysis);
    const answers = [{ questionId: "question-issue-age", selectedOptionId: "age-29" }];
    const first = await applyCanonAnswers(analysis, interview, answers);
    const second = await applyCanonAnswers(analysis, interview, answers);
    expect(second).toEqual(first);
  });

  it("동일 인물 병합은 그래프·사건·명제 참조를 기준 인물로 옮긴다", async () => {
    const analysis = draft();
    analysis.issues = [
      {
        id: "issue-alias",
        kind: "entity_identity",
        priority: "blocking",
        title: "민지와 준의 동일 인물 여부",
        question: "두 이름이 같은 인물인가요?",
        whyItMatters: "중복 인물은 관계와 사건을 왜곡합니다.",
        relatedEntityIds: ["character-minji", "character-jun"],
        alternatives: [
          {
            id: "same",
            label: "같은 인물",
            evidence: [evidence],
            operations: [
              {
                kind: "merge_characters",
                sourceCharacterIds: ["character-jun"],
                targetCharacterId: "character-minji",
              },
            ],
          },
        ],
      },
    ];
    const interview = await buildCanonInterview(analysis);
    const canon = await applyCanonAnswers(analysis, interview, [
      { questionId: "question-issue-alias", selectedOptionId: "same" },
    ]);
    expect(canon.characters.map((value) => value.id)).toEqual(["character-minji"]);
    expect(canon.events[0].participantIds).toEqual(["character-minji"]);
    expect(canon.claims.every((claim) => claim.subjectId === "character-minji")).toBe(true);
    expect(canon.relationshipGraph.edges).toEqual([]);
  });
});
