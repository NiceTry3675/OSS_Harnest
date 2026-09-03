/** 첨부 파일 텍스트 추출·병합 — 원료(material) 입력 보조.
 *  추출은 전부 이 브라우저 안에서 일어나고 파일은 어디로도 전송되지 않는다(SPEC §3 원칙 1).
 *  PDF·DOCX 추출기는 동적 import로 로드해 메인 번들 크기에 넣지 않는다. */

const TEXT_EXTENSIONS = [
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".log", ".json", ".yaml", ".yml", ".xml", ".html",
];

export const FILE_ACCEPT = [...TEXT_EXTENSIONS, ".pdf", ".docx"].join(",");

/** PDF·DOCX는 바이트 수로 글자 수를 미리 알 수 없으므로 고정 바이트 상한만 둔다 —
 *  그 이상은 파싱 자체가 화면을 오래 멈추게 한다. */
export const BINARY_MAX_BYTES = 25 * 1024 * 1024;

export type AttachFileKind = "text" | "pdf" | "docx";

export function fileKind(name: string): AttachFileKind | null {
  const lower = name.toLocaleLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".docx")) return "docx";
  if (TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "text";
  return null;
}

/** 우리가 직접 만든 한국어 오류 — 추출기 오류를 감쌀 때 이것은 그대로 통과시킨다 */
class AttachError extends Error {}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
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
      throw new AttachError(
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
    throw new AttachError(`'${file.name}'에서 텍스트를 추출할 수 없습니다 — 빈 문서일 수 있습니다.`);
  }
  return text;
}

/** pdf.js·mammoth가 던지는 영어 오류를 한국어로 감싼다. 원문은 괄호에 남겨 디버깅 단서를 보존한다. */
function describeExtractError(file: File, kind: "pdf" | "docx", error: unknown): Error {
  if (error instanceof AttachError) return error;
  const name = typeof (error as { name?: unknown })?.name === "string" ? (error as Error).name : "";
  const detail = error instanceof Error ? error.message : String(error);
  const suffix = detail ? ` (${detail})` : "";
  if (kind === "pdf") {
    if (name === "PasswordException") {
      return new AttachError(`'${file.name}'은 암호가 걸린 PDF라 읽을 수 없습니다${suffix}`);
    }
    if (name === "InvalidPDFException" || name === "FormatError") {
      return new AttachError(`'${file.name}'은 손상됐거나 PDF 형식이 아닙니다${suffix}`);
    }
  } else {
    // mammoth·JSZip은 오류 종류를 구분해 주지 않는다 — 형식 문제로 뭉뚱그려 안내한다
    return new AttachError(`'${file.name}'은 손상됐거나 DOCX 형식이 아닙니다${suffix}`);
  }
  return new AttachError(`'${file.name}' 파일을 읽지 못했습니다${suffix}`);
}

/** 한 파일의 텍스트 추출 — 미지원 형식은 한국어 오류로 거부한다.
 *  maxChars를 주면 텍스트 파일은 읽기 전에 크기로 상한 초과를 조기 판정한다. */
export async function extractFileText(file: File, maxChars?: number): Promise<string> {
  const kind = fileKind(file.name);
  if (kind === null) {
    throw new AttachError(`지원하지 않는 파일 형식입니다: '${file.name}' (지원: ${FILE_ACCEPT})`);
  }
  if (kind === "text") {
    // JS 문자열 길이는 UTF-8 바이트 수의 1/3 이상이므로, 바이트가 maxChars×3을 넘으면
    // 읽지 않아도 상한 초과가 확정된다 — 수백 MB 로그를 통째로 메모리에 올리지 않는다.
    if (maxChars !== undefined && file.size > maxChars * 3) {
      throw new AttachError(
        `'${file.name}'은 ${maxChars.toLocaleString("ko-KR")}자 상한을 넘습니다 (약 ${megabytes(file.size)}).`,
      );
    }
    return (await file.text()).trim();
  }
  if (file.size > BINARY_MAX_BYTES) {
    throw new AttachError(
      `'${file.name}'은 ${megabytes(BINARY_MAX_BYTES)}를 넘어 읽지 않습니다 (약 ${megabytes(file.size)}).`,
    );
  }
  try {
    return kind === "pdf" ? await extractPdfText(file) : await extractDocxText(file);
  } catch (error) {
    throw describeExtractError(file, kind, error);
  }
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
