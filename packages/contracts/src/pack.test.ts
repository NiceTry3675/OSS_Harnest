/** Evaluation Pack 정체성 테스트 — definitionDigest 범위는 SPEC §3 원칙 4의 실행 정의다. */

import { describe, expect, it } from "vitest";
import { sha256Canonical } from "./digest";
import { digestScope, type EvaluationPack } from "./pack";

const base: Omit<EvaluationPack, "definitionDigest"> = {
  packVersion: "skeleton-1",
  templateId: "handover",
  criteria: [],
  gates: [],
  judgeProcedure: {
    kind: "deterministic_only",
    exemptions: { examinerReport: "-", pairwise: "-" },
  },
  holdoutPolicy: { mode: "none", note: "-" },
};

async function digest(pack: Omit<EvaluationPack, "definitionDigest">): Promise<string> {
  return sha256Canonical(digestScope(pack));
}

describe("digestScope 정체성", () => {
  it("templateId가 다르면 나머지 판정 필드가 같아도 다이제스트가 다르다", async () => {
    expect(await digest(base)).not.toBe(await digest({ ...base, templateId: "timetable" }));
  });

  it("packVersion이 다르면 나머지 판정 필드가 같아도 다이제스트가 다르다", async () => {
    const future = {
      ...base,
      packVersion: "skeleton-2",
    } as unknown as Omit<EvaluationPack, "definitionDigest">;
    expect(await digest(base)).not.toBe(await digest(future));
  });
});
