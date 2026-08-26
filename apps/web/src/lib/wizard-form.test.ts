/** 위저드 폼 순수 로직 테스트 — 핵심 불변식: 미확인 AI 초안은 answers에 절대 실리지 않는다. */

import { describe, expect, it } from "vitest";
import type { Question } from "@harnest/contracts";
import { toAnswers, validate } from "./wizard-form";

const caseQ: Question = {
  id: "cases",
  role: "material",
  type: "caseList",
  label: "케이스",
  min: 2,
  max: 9,
};

const materialQ: Question = {
  id: "material",
  role: "material",
  type: "textarea",
  label: "자료",
  maxChars: 20,
};

const pair = (i: number) => ({ question: `질문 ${i}`, expectedAnswer: `답 ${i}` });

describe("validate — caseList", () => {
  it("미확인 AI 초안이 있으면 확인을 요구한다 (다른 검사보다 먼저)", () => {
    const pairs = [
      pair(1),
      { ...pair(2), provenance: "ai" as const, needsConfirm: true },
    ];
    expect(validate(caseQ, pairs)).toContain("확인 버튼");
  });

  it("확인된 쌍만으로 최소 개수를 채우면 통과한다", () => {
    const pairs = [pair(1), { ...pair(2), provenance: "ai_edited" as const }];
    expect(validate(caseQ, pairs)).toBeNull();
  });
});

describe("validate — textarea maxChars", () => {
  it("상한을 넘으면 현재 글자 수를 담아 거부하고, 상한 이내와 빈 값은 통과한다", () => {
    expect(validate(materialQ, "가".repeat(21))).toContain("최대 20자");
    expect(validate(materialQ, "가".repeat(20))).toBeNull();
    expect(validate(materialQ, "")).toBeNull();
  });
});

describe("toAnswers — caseList provenance", () => {
  it("미확인 초안은 원천 제거되고, 확인된 초안만 provenance와 함께 실린다", () => {
    const answers = toAnswers([caseQ], {
      cases: [
        pair(1),
        { ...pair(2), provenance: "ai" as const },
        { ...pair(3), provenance: "ai_edited" as const },
        { ...pair(4), provenance: "ai" as const, needsConfirm: true },
      ],
    });
    expect(answers["cases"]).toEqual([
      pair(1),
      { ...pair(2), provenance: "ai" },
      { ...pair(3), provenance: "ai_edited" },
    ]);
  });

  it('명시적 "user"는 생략된다 — 직접 입력 다이제스트 보존 규약', () => {
    const answers = toAnswers([caseQ], {
      cases: [{ ...pair(1), provenance: "user" as const }, pair(2)],
    });
    expect(answers["cases"]).toEqual([pair(1), pair(2)]);
  });

  it("needsConfirm 필드 자체는 어떤 경우에도 answers에 나타나지 않는다", () => {
    const answers = toAnswers([caseQ], {
      cases: [{ ...pair(1), provenance: "ai" as const }],
    });
    expect(JSON.stringify(answers)).not.toContain("needsConfirm");
  });
});

describe("toggle 질문", () => {
  const toggleQ: Question = {
    id: "conciseness",
    role: "criteria",
    type: "toggle",
    label: "간결성",
    defaultValue: true,
  };

  it("항상 유효하고, 명시적 false만 끔으로 변환한다", () => {
    expect(validate(toggleQ, "")).toBeNull();
    expect(validate(toggleQ, "false")).toBeNull();
    expect(toAnswers([toggleQ], { conciseness: "true" })).toEqual({ conciseness: true });
    expect(toAnswers([toggleQ], { conciseness: "false" })).toEqual({ conciseness: false });
  });

  it("손대지 않은 초안(빈 값)은 선언된 기본값을 따른다", () => {
    expect(toAnswers([toggleQ], { conciseness: "" })).toEqual({ conciseness: true });
    const offDefault: Question = { ...toggleQ, defaultValue: false };
    expect(toAnswers([offDefault], { conciseness: "" })).toEqual({ conciseness: false });
  });
});

describe("채점 모델 질문", () => {
  const judgeQ: Question = {
    id: "judgeModel",
    role: "criteria",
    type: "judgeModel",
    label: "어떤 AI가 채점할까요?",
  };

  // 모델 선택은 위저드가 따로 들고 있어 draft에 값이 없다.
  // 빈 값 검사에 걸리면 마지막 단계에서 제출 자체가 막힌다.
  it("값이 없어도 다음으로 넘어갈 수 있다", () => {
    expect(validate(judgeQ, "")).toBeNull();
  });

  it("답변 맵에 빈 값을 남기지 않는다", () => {
    const answers = toAnswers([judgeQ], { judgeModel: "" });
    expect("judgeModel" in answers).toBe(false);
  });
});
