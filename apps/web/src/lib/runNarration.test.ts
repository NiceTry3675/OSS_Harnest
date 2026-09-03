/** 콘솔 산식은 등식이어야 한다 — 우변과 좌변이 다르면 사용자는 점수를 믿지 못한다. */

import { describe, expect, it } from "vitest";
import type { EvaluationPack } from "@harnest/contracts";
import { scoreEquation, scoreLines } from "./runNarration";

const pack: EvaluationPack = {
  packVersion: "skeleton-1",
  templateId: "handover",
  criteria: [
    { id: "case_answerability", kind: "case_answering", scorer: "case_answering", label: "답변 가능성", weight: 0.8, params: {} },
    { id: "conciseness", kind: "deterministic", scorer: "conciseness", label: "간결성", weight: 0.2, params: {} },
  ],
  gates: [],
  judgeProcedure: {
    kind: "case_answering",
    judge: { provider: "mock", model: "모의 모델" },
    pairwiseNotice: "-",
  },
  holdoutPolicy: { mode: "none", note: "-" },
  definitionDigest: "a".repeat(64),
};

describe("scoreEquation", () => {
  it("분량 초과 감점(adjustments)을 등식의 항으로 잇는다 — 키는 번역하지 않는다", () => {
    const equation = scoreEquation(
      {
        total: 54,
        violations: ["권장 분량 초과 — 10.0점 감점"],
        parts: { case_answerability: 80, conciseness: 0 },
        adjustments: { length_overflow: -10 },
        gateRejected: false,
      },
      pack,
    );
    expect(equation).toBe("합계 54.0점 = 80.0×0.80 + 0.0×0.20 − 10.0(조정)");
    expect(equation).not.toContain("length_overflow");
  });

  it("기준이 하나뿐이어도 조정이 있으면 등식을 보인다", () => {
    const single: EvaluationPack = { ...pack, criteria: [{ ...pack.criteria[0], weight: 1 }] };
    expect(
      scoreEquation(
        { total: 90, violations: [], parts: { case_answerability: 100 }, adjustments: { length_overflow: -10 }, gateRejected: false },
        single,
      ),
    ).toBe("합계 90.0점 = 100.0×1.00 − 10.0(조정)");
    expect(
      scoreEquation({ total: 100, violations: [], parts: { case_answerability: 100 }, gateRejected: false }, single),
    ).toBe("합계 100.0점");
  });

  it("0인 조정은 생략하고 양수 조정은 더한다", () => {
    expect(
      scoreEquation(
        { total: 66, violations: [], parts: { case_answerability: 80, conciseness: 10 }, adjustments: { bonus: 2, none: 0 }, gateRejected: false },
        pack,
      ),
    ).toBe("합계 66.0점 = 80.0×0.80 + 10.0×0.20 + 2.0(조정)");
  });

  it("채점 줄에는 기준 이름·가중치·합계 산식이 함께 실린다", () => {
    const lines = scoreLines(
      { total: 64, violations: [], parts: { case_answerability: 80, conciseness: 0 }, gateRejected: false },
      pack,
    );
    expect(lines[0]).toBe("기준「답변 가능성」 가중치 80% → 80.0점");
    expect(lines).toContain("합계 64.0점 = 80.0×0.80 + 0.0×0.20");
    expect(lines).toContain("기준에 비추어 지적할 것이 없습니다.");
  });
});
