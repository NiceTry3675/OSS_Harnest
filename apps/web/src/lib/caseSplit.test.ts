/** 질문 입력 화면의 용도 배지는 템플릿 산식을 베끼지 않고 compile 결과(holdoutPolicy)만 따르며,
 *  id를 입력 순서로 되돌리는 규약은 등록소가 넘긴 caseIdAt(템플릿 소유)만 쓴다. */

import { describe, expect, it } from "vitest";
import type { EvaluationPack } from "@harnest/contracts";
import { caseIdAt } from "@harnest/template-handover";
import type { CasePair } from "../components/WizardCaseList";
import { caseUses, isSubmittablePair } from "./caseSplit";

const pair = (n: number, extra: Partial<CasePair> = {}): CasePair => ({
  question: `질문 ${n}`,
  expectedAnswer: `답 ${n}`,
  ...extra,
});

const split = (holdout: string[], guard: string[]): EvaluationPack["holdoutPolicy"] => ({
  mode: "seeded_split",
  note: "-",
  holdoutCaseIds: holdout,
  guardCaseIds: guard,
  guardTolerance: 4.2,
});

describe("caseUses", () => {
  it("실제 분할(시드 셔플)이 고른 질문에 용도를 붙인다 — 목록 뒤쪽이 아니다", () => {
    const pairs = [1, 2, 3, 4, 5].map((n) => pair(n));
    expect(caseUses(pairs, split(["case-2"], ["case-5", "case-1"]), caseIdAt)).toEqual([
      "guard",
      "holdout",
      "visible",
      "visible",
      "guard",
    ]);
  });

  it("미확인 초안과 반쪽 쌍은 번호를 차지하지 않는다(toAnswers 규약)", () => {
    const pairs = [
      pair(1),
      pair(2, { needsConfirm: true, provenance: "ai" }),
      pair(3, { expectedAnswer: "  " }),
      pair(4),
    ];
    expect(pairs.map(isSubmittablePair)).toEqual([true, false, false, true]);
    // 제출되는 쌍은 1번과 4번뿐 → case-1 = 1번, case-2 = 4번
    expect(caseUses(pairs, split(["case-2"], ["case-1"]), caseIdAt)).toEqual([
      "guard",
      null,
      null,
      "holdout",
    ]);
  });

  it("분할이 없는 정책·되돌릴 수 없는 id·caseIdAt이 없는 템플릿이면 표시를 포기한다", () => {
    const pairs = [pair(1), pair(2)];
    expect(caseUses(pairs, { mode: "none", note: "-" }, caseIdAt)).toBeNull();
    expect(caseUses(pairs, split(["hidden-1"], []), caseIdAt)).toBeNull();
    expect(caseUses(pairs, split(["case-3"], []), caseIdAt)).toBeNull();
    expect(caseUses(pairs, split(["case-1"], []), undefined)).toBeNull();
  });

  it("id 규약 밖(1..제출 수 밖·0번·형식 변형·같은 쌍의 이중 배정)이면 틀린 배지 대신 전체 null", () => {
    const pairs = [pair(1), pair(2), pair(3)];
    expect(caseUses(pairs, split(["case-0"], ["case-1"]), caseIdAt)).toBeNull();
    expect(caseUses(pairs, split(["case-4"], ["case-1"]), caseIdAt)).toBeNull();
    // 웹은 숫자를 해석하지 않는다 — 템플릿이 만드는 문자열과 정확히 같아야만 되돌린다
    expect(caseUses(pairs, split(["case-01"], ["case-2"]), caseIdAt)).toBeNull();
    expect(caseUses(pairs, split(["CASE-1"], ["case-2"]), caseIdAt)).toBeNull();
    expect(caseUses(pairs, split(["case-1"], ["case-1"]), caseIdAt)).toBeNull();
    expect(caseUses(pairs, split(["case-1", "case-1"], ["case-2"]), caseIdAt)).toBeNull();
  });

  it("규약은 등록소가 넘긴 함수가 정한다 — 다른 규약의 템플릿도 같은 코드로 되돌린다", () => {
    const pairs = [pair(1), pair(2), pair(3)];
    const idAt = (index: number) => `q${index}`;
    expect(caseUses(pairs, split(["q2"], ["q0"]), idAt)).toEqual(["guard", "visible", "holdout"]);
    expect(caseUses(pairs, split(["case-1"], []), idAt)).toBeNull();
  });
});
