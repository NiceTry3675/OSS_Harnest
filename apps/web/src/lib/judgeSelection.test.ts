import { describe, expect, it } from "vitest";
import type { EvaluationPack } from "@harnest/contracts";
import { judgeSelectionOf } from "./judgeSelection";

const pack = (judgeProcedure: EvaluationPack["judgeProcedure"]): EvaluationPack => ({
  packVersion: "skeleton-1",
  templateId: "handover",
  criteria: [],
  gates: [],
  judgeProcedure,
  holdoutPolicy: { mode: "none", note: "-" },
  definitionDigest: "a".repeat(64),
});

describe("judgeSelectionOf", () => {
  it("저장된 compiled에서 공급자·모델을 복원한다", () => {
    expect(
      judgeSelectionOf(
        pack({
          kind: "case_answering",
          judge: { provider: "gemini", model: "gemini-3.8-pro" },
          pairwiseNotice: "-",
        }),
      ),
    ).toEqual({ choice: "gemini", model: "gemini-3.8-pro" });
  });

  it("모의 모델도 복원하되 모델 이름은 비운다", () => {
    expect(
      judgeSelectionOf(
        pack({ kind: "case_answering", judge: { provider: "mock", model: "모의 모델" }, pairwiseNotice: "-" }),
      ),
    ).toEqual({ choice: "mock", model: "" });
  });

  it("저장된 것이 없거나 결정적 전용이면 기본값(OpenAI, 빈 모델)이다", () => {
    expect(judgeSelectionOf(null)).toEqual({ choice: "openai", model: "" });
    expect(
      judgeSelectionOf(
        pack({ kind: "deterministic_only", exemptions: { examinerReport: "-", pairwise: "-" } }),
      ),
    ).toEqual({ choice: "openai", model: "" });
  });
});
