/** 케이스 초안 보조 테스트 — 파싱·재시도·호출 상한과 모의 마커 충돌 방지. */

import { describe, expect, it } from "vitest";
import { ASSIST_CALLS_PER_CLICK, ASSIST_MIN_MATERIAL_CHARS, draftCases } from "./assist";
import { DRAFT_CASES_MARKER, draftCasesPrompt, draftCasesRetryPrompt } from "./prompts";
import type { LlmClient } from "./runtime";

const MATERIAL = "사내 배포 파이프라인을 관리하는 업무입니다. ".repeat(5);

const sequenceLlm = (outputs: string[]): LlmClient & { prompts: string[] } => {
  const prompts: string[] = [];
  return {
    providerId: "mock",
    model: "초안-테스트",
    prompts,
    async complete(prompt) {
      prompts.push(prompt);
      return outputs.shift() ?? "";
    },
  };
};

const pair = (i: number) => ({ question: `질문 ${i}`, expectedAnswer: `답 ${i}` });

describe("draftCasesPrompt — 모의 마커 충돌 방지", () => {
  it("초안 마커를 포함하고, 기존 모의 분기 마커 3종은 포함하지 않는다", () => {
    for (const prompt of [
      draftCasesPrompt(MATERIAL, ["기존 질문"], 3),
      draftCasesRetryPrompt(MATERIAL, ["기존 질문"], 3, "깨진 출력"),
    ]) {
      expect(prompt).toContain(DRAFT_CASES_MARKER);
      expect(prompt).toContain("생성 개수: 3");
      expect(prompt).not.toContain("아래 문서만을 근거로");
      expect(prompt).not.toContain("## 채점 목록");
      expect(prompt).not.toContain("JSON만 출력");
      expect(prompt).not.toContain("## 실패 목록");
    }
  });
});

describe("draftCases", () => {
  it("정상 JSON과 코드 펜스 JSON을 모두 파싱한다", async () => {
    const plain = sequenceLlm([JSON.stringify([pair(1), pair(2)])]);
    await expect(draftCases(plain, MATERIAL, [], 2)).resolves.toEqual([pair(1), pair(2)]);
    expect(plain.prompts).toHaveLength(1);

    const fenced = sequenceLlm(["```json\n" + JSON.stringify([pair(1)]) + "\n```"]);
    await expect(draftCases(fenced, MATERIAL, [], 1)).resolves.toEqual([pair(1)]);
  });

  it("첫 형식 오류는 재시도 프롬프트로 한 번만 다시 시도한다", async () => {
    const llm = sequenceLlm(["배열이 아닌 텍스트", JSON.stringify([pair(1)])]);
    await expect(draftCases(llm, MATERIAL, [], 1)).resolves.toEqual([pair(1)]);
    expect(llm.prompts).toHaveLength(2);
    expect(llm.prompts[1]).toContain("<invalid-output>");
    expect(llm.prompts[1]).toContain("배열이 아닌 텍스트");
  });

  it("재시도까지 실패하면 한국어 오류를 던지고 호출은 상한을 넘지 않는다", async () => {
    const llm = sequenceLlm(["깨짐", '[{"question": ""}]']);
    await expect(draftCases(llm, MATERIAL, [], 3)).rejects.toThrow("초안 출력을 해석할 수 없습니다");
    expect(llm.prompts.length).toBeLessThanOrEqual(ASSIST_CALLS_PER_CLICK);
  });

  it("count는 그대로 요청하고, 모델의 초과 반환분은 잘라낸다", async () => {
    const many = Array.from({ length: 9 }, (_, i) => pair(i + 1));
    const llm = sequenceLlm([JSON.stringify(many)]);
    const result = await draftCases(llm, MATERIAL, [], 5);
    expect(result).toHaveLength(5);
    expect(llm.prompts[0]).toContain("생성 개수: 5");
  });

  it("기존 질문과 정규화 기준으로 같은 초안은 제거한다", async () => {
    const llm = sequenceLlm([
      JSON.stringify([
        { question: "  질문 1  ", expectedAnswer: "중복이라 제거될 답" },
        pair(2),
      ]),
    ]);
    const result = await draftCases(llm, MATERIAL, [pair(1)], 2);
    expect(result).toEqual([pair(2)]);
    expect(llm.prompts[0]).toContain("- 질문 1");
  });

  it("참고 자료가 너무 짧으면 모델을 호출하지 않고 거부한다", async () => {
    const llm = sequenceLlm([]);
    await expect(
      draftCases(llm, "짧음".repeat(Math.floor(ASSIST_MIN_MATERIAL_CHARS / 4) - 2), [], 2),
    ).rejects.toThrow("참고 자료가 너무 짧아");
    expect(llm.prompts).toHaveLength(0);
  });
});
