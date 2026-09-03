/** 검사 카드 문구 — 페이지는 일반 문구만 갖고, 구현 세부는 템플릿이 등록소로 넘긴다. */

import { describe, expect, it } from "vitest";
import { getTemplate } from "../templates";
import { checkCardTexts, DEFAULT_CHECK_CARDS } from "./examinerCards";

describe("checkCardTexts", () => {
  it("덮어쓰기가 없으면 일반 문구를 쓴다", () => {
    expect(checkCardTexts()).toEqual(DEFAULT_CHECK_CARDS);
    expect(checkCardTexts({})).toEqual(DEFAULT_CHECK_CARDS);
  });

  it("검사별로 넘긴 항목만 덮고, 빈 문자열은 기본 문구로 되돌린다", () => {
    const texts = checkCardTexts({
      stability: { desc: "표본 수 기준 반 단계 이내인지" },
      hack_resistance: { name: "  ", desc: "" },
    });
    expect(texts.stability).toEqual({
      name: DEFAULT_CHECK_CARDS.stability.name,
      desc: "표본 수 기준 반 단계 이내인지",
    });
    expect(texts.hack_resistance).toEqual(DEFAULT_CHECK_CARDS.hack_resistance);
  });

  it("인수인계 항목은 배터리의 실제 산식·프로브를 설명하는 문구를 등록소로 공급한다", () => {
    const handover = getTemplate("handover");
    expect(handover?.examiner?.checkCards).toBeDefined();
    const texts = checkCardTexts(handover!.examiner!.checkCards);
    // 구현 세부(반 단계 임계·지시 주입 프로브)는 템플릿 문구에만 있고 일반 문구에는 없다
    expect(texts.stability.desc).toContain("반 단계");
    expect(texts.hack_resistance.desc).toContain("지시문");
    expect(DEFAULT_CHECK_CARDS.stability.desc).not.toContain("반 단계");
    expect(DEFAULT_CHECK_CARDS.hack_resistance.desc).not.toContain("지시문");
  });

  it("결정적 전용 템플릿은 검사관이 없으므로 카드 문구도 없다", () => {
    expect(getTemplate("timetable")?.examiner).toBeUndefined();
  });
});
