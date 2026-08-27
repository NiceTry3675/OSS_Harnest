import { describe, expect, it } from "vitest";
import type { JudgeProvider } from "@harnest/contracts";
import {
  MAX_NOVEL_ANALYSIS_INPUT_CHARS,
  NovelAnalysisFormatError,
  analyzeNovelSources,
  buildCanonInterview,
  createMockNovelAnalysis,
  extractNovelSource,
  type NovelLlmClient,
} from "./index";

class SequenceLlm implements NovelLlmClient {
  readonly providerId: JudgeProvider = "mock";
  readonly model = "분석 테스트";
  calls: string[] = [];

  constructor(private readonly responses: string[]) {}

  async complete(prompt: string): Promise<string> {
    this.calls.push(prompt);
    const response = this.responses.shift();
    if (response === undefined) throw new Error("준비된 응답이 없습니다.");
    return response;
  }
}

const validPayload = JSON.stringify({
  work: { genres: [], themes: [], draftStatus: "partial_draft" },
  world: { entities: [], rules: [], terminology: [] },
  characters: [],
  relationshipGraph: { nodes: [], edges: [] },
  events: [],
  claims: [],
  issues: [],
});

describe("노벨 LLM 분석", () => {
  it("구조와 참조가 유효한 JSON에 원본 자료를 결속한다", async () => {
    const source = await extractNovelSource(new File(["# 인물\n민지는 준을 경계한다."], "설정.md"));
    const llm = new SequenceLlm([validPayload]);
    const analysis = await analyzeNovelSources([source], "불신이 신뢰로 변하는 이야기", llm);
    expect(analysis.schemaVersion).toBe("novel-analysis-v0");
    expect(analysis.sources).toEqual([source]);
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]).toContain(source.id);
    expect(llm.calls[0]).toContain(source.segments[1].id);
  });

  it("잘못된 형식은 수정 요청 1회 뒤 정상 결과를 받는다", async () => {
    const source = await extractNovelSource(new File(["설정"], "설정.txt"));
    const llm = new SequenceLlm(["JSON 아님", validPayload]);
    await expect(analyzeNovelSources([source], "완결", llm)).resolves.toMatchObject({
      sources: [source],
    });
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]).toContain("직전 출력은 다음 이유로 거부되었다");
  });

  it("수정 요청 뒤에도 잘못된 출력이면 부분 분석을 반환하지 않는다", async () => {
    const source = await extractNovelSource(new File(["설정"], "설정.txt"));
    const llm = new SequenceLlm(["{}", "{}"]);
    await expect(analyzeNovelSources([source], "완결", llm)).rejects.toThrow(
      NovelAnalysisFormatError,
    );
    await expect(
      analyzeNovelSources([source], "완결", new SequenceLlm(["{}", "{}"])),
    ).rejects.toThrow("수정 요청 1회 후에도");
  });

  it("현재 단일 분석 상한을 넘으면 모델을 호출하지 않는다", async () => {
    const source = await extractNovelSource(
      new File(["가".repeat(MAX_NOVEL_ANALYSIS_INPUT_CHARS + 1)], "초고.txt"),
    );
    const llm = new SequenceLlm([validPayload]);
    await expect(analyzeNovelSources([source], "완결", llm)).rejects.toThrow("현재 분석 1회");
    expect(llm.calls).toHaveLength(0);
  });
});

describe("모의 노벨 분석", () => {
  it("외부 호출 없이 근거가 있는 분석과 정본화 질문을 만든다", async () => {
    const source = await extractNovelSource(
      new File(["# 인물\n민지는 준을 믿지 않는다."], "설정.md"),
    );
    const analysis = createMockNovelAnalysis([source], "두 사람이 화해하는 결말");
    const interview = await buildCanonInterview(analysis);
    expect(analysis.work.premise?.evidence[0]).toMatchObject({
      sourceId: source.id,
      segmentId: source.segments[0].id,
    });
    expect(interview.questions).toHaveLength(1);
    expect(interview.questions[0].options[0].label).toBe("두 사람이 화해하는 결말");
  });
});
