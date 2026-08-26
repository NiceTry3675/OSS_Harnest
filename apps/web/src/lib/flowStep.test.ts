import { describe, expect, it } from "vitest";
import { getTemplate } from "../templates";
import {
  buildFlowSteps,
  isApprovedForDigest,
  resolveFlow,
  resolveFlowIndex,
  type FlowApprovalState,
  type FlowSource,
} from "./flowStep";

const unapproved: FlowApprovalState = {
  definitionDigest: "current",
  approvedDigest: null,
  approvedAt: null,
};

function template(id: string): FlowSource {
  const found = getTemplate(id);
  if (found === null) throw new Error(`테스트 템플릿을 찾을 수 없습니다: ${id}`);
  return found;
}

describe("buildFlowSteps", () => {
  it("인수인계 템플릿의 정확한 8단계를 선언 순서대로 만든다", () => {
    const entry = template("handover");
    expect(buildFlowSteps(entry.questions, entry.flow).map((step) => step.label)).toEqual([
      "업무 소개",
      "질문과 답",
      "분량·간결성",
      "채점 모델",
      "사전 점검·승인",
      "기준 확정",
      "실행",
      "결과",
    ]);
  });

  it("시간표 템플릿의 정확한 7단계를 선언 순서대로 만든다", () => {
    const entry = template("timetable");
    expect(buildFlowSteps(entry.questions, entry.flow).map((step) => step.label)).toEqual([
      "근무자",
      "기간",
      "근무 규칙",
      "평가 구성 승인",
      "기준 확정",
      "실행",
      "결과",
    ]);
  });

  it("shortLabel이 없으면 질문 label을 사용한다", () => {
    expect(
      buildFlowSteps(
        [{ id: "plain", label: "원래 질문" }],
        {
          approval: { pending: "승인", approved: "동결" },
          run: "실행",
          result: "결과",
        },
      )[0]?.label,
    ).toBe("원래 질문");
  });
});

describe("semantic flow cursor", () => {
  it("숫자 위치가 아니라 questionId로 현재 질문을 찾는다", () => {
    const handover = template("handover");
    const timetable = template("timetable");

    expect(resolveFlowIndex({ kind: "question", questionId: "cases" }, handover.questions, false))
      .toBe(1);
    expect(resolveFlowIndex({ kind: "question", questionId: "period" }, timetable.questions, false))
      .toBe(1);
    expect(resolveFlowIndex({ kind: "question", questionId: "missing" }, handover.questions, false))
      .toBe(-1);
  });

  it("흐름 밖과 알 수 없는 질문은 표시하지 않는다", () => {
    const entry = template("handover");
    expect(resolveFlow(entry, { kind: "outside" }, unapproved)).toBeNull();
    expect(
      resolveFlow(entry, { kind: "question", questionId: "missing" }, unapproved),
    ).toBeNull();
  });
});

describe("digest-bound approval step", () => {
  const entry = template("handover");

  it("승인이 없거나 다이제스트가 다르면 승인 전 칸에 머문다", () => {
    expect(resolveFlow(entry, { kind: "approval" }, unapproved)?.current.label).toBe("사전 점검·승인");
    expect(
      resolveFlow(entry, { kind: "approval" }, {
        definitionDigest: "current",
        approvedDigest: "stale",
        approvedAt: "2026-08-25T00:00:00.000Z",
      })?.current.label,
    ).toBe("사전 점검·승인");
    expect(
      isApprovedForDigest({
        definitionDigest: "current",
        approvedDigest: "current",
        approvedAt: null,
      }),
    ).toBe(false);
  });

  it("승인 시각과 현재 다이제스트가 모두 일치할 때만 잠금 칸으로 간다", () => {
    const approval: FlowApprovalState = {
      definitionDigest: "current",
      approvedDigest: "current",
      approvedAt: "2026-08-25T00:00:00.000Z",
    };
    const resolved = resolveFlow(entry, { kind: "approval" }, approval);
    expect(resolved?.approvedForCurrentDigest).toBe(true);
    expect(resolved?.index).toBe(5);
    expect(resolved?.current.label).toBe("기준 확정");
  });

  it("실행과 결과는 승인 전·후 두 칸 다음의 고정 의미 위치를 가리킨다", () => {
    expect(resolveFlow(entry, { kind: "run" }, unapproved)?.index).toBe(6);
    expect(resolveFlow(entry, { kind: "result" }, unapproved)?.index).toBe(7);
  });
});
