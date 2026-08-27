import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  buildCanonInterview,
  createMockNovelAnalysis,
  type SourceDocument,
} from "@harnest/template-novel";
import { NovelCanonPreparationView } from "./NovelCanonPreparation";

describe("노벨 정본화 화면", () => {
  it("분석 요약·관계 그래프·근거 중심 인터뷰를 한 흐름으로 표시한다", async () => {
    const source: SourceDocument = {
      id: "source-1",
      filename: "내-설정.md",
      kind: "markdown",
      contentDigest: "a".repeat(64),
      segments: [{
        id: "segment-1",
        locator: { kind: "heading", heading: "인물", index: 1 },
        text: "민지는 준을 믿지 않지만 성문을 함께 통과해야 한다.",
      }],
    };
    const analysis = createMockNovelAnalysis([source], "불신이 행동으로 드러나야 한다.");
    const interview = await buildCanonInterview(analysis);
    const html = renderToStaticMarkup(
      <NovelCanonPreparationView
        value={{ analysis, interview }}
        onBack={() => {}}
        onComplete={() => {}}
      />,
    );
    expect(html).toContain("AI가 이해한 이야기를 확정해 주세요");
    expect(html).toContain("관계 그래프");
    expect(html).toContain("자료 분석 완료");
    expect(html).toContain("가장 지킬 방향");
    expect(html).toContain("정본으로 확정하고 승인 화면으로");
  });
});
