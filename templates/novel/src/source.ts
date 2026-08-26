/** 노벨 자료의 구조화 텍스트 추출.
 *  기존 인수인계 textarea 병합과 분리된 경로이며 파일은 브라우저 밖으로 전송하지 않는다. */

import { sha256Canonical } from "@harnest/contracts";
import type { SourceDocument, SourceLocator, SourceSegment } from "./types";

export const NOVEL_SOURCE_ACCEPT = ".txt,.md,.markdown,.pdf,.docx";
export const MAX_NOVEL_SOURCE_BYTES = 10 * 1024 * 1024;
export const MAX_NOVEL_SOURCE_CHARS = 500_000;
export const MAX_NOVEL_SOURCE_SEGMENTS = 5_000;
export const MAX_NOVEL_SOURCE_BUNDLE_CHARS = 1_000_000;

export type NovelSourceKind = SourceDocument["kind"];

interface ExtractedSegment {
  locator: SourceLocator;
  text: string;
}

export class NovelSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NovelSourceError";
  }
}

export function novelSourceKind(filename: string): NovelSourceKind | null {
  const lower = filename.toLocaleLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".txt")) return "text";
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".docx")) return "docx";
  return null;
}

function normalizedLines(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n");
}

function pushSegment(
  out: ExtractedSegment[],
  locator: SourceLocator,
  text: string,
): void {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (normalized.length > 0) out.push({ locator, text: normalized });
}

export function extractMarkdownSegments(text: string): SourceSegment[] {
  const lines = normalizedLines(text);
  const out: ExtractedSegment[] = [];
  let currentHeading: string | undefined;
  let headingIndex = 0;
  let paragraphIndex = 0;
  let paragraphStart = 0;
  let paragraphLines: string[] = [];

  const flushParagraph = (endLine: number): void => {
    if (paragraphLines.length === 0) return;
    paragraphIndex += 1;
    pushSegment(
      out,
      {
        kind: "paragraph",
        index: paragraphIndex,
        startLine: paragraphStart,
        endLine,
        ...(currentHeading === undefined ? {} : { heading: currentHeading }),
      },
      paragraphLines.join("\n"),
    );
    paragraphLines = [];
  };

  lines.forEach((line, zeroIndex) => {
    const lineNumber = zeroIndex + 1;
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushParagraph(lineNumber - 1);
      currentHeading = heading[1].trim();
      headingIndex += 1;
      pushSegment(
        out,
        { kind: "heading", heading: currentHeading, index: headingIndex },
        line,
      );
      return;
    }
    if (line.trim().length === 0) {
      flushParagraph(lineNumber - 1);
      return;
    }
    if (paragraphLines.length === 0) paragraphStart = lineNumber;
    paragraphLines.push(line);
  });
  flushParagraph(lines.length);
  return out.map((segment, index) => ({ id: `segment-${index + 1}`, ...segment }));
}

export function extractPlainTextSegments(text: string): SourceSegment[] {
  const lines = normalizedLines(text);
  const out: ExtractedSegment[] = [];
  let startLine = 0;
  let paragraph: string[] = [];
  const flush = (endLine: number): void => {
    if (paragraph.length === 0) return;
    pushSegment(out, { kind: "line", start: startLine, end: endLine }, paragraph.join("\n"));
    paragraph = [];
  };
  lines.forEach((line, zeroIndex) => {
    const lineNumber = zeroIndex + 1;
    if (line.trim().length === 0) {
      flush(lineNumber - 1);
      return;
    }
    if (paragraph.length === 0) startLine = lineNumber;
    paragraph.push(line);
  });
  flush(lines.length);
  return out.map((segment, index) => ({ id: `segment-${index + 1}`, ...segment }));
}

async function extractPdfSegments(file: File): Promise<SourceSegment[]> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
  try {
    const document = await task.promise;
    const segments: SourceSegment[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text.length > 0) {
        segments.push({
          id: `segment-${segments.length + 1}`,
          locator: { kind: "page", page: pageNumber },
          text,
        });
      }
    }
    return segments;
  } finally {
    await task.destroy();
  }
}

