/** 첨부 헬퍼 테스트 — 순수 병합·디스패치 규칙. PDF·DOCX 추출은 브라우저 수동 확인 경로. */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendFileTexts,
  BINARY_MAX_BYTES,
  extractFileText,
  FILE_ACCEPT,
  fileKind,
} from "./attachText";

// 추출기는 동적 import라 여기서 통째로 대역으로 바꾼다 — 실제 PDF·DOCX 파싱은 브라우저 수동 확인 경로
const pdfFailure = vi.hoisted(() => ({ error: null as Error | null }));
const docxFailure = vi.hoisted(() => ({ error: null as Error | null }));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: () => ({
    promise: pdfFailure.error ? Promise.reject(pdfFailure.error) : Promise.resolve({ numPages: 0 }),
    destroy: async () => {},
  }),
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker-url" }));
vi.mock("mammoth", () => ({
  extractRawText: async () => {
    if (docxFailure.error) throw docxFailure.error;
    return { value: "" };
  },
}));

/** 실제로 메모리를 잡지 않고 크기만 큰 파일 — size 접근자만 덮는다 */
const sizedFile = (name: string, size: number): File => {
  const file = new File(["작은 내용"], name);
  Object.defineProperty(file, "size", { value: size });
  return file;
};

const namedError = (name: string, message: string): Error => {
  const error = new Error(message);
  error.name = name;
  return error;
};

describe("fileKind", () => {
  it("확장자로 텍스트·PDF·DOCX를 구분하고 그 외는 null", () => {
    expect(fileKind("메모.md")).toBe("text");
    expect(fileKind("로그.LOG")).toBe("text");
    expect(fileKind("문서.pdf")).toBe("pdf");
    expect(fileKind("계약.docx")).toBe("docx");
    expect(fileKind("사진.png")).toBeNull();
    expect(fileKind("압축.zip")).toBeNull();
  });
});

describe("extractFileText", () => {
  it("텍스트 계열 파일은 내용을 그대로 읽는다", async () => {
    const file = new File(["  배포 절차 안내  "], "절차.txt", { type: "text/plain" });
    await expect(extractFileText(file)).resolves.toBe("배포 절차 안내");
  });

  it("미지원 형식은 지원 목록을 담은 한국어 오류로 거부한다", async () => {
    const file = new File(["바이너리"], "사진.png");
    await expect(extractFileText(file)).rejects.toThrow("지원하지 않는 파일 형식");
    await expect(extractFileText(file)).rejects.toThrow(FILE_ACCEPT);
  });

  it("텍스트 파일은 바이트가 maxChars×3을 넘으면 읽지 않고 상한 초과로 거부한다", async () => {
    const file = sizedFile("거대.log", 100_000 * 3 + 1);
    const text = vi.spyOn(file, "text");
    await expect(extractFileText(file, 100_000)).rejects.toThrow("'거대.log'은 100,000자 상한을 넘습니다");
    expect(text).not.toHaveBeenCalled();
    // 경계 안이면 읽는다 — 한글처럼 3바이트 글자는 글자 수가 바이트의 1/3이라 정확히 판정 가능하다
    await expect(extractFileText(new File(["가나다"], "짧은.txt"), 3)).resolves.toBe("가나다");
  });

  it("maxChars가 없으면 크기 조기 판정 없이 그대로 읽는다", async () => {
    await expect(extractFileText(new File(["본문"], "자유.txt"))).resolves.toBe("본문");
  });

  it("PDF·DOCX는 25MB 바이트 상한을 넘으면 파싱하지 않고 거부한다", async () => {
    await expect(extractFileText(sizedFile("스캔.pdf", BINARY_MAX_BYTES + 1))).rejects.toThrow(
      "'스캔.pdf'은 25.0MB를 넘어 읽지 않습니다",
    );
    await expect(extractFileText(sizedFile("계약.docx", BINARY_MAX_BYTES + 1))).rejects.toThrow(
      "'계약.docx'은 25.0MB를 넘어 읽지 않습니다",
    );
  });
});

describe("추출기 오류의 한국어 안내", () => {
  afterEach(() => {
    pdfFailure.error = null;
    docxFailure.error = null;
  });

  it("암호 걸린 PDF는 원문을 괄호에 붙인 한국어 오류로 안내한다", async () => {
    pdfFailure.error = namedError("PasswordException", "No password given");
    await expect(extractFileText(new File(["%PDF"], "비밀.pdf"))).rejects.toThrow(
      "'비밀.pdf'은 암호가 걸린 PDF라 읽을 수 없습니다 (No password given)",
    );
  });

  it("손상된 PDF와 그 밖의 pdf.js 오류를 구분한다", async () => {
    pdfFailure.error = namedError("InvalidPDFException", "Invalid PDF structure");
    await expect(extractFileText(new File(["x"], "깨진.pdf"))).rejects.toThrow(
      "'깨진.pdf'은 손상됐거나 PDF 형식이 아닙니다 (Invalid PDF structure)",
    );
    pdfFailure.error = new Error("worker crashed");
    await expect(extractFileText(new File(["x"], "이상.pdf"))).rejects.toThrow(
      "'이상.pdf' 파일을 읽지 못했습니다 (worker crashed)",
    );
  });

  it("스캔 PDF 빈 텍스트 안내는 그대로 통과한다", async () => {
    await expect(extractFileText(new File(["%PDF"], "스캔.pdf"))).rejects.toThrow(
      "'스캔.pdf'에서 텍스트를 추출할 수 없습니다 — 스캔 이미지 PDF일 수 있습니다.",
    );
  });

  it("mammoth 거부는 DOCX 형식 오류로 안내하고 원문을 남긴다", async () => {
    docxFailure.error = new Error("Could not find main document part.");
    await expect(extractFileText(new File(["PK"], "계약.docx"))).rejects.toThrow(
      "'계약.docx'은 손상됐거나 DOCX 형식이 아닙니다 (Could not find main document part.)",
    );
    docxFailure.error = null;
    await expect(extractFileText(new File(["PK"], "빈.docx"))).rejects.toThrow(
      "'빈.docx'에서 텍스트를 추출할 수 없습니다 — 빈 문서일 수 있습니다.",
    );
  });
});

describe("appendFileTexts", () => {
  it("파일명 헤더와 빈 줄 2개 구분으로 이어붙인다", () => {
    const out = appendFileTexts("기존 소개글", [
      { name: "a.md", text: "첫 파일" },
      { name: "b.txt", text: "둘째 파일" },
    ]);
    expect(out).toBe("기존 소개글\n\n--- 파일: a.md ---\n첫 파일\n\n--- 파일: b.txt ---\n둘째 파일");
  });

  it("빈 현재 값에는 구분 없이 시작하고 CRLF를 LF로 정규화한다", () => {
    const out = appendFileTexts("", [{ name: "a.md", text: "줄1\r\n줄2\r\n" }]);
    expect(out).toBe("--- 파일: a.md ---\n줄1\n줄2");
  });

  it("현재 값의 말미 공백은 정리한다", () => {
    const out = appendFileTexts("소개글\n\n\n", [{ name: "a.md", text: "본문" }]);
    expect(out).toBe("소개글\n\n--- 파일: a.md ---\n본문");
  });
});
