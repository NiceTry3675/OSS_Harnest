import { describe, expect, it } from "vitest";
import {
  NOVEL_SOURCE_ACCEPT,
  NovelSourceError,
  extractMarkdownSegments,
  extractNovelSource,
  extractNovelSources,
  extractPlainTextSegments,
  novelSourceKind,
} from "./index";

describe("노벨 자료 형식 판별", () => {
  it("Markdown·텍스트·PDF·DOCX를 확장자로 구분한다", () => {
    expect(novelSourceKind("설정집.md")).toBe("markdown");
    expect(novelSourceKind("설정집.MARKDOWN")).toBe("markdown");
    expect(novelSourceKind("초고.txt")).toBe("text");
    expect(novelSourceKind("초고.PDF")).toBe("pdf");
    expect(novelSourceKind("인물표.docx")).toBe("docx");
    expect(novelSourceKind("구형문서.doc")).toBeNull();
  });

  it("지원하지 않는 파일은 지원 목록과 함께 거부한다", async () => {
    const file = new File(["내용"], "설정집.rtf");
    await expect(extractNovelSource(file)).rejects.toThrow(NovelSourceError);
    await expect(extractNovelSource(file)).rejects.toThrow(NOVEL_SOURCE_ACCEPT);
  });
});

describe("위치가 보존된 텍스트 추출", () => {
  it("Markdown 제목과 제목 아래 문단·행 위치를 보존한다", () => {
    const segments = extractMarkdownSegments(
      "# 세계관\n수도는 섬에 있다.\n배로만 갈 수 있다.\n\n## 인물\n민지는 27세다.\n",
    );
    expect(segments).toEqual([
      {
        id: "segment-1",
        locator: { kind: "heading", heading: "세계관", index: 1 },
        text: "# 세계관",
      },
      {
        id: "segment-2",
        locator: {
          kind: "paragraph",
          index: 1,
          heading: "세계관",
          startLine: 2,
          endLine: 3,
        },
        text: "수도는 섬에 있다.\n배로만 갈 수 있다.",
      },
      {
        id: "segment-3",
        locator: { kind: "heading", heading: "인물", index: 2 },
        text: "## 인물",
      },
      {
        id: "segment-4",
        locator: {
          kind: "paragraph",
          index: 2,
          heading: "인물",
          startLine: 6,
          endLine: 6,
        },
        text: "민지는 27세다.",
      },
    ]);
  });

  it("일반 텍스트는 빈 줄로 문단을 나누고 원래 행 범위를 남긴다", () => {
    expect(extractPlainTextSegments("첫 줄\r\n둘째 줄\r\n\r\n넷째 줄")).toEqual([
      {
        id: "segment-1",
        locator: { kind: "line", start: 1, end: 2 },
        text: "첫 줄\n둘째 줄",
      },
      {
        id: "segment-2",
        locator: { kind: "line", start: 4, end: 4 },
        text: "넷째 줄",
      },
    ]);
  });
});

describe("SourceDocument 생성", () => {
  it("같은 파일은 같은 조각·내용 지문·자료 id를 만든다", async () => {
    const first = await extractNovelSource(new File(["# 인물\n민지는 27세다."], "설정집.md"));
    const second = await extractNovelSource(new File(["# 인물\n민지는 27세다."], "설정집.md"));
    expect(first).toEqual(second);
    expect(first.kind).toBe("markdown");
    expect(first.contentDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(first.id).toMatch(/^source-[a-f0-9]{16}$/);
  });

  it("내용이 같아도 파일명이 다르면 출처 id는 다르고 내용 지문은 같다", async () => {
    const first = await extractNovelSource(new File(["같은 내용"], "a.txt"));
    const second = await extractNovelSource(new File(["같은 내용"], "b.txt"));
    expect(first.contentDigest).toBe(second.contentDigest);
    expect(first.id).not.toBe(second.id);
  });

  it("빈 문서와 같은 자료의 중복 첨부를 거부한다", async () => {
    await expect(extractNovelSource(new File(["  \n"], "빈파일.txt"))).rejects.toThrow(
      "텍스트를 추출할 수 없습니다",
    );
    const files = [
      new File(["동일 자료"], "설정집.txt"),
      new File(["동일 자료"], "설정집.txt"),
    ];
    await expect(extractNovelSources(files)).rejects.toThrow("중복 첨부");
  });
});
