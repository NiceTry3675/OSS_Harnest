import { describe, expect, it } from "vitest";
import type { InterviewSubmission } from "@harnest/contracts";
import type { GeneratorFeedback } from "@harnest/loop-engine";
import type { NovelCanon } from "./types";
import {
  compile,
  createNovelGenerator,
  createNovelInitial,
  createNovelMockLlm,
  createNovelScorer,
  createNovelStrategyPlanner,
  runNovelExaminerBattery,
  scoreNovelHoldout,
} from "./index";

function canon(): NovelCanon {
  const source = {
    sourceId: "source-1",
    segmentId: "segment-1",
    quote: "민지는 닫힌 성문 앞에서 준을 만났다.",
  };
  const analyzed = (value: string) => ({
    value,
    basis: "explicit" as const,
    reviewState: "confirmed" as const,
    evidence: [source],
  });
  return {
    schemaVersion: "novel-canon-v0",
    sourceDigest: "a".repeat(64),
    analysisDigest: "b".repeat(64),
    sources: [{
      id: "source-1",
      filename: "설정.md",
      kind: "markdown",
      contentDigest: "c".repeat(64),
      segments: [{ id: "segment-1", locator: { kind: "heading", heading: "설정", index: 0 }, text: source.quote }],
    }],
    work: { title: analyzed("닫힌 성문"), genres: [], themes: [], draftStatus: "partial_draft" },
    world: { summary: analyzed("성벽 도시"), entities: [], rules: [], terminology: [] },
    characters: [
      {
        id: "character-minji",
        name: "민지",
        aliases: [],
        roles: ["주인공"],
        appearance: [],
        background: [],
        traits: [analyzed("경계심")],
        externalGoal: analyzed("도시 진입"),
        fear: analyzed("배신"),
        values: [],
        contradictions: [],
        boundaries: [],
        secrets: [],
        voice: { vocabulary: [], habits: [], avoidedExpressions: [] },
        knowledge: [],
        evidence: [source],
        reviewState: "confirmed",
      },
    ],
    relationshipGraph: {
      nodes: [{
        id: "node-minji",
        characterId: "character-minji",
        label: "민지",
        factionIds: [],
        reviewState: "confirmed",
      }],
      edges: [],
    },
    events: [],
    claims: Array.from({ length: 6 }, (_, index) => ({
      id: `claim-${index}`,
      subjectId: "character-minji",
      predicate: `setting-${index}`,
      value: `fact-${index}`,
      truthScope: "objective" as const,
      basis: "explicit" as const,
      reviewState: "confirmed" as const,
      evidence: [source],
    })),
    decisions: [],
    userClarifications: [],
    unresolved: [],
    canonDigest: "1".repeat(64),
  };
}

async function compiled() {
  const submission: InterviewSubmission = {
    schemaVersion: "skeleton-1",
    templateId: "novel",
    answers: { canon: canon(), creativeDirection: "불신하던 두 사람이 협력한다.", targetLength: 3000 },
  };
  return compile(submission, { judgeProvider: "mock", judgeModel: "노벨 모의 모델" });
}

const feedback: GeneratorFeedback = {
  round: 1,
  championScore: 58,
  championViolations: ["행동 근거 부족"],
  recentPublicExperiments: [],
};

describe("노벨 컴파일·런타임", () => {
  it("정본 명제를 공개·가드·홀드아웃 질문으로 분리하고 다이제스트에 결속한다", async () => {
    const result = await compiled();
    expect(result.problem.visibleProbes.length).toBeGreaterThan(0);
    expect(result.problem.guardProbes.length).toBeGreaterThan(0);
    expect(result.problem.holdoutProbes.length).toBeGreaterThan(0);
    expect(result.pack.criteria[0].params.canonDigest).toBe(canon().canonDigest);
    expect(result.pack.definitionDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("한 장만 고치고 개선된 후보를 더 높게 채점한다", async () => {
    const result = await compiled();
    const llm = createNovelMockLlm(result.problem);
    const initial = await createNovelInitial(result.problem, llm)();
    const before = await createNovelScorer(result.problem, llm)(initial);
    const strategy = await createNovelStrategyPlanner(result.problem, llm)(initial, () => 0.5, feedback);
    const revised = await createNovelGenerator(result.problem, llm)(initial, () => 0.5, feedback, strategy);
    const after = await createNovelScorer(result.problem, llm)(revised);
    expect(revised.chapters[1]).toEqual(initial.chapters[1]);
    expect(revised.chapters[0]).not.toEqual(initial.chapters[0]);
    expect(after.total).toBeGreaterThan(before.total);
    expect(after.guardScore).toBe(100);
  });

  it("홀드아웃은 별도 결과로만 채점한다", async () => {
    const result = await compiled();
    const llm = createNovelMockLlm(result.problem);
    const artifact = await createNovelInitial(result.problem, llm)();
    const holdout = await scoreNovelHoldout(result.problem, artifact, llm);
    expect(holdout.score).toBe(100);
    expect(holdout.perCase).toHaveLength(result.problem.holdoutProbes.length);
  });

  it("시험관 리포트를 팩 다이제스트와 선택 모델에 묶는다", async () => {
    const result = await compiled();
    const llm = createNovelMockLlm(result.problem);
    const report = await runNovelExaminerBattery(result.problem, result.pack, llm);
    expect(report.forDigest).toBe(result.pack.definitionDigest);
    expect(report.overall).toBe("pass");
    expect(report.checks.map((check) => check.id)).toEqual(["stability", "hack_resistance"]);
  });
});
