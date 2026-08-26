/** 만든 템플릿 보관함 — 이 브라우저에만 남고, 저장소가 막혀도 앱이 멈추지 않아야 한다. */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listSavedTemplates,
  removeSavedTemplate,
  saveTemplate,
  updateSavedTemplate,
} from "./savedTemplates";

const plan = {
  templateId: "timetable",
  name: "수강 시간표 템플릿",
  artifact: "주간 시간표",
  lengthCap: 4000,
  useConciseness: true,
  questionFocus: ["학점 상한을 지켰는지"],
  stages: [{ id: "run", label: "실행" }],
};

/** 이 테스트는 노드 환경에서 돈다 — 브라우저 저장소를 메모리로 흉내 낸다 */
function fakeStorage() {
  const box = new Map<string, string>();
  return {
    getItem: (k: string) => box.get(k) ?? null,
    setItem: (k: string, v: string) => void box.set(k, v),
    removeItem: (k: string) => void box.delete(k),
    clear: () => box.clear(),
  };
}

describe("보관함", () => {
  beforeEach(() => vi.stubGlobal("localStorage", fakeStorage()));
  afterAll(() => vi.unstubAllGlobals());

  it("만든 것을 저장하고 최신이 앞에 온다", () => {
    saveTemplate(plan, "시간표 짜줘");
    saveTemplate({ ...plan, name: "두 번째" }, "다른 목표");
    expect(listSavedTemplates().map((t) => t.name)).toEqual(["두 번째", "수강 시간표 템플릿"]);
  });

  it("어떤 목표에서 만들어졌는지 함께 남긴다", () => {
    saveTemplate(plan, "곧 개강이라 시간표 짜는걸 도와줘");
    expect(listSavedTemplates()[0].goal).toBe("곧 개강이라 시간표 짜는걸 도와줘");
  });

  it("이름을 고칠 수 있다", () => {
    const made = saveTemplate(plan, "목표");
    updateSavedTemplate(made.savedId, { name: "바꾼 이름" });
    expect(listSavedTemplates()[0].name).toBe("바꾼 이름");
    // 나머지 설정은 그대로다
    expect(listSavedTemplates()[0].lengthCap).toBe(4000);
  });

  it("지울 수 있다", () => {
    const made = saveTemplate(plan, "목표");
    removeSavedTemplate(made.savedId);
    expect(listSavedTemplates()).toHaveLength(0);
  });

  it("저장소에 엉뚱한 값이 있어도 빈 목록으로 견딘다", () => {
    localStorage.setItem("harnest.savedTemplates", "{ 망가진 값");
    expect(listSavedTemplates()).toEqual([]);
  });
});
