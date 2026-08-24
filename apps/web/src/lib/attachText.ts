/** 첨부 파일 텍스트 추출·병합 — 원료(material) 입력 보조.
 *  추출은 전부 이 브라우저 안에서 일어나고 파일은 어디로도 전송되지 않는다(SPEC §3 원칙 1).
 *  PDF·DOCX 추출기는 동적 import로 로드해 메인 번들 크기에 넣지 않는다. */

const TEXT_EXTENSIONS = [
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".log", ".json", ".yaml", ".yml", ".xml", ".html",
];

export const FILE_ACCEPT = [...TEXT_EXTENSIONS, ".pdf", ".docx"].join(",");

export type AttachFileKind = "text" | "pdf" | "docx";

export function fileKind(name: string): AttachFileKind | null {
  const lower = name.toLocaleLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".docx")) return "docx";
  if (TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "text";
  return null;
}

async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
  try {
    const doc = await task.promise;
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
      );
    }
    const text = pages.filter((p) => p.length > 0).join("\n\n");
    if (text.length === 0) {
      throw new Error(
        `'${file.name}'에서 텍스트를 추출할 수 없습니다 — 스캔 이미지 PDF일 수 있습니다.`,
      );
    }
    return text;
  } finally {
    await task.destroy();
  }
}

async function extractDocxText(file: File): Promise<string> {
  const { extractRawText } = await import("mammoth");
  const result = await extractRawText({ arrayBuffer: await file.arrayBuffer() });
  const text = result.value.trim();
  if (text.length === 0) {
    throw new Error(`'${file.name}'에서 텍스트를 추출할 수 없습니다 — 빈 문서일 수 있습니다.`);
  }
  return text;
}

/** 한 파일의 텍스트 추출 — 미지원 형식은 한국어 오류로 거부한다 */
export async function extractFileText(file: File): Promise<string> {
  const kind = fileKind(file.name);
  if (kind === null) {
    throw new Error(`지원하지 않는 파일 형식입니다: '${file.name}' (지원: ${FILE_ACCEPT})`);
  }
  if (kind === "pdf") return extractPdfText(file);
  if (kind === "docx") return extractDocxText(file);
  return (await file.text()).trim();
}

/** 현재 textarea 값 뒤에 파일 텍스트를 파일명 헤더와 함께 이어붙인다 — 순수 함수 */
export function appendFileTexts(
  current: string,
  files: Array<{ name: string; text: string }>,
): string {
  let out = current.replace(/\s+$/, "");
  for (const f of files) {
    const body = f.text.replace(/\r\n/g, "\n").trim();
    const block = `--- 파일: ${f.name} ---\n${body}`;
    out = out.length > 0 ? `${out}\n\n${block}` : block;
  }
  return out;
}
