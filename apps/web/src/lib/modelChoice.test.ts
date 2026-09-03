/** 모델 목록 추리기 — 구형·잡동사니가 기본으로 잡히면 키를 넣어도 실패한다.
 *  실제 벤더 목록에서 나온 이름으로 검사한다. */

import { describe, expect, it } from "vitest";
import type { AvailableModel } from "./llm";
import { pickModel, preferredModels } from "./modelChoice";

const models = (...ids: string[]): AvailableModel[] =>
  ids.map((id) => ({ id, label: id, source: "api" as const }));

describe("preferredModels", () => {
  it("구형과 잡동사니를 뺀다", () => {
    const kept = preferredModels(
      models(
        "babbage-002",
        "davinci-002",
        "gpt-3.5-turbo-instruct",
        "gpt-4",
        "gpt-4-turbo",
        "text-embedding-3-small",
        "whisper-1",
        "dall-e-3",
        "gpt-5.6-sol",
      ),
    ).map((m) => m.id);
    expect(kept).toEqual(["gpt-5.6-sol"]);
  });

  it("날짜가 박힌 스냅샷은 빼고 별칭만 남긴다", () => {
    const kept = preferredModels(
      models("gpt-5.6-sol", "gpt-5.6-sol-2026-01-15", "gpt-4-turbo-2024-04-09", "gpt-4-0613"),
    ).map((m) => m.id);
    expect(kept).toEqual(["gpt-5.6-sol"]);
  });

  it("벤더 접두사가 붙은 OpenRouter 이름도 알아본다", () => {
    const kept = preferredModels(
      models("openai/gpt-5.6-sol", "anthropic/claude-sonnet-5", "openai/gpt-3.5-turbo"),
    ).map((m) => m.id);
    expect(kept).toEqual(["openai/gpt-5.6-sol", "anthropic/claude-sonnet-5"]);
  });

  it("여섯 벤더의 현행 갈래를 모두 남긴다", () => {
    const kept = preferredModels(
      models(
        "gpt-5.6-sol",
        "claude-opus-5",
        "claude-fable-5-1",
        "gemini-3.8-flash",
        "llama3.1",
        "qwen3",
        "o4-mini",
      ),
    ).map((m) => m.id);
    expect(kept).toHaveLength(7);
  });

  it("Claude는 opus·sonnet·fable·mythos의 4.6 이후만 남기고 haiku·4.5 이하는 뺀다", () => {
    const kept = preferredModels(
      models(
        "claude-fable-5-1",
        "claude-mythos-5-1",
        "claude-opus-4-6",
        "claude-sonnet-4-5",
        "claude-haiku-4-5",
        "claude-opus-4-1",
      ),
    ).map((m) => m.id);
    expect(kept).toEqual(["claude-fable-5-1", "claude-mythos-5-1", "claude-opus-4-6"]);
  });

  it("규칙에 걸리는 것이 하나도 없으면 원래 목록을 그대로 준다", () => {
    // 규칙이 시대에 뒤처져도 고를 것이 사라지면 안 된다
    const raw = models("사내-모델-1", "사내-모델-2");
    expect(preferredModels(raw).map((m) => m.id)).toEqual(["사내-모델-1", "사내-모델-2"]);
  });
});

describe("pickModel", () => {
  it("목록 맨 앞이 구형이어도 현행 모델을 집는다", () => {
    expect(pickModel(models("babbage-002", "gpt-4", "gpt-5.6-sol"), "")).toBe("gpt-5.6-sol");
  });

  it("이미 고른 모델이 목록에 있으면 그대로 둔다", () => {
    expect(pickModel(models("gpt-5.6-sol", "gpt-4"), "gpt-4")).toBe("gpt-4");
    // 기본 모델을 넘겨도 이미 고른 것이 우선이다
    expect(pickModel(models("gpt-5.6-sol", "gpt-5"), "gpt-5", "gpt-5.6-sol")).toBe("gpt-5");
  });

  it("고른 것이 없고 기본 모델이 목록에 있으면 알파벳순 첫 항목 대신 기본 모델을 고른다", () => {
    // 라벨순으로는 gpt-5 < gpt-5-mini < gpt-5.6-sol — 구형이 기본으로 잡히면 안 된다
    expect(pickModel(models("gpt-5", "gpt-5-mini", "gpt-5.6-sol"), "", "gpt-5.6-sol")).toBe(
      "gpt-5.6-sol",
    );
  });

  it("Claude Fable이 목록 앞에 있어도 기본 모델이 있으면 Opus를 고른다", () => {
    // 비싼 갈래가 알파벳순으로 앞에 와도 자동 선택이 그쪽으로 튀지 않는다
    expect(
      pickModel(models("claude-fable-5-1", "claude-opus-5", "claude-sonnet-5"), "", "claude-opus-5"),
    ).toBe("claude-opus-5");
  });

  it("기본 모델이 목록에 없으면 기존 규칙대로 추린 목록의 첫 항목을 고른다", () => {
    expect(pickModel(models("babbage-002", "gpt-5", "gpt-5-mini"), "", "gpt-5.6-sol")).toBe("gpt-5");
  });
});
