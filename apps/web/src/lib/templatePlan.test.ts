/** 목표에서 받아온 구성 — 모델 출력이므로 그대로 믿지 않고 걸러 쓴다. */

import { describe, expect, it } from "vitest";
import { parseTemplatePlan, planTemplate, TemplatePlanError } from "./templatePlan";

const IDS = ["handover", "timetable"];
const CHOICES = [
  { id: "handover", name: "인수인계 문서", description: "질문에 답할 수 있는 문서" },
  { id: "timetable", name: "근무표 짜기", description: "규칙을 지키는 배정표" },
];
const OK = {
  templateId: "handover",
  name: "인수인계 문서 템플릿",
  artifact: "인수인계 문서",
  lengthCap: 8000,
  useConciseness: true,
  questionFocus: ["마감 절차", "권한 신청"],
  steps: ["업무 소개", "질문과 답", "실행", "결과"],
};

describe("parseTemplatePlan", () => {
  it("코드 펜스로 감싸 와도 읽는다", () => {
    const plan = parseTemplatePlan("```json\n" + JSON.stringify(OK) + "\n```", IDS);
    expect(plan.templateId).toBe("handover");
    expect(plan.lengthCap).toBe(8000);
  });

  it("없는 절차를 고르면 거절한다", () => {
    const raw = JSON.stringify({ ...OK, templateId: "novel" });
    expect(() => parseTemplatePlan(raw, IDS)).toThrow(TemplatePlanError);
  });

  // 범위를 벗어난 값은 거절 대신 잘라 쓴다 — 사용자가 다음 화면에서 고칠 수 있다
  it("분량 상한이 범위를 벗어나면 잘라서 쓴다", () => {
    expect(parseTemplatePlan(JSON.stringify({ ...OK, lengthCap: 99999 }), IDS).lengthCap).toBe(20000);
    expect(parseTemplatePlan(JSON.stringify({ ...OK, lengthCap: 10 }), IDS).lengthCap).toBe(500);
  });

  it("단계가 모자라면 거절한다", () => {
    const raw = JSON.stringify({ ...OK, steps: ["하나"] });
    expect(() => parseTemplatePlan(raw, IDS)).toThrow(TemplatePlanError);
  });

  it("JSON이 아니면 거절한다", () => {
    expect(() => parseTemplatePlan("구성을 짰습니다", IDS)).toThrow(TemplatePlanError);
  });
});

describe("planTemplate", () => {
  const llmOf = (...replies: string[]) => {
    const seen: string[] = [];
    let at = 0;
    return {
      seen,
      client: {
        providerId: "mock" as const,
        model: "테스트",
        async complete(prompt: string) {
          seen.push(prompt);
          return replies[Math.min(at++, replies.length - 1)];
        },
      },
    };
  };

  it("고를 수 있는 절차를 프롬프트에 싣는다", async () => {
    const { seen, client } = llmOf(JSON.stringify(OK));
    await planTemplate(client, "인수인계 문서를 만들고 싶습니다", CHOICES);
    expect(seen[0]).toContain("handover");
    expect(seen[0]).toContain("timetable");
    expect(seen[0]).toContain("인수인계 문서를 만들고 싶습니다");
  });

  it("형식이 어긋나면 한 번만 다시 요청한다", async () => {
    const { seen, client } = llmOf("구성 못 짬", JSON.stringify(OK));
    const plan = await planTemplate(client, "문서를 만들고 싶습니다", CHOICES);
    expect(plan.name).toBe("인수인계 문서 템플릿");
    expect(seen).toHaveLength(2);
  });

  it("목표가 너무 짧으면 호출하지 않는다", async () => {
    const { seen, client } = llmOf(JSON.stringify(OK));
    await expect(planTemplate(client, "문서", CHOICES)).rejects.toThrow(TemplatePlanError);
    expect(seen).toHaveLength(0);
  });
});