function docxHtmlSegments(html: string): SourceSegment[] {
  if (typeof DOMParser === "undefined") return [];
  const document = new DOMParser().parseFromString(html, "text/html");
  const elements = Array.from(document.body.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li"));
  const out: ExtractedSegment[] = [];
  let currentHeading: string | undefined;
  let headingIndex = 0;
  let paragraphIndex = 0;
  for (const element of elements) {
    const text = element.textContent?.replace(/\s+/g, " ").trim() ?? "";
    if (text.length === 0) continue;
    if (/^H[1-6]$/.test(element.tagName)) {
      currentHeading = text;
      headingIndex += 1;
      pushSegment(out, { kind: "heading", heading: text, index: headingIndex }, text);
    } else {
      paragraphIndex += 1;
      pushSegment(
        out,
        {
          kind: "paragraph",
          index: paragraphIndex,
          ...(currentHeading === undefined ? {} : { heading: currentHeading }),
        },
        text,
      );
    }
  }
  return out.map((segment, index) => ({ id: `segment-${index + 1}`, ...segment }));
}

async function extractDocxSegments(file: File): Promise<SourceSegment[]> {
  const mammoth = await import("mammoth");
  const arrayBuffer = await file.arrayBuffer();
  const html = await mammoth.convertToHtml({ arrayBuffer });
  const structured = docxHtmlSegments(html.value);
  if (structured.length > 0) return structured;
  // Node 테스트나 오래된 브라우저처럼 DOMParser가 없는 환경에서도 문단 경계는 보존한다.
  const raw = await mammoth.extractRawText({ arrayBuffer });
  return extractPlainTextSegments(raw.value).map((segment, index) => ({
    ...segment,
    id: `segment-${index + 1}`,
    locator: {
      kind: "paragraph",
      index: index + 1,
      ...(segment.locator.kind === "line"
        ? { startLine: segment.locator.start, endLine: segment.locator.end }
        : {}),
    },
  }));
}

function assertSourceLimits(file: File): void {
  if (file.size > MAX_NOVEL_SOURCE_BYTES) {
    throw new NovelSourceError(
      `'${file.name}'은 ${(MAX_NOVEL_SOURCE_BYTES / 1024 / 1024).toLocaleString()} MiB를 넘을 수 없습니다.`,
    );
  }
}

async function finalizeSource(
  file: File,
  kind: NovelSourceKind,
  segments: SourceSegment[],
): Promise<SourceDocument> {
  if (segments.length === 0) {
    const hint = kind === "pdf" ? " — 스캔 이미지 PDF일 수 있습니다." : " — 빈 문서일 수 있습니다.";
    throw new NovelSourceError(`'${file.name}'에서 텍스트를 추출할 수 없습니다${hint}`);
  }
  if (segments.length > MAX_NOVEL_SOURCE_SEGMENTS) {
    throw new NovelSourceError(
      `'${file.name}'의 문서 조각이 ${MAX_NOVEL_SOURCE_SEGMENTS.toLocaleString()}개를 넘습니다.`,
    );
  }
  const charCount = segments.reduce((sum, segment) => sum + segment.text.length, 0);
  if (charCount > MAX_NOVEL_SOURCE_CHARS) {
    throw new NovelSourceError(
      `'${file.name}'의 추출 글은 ${MAX_NOVEL_SOURCE_CHARS.toLocaleString()}자를 넘을 수 없습니다.`,
    );
  }
  const contentDigest = await sha256Canonical(
    segments.map((segment) => ({ locator: segment.locator, text: segment.text })),
  );
  const sourceIdentity = await sha256Canonical({ filename: file.name, kind, contentDigest });
  return {
    id: `source-${sourceIdentity.slice(0, 16)}`,
    filename: file.name,
    kind,
    contentDigest,
    segments,
  };
}

export async function extractNovelSource(file: File): Promise<SourceDocument> {
  const kind = novelSourceKind(file.name);
  if (kind === null) {
    throw new NovelSourceError(
      `지원하지 않는 파일 형식입니다: '${file.name}' (지원: ${NOVEL_SOURCE_ACCEPT})`,
    );
  }
  assertSourceLimits(file);
  let segments: SourceSegment[];
  if (kind === "markdown") segments = extractMarkdownSegments(await file.text());
  else if (kind === "text") segments = extractPlainTextSegments(await file.text());
  else if (kind === "pdf") segments = await extractPdfSegments(file);
  else segments = await extractDocxSegments(file);
  return finalizeSource(file, kind, segments);
}

export async function extractNovelSources(files: readonly File[]): Promise<SourceDocument[]> {
  const sources: SourceDocument[] = [];
  let totalChars = 0;
  const ids = new Set<string>();
  for (const file of files) {
    const source = await extractNovelSource(file);
    if (ids.has(source.id)) {
      throw new NovelSourceError(`같은 자료가 중복 첨부되었습니다: '${file.name}'`);
    }
    ids.add(source.id);
    totalChars += source.segments.reduce((sum, segment) => sum + segment.text.length, 0);
    if (totalChars > MAX_NOVEL_SOURCE_BUNDLE_CHARS) {
      throw new NovelSourceError(
        `전체 추출 글은 ${MAX_NOVEL_SOURCE_BUNDLE_CHARS.toLocaleString()}자를 넘을 수 없습니다.`,
      );
    }
    sources.push(source);
  }
  return sources;
}
