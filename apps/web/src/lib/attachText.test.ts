/** 첨부 헬퍼 테스트 — 순수 병합·디스패치 규칙. PDF·DOCX 추출은 브라우저 수동 확인 경로. */

import { describe, expect, it } from "vitest";
import { appendFileTexts, extractFileText, FILE_ACCEPT, fileKind } from "./attachText";

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
