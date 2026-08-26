/** 목표에서 받아온 구성 — 모델 출력이므로 그대로 믿지 않고 걸러 쓴다. */

import { describe, expect, it } from "vitest";
import { parseTemplatePlan, planTemplate, TemplatePlanError, type PlanStage } from "./templatePlan";

/** 실제 템플릿과 같은 모양 — 칸 목록은 템플릿이 소유한다 */
const STAGES: PlanStage[] = [
  {
    id: "question:material",
    name: "업무 소개",
    purpose: "결과물을 만들 때 근거로 삼을 자료를 받는 칸.",
    input: "textarea",
  },
  {
    id: "question:cases",
    name: "실무 문답",
    purpose: "결과물이 제대로 됐는지 확인할 질문과 답을 받는 칸.",
    input: "caseList",
  },
  { id: "approval:pending", name: "사전 점검·승인", purpose: "기준을 검토하는 칸.", input: null },
  { id: "run", name: "개선 실행", purpose: "반복해서 고쳐 올리는 칸.", input: null },
  { id: "result", name: "최종 결과지", purpose: "결과를 보는 칸.", input: null },
];
const CHOICES = [
  { id: "handover", description: "글로 된 문서를 만들고 질문에 답해보게 해서 잰다", stages: STAGES },
  { id: "timetable", description: "규칙을 지키는 배정표를 만들고 규칙 위반으로 잰다", stages: STAGES },
];
const IDS = CHOICES;
const OK = {
  templateId: "handover",
  name: "인수인계 문서 템플릿",
  artifact: "인수인계 문서",
  lengthCap: 8000,
  useConciseness: true,
  questionFocus: ["마감 절차", "권한 신청"],
  stages: [
    { id: "question:material", label: "과목 수집", title: "어떤 수업을 듣고 싶으세요?", help: "후보를 적어주세요." },
    { id: "question:cases", label: "확인 질문", title: "무엇을 확인하고 싶으세요?" },
    { id: "approval:pending", label: "기준 점검" },
    { id: "run", label: "시간표 생성" },
    { id: "result", label: "최적 시간표" },
  ],
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

  // 절차의 골격은 템플릿이 소유한다 — 모델이 칸을 빼도 빠지지 않는다
  it("모델이 칸을 빼먹어도 템플릿이 선언한 칸을 모두 돌려준다", () => {
    const plan = parseTemplatePlan(JSON.stringify({ ...OK, stages: [OK.stages[0]] }), IDS);
    expect(plan.stages.map((s) => s.id)).toEqual(STAGES.map((s) => s.id));
    // 이름을 안 준 칸은 템플릿 원래 이름으로 남는다
    expect(plan.stages[1].label).toBe("실무 문답");
    expect(plan.stages[0].label).toBe("과목 수집");
  });

  it("모델이 없는 칸을 지어내도 끼워 넣지 않는다", () => {
    const raw = JSON.stringify({
      ...OK,
      stages: [...OK.stages, { id: "question:novel", label: "지어낸 칸" }],
    });
    expect(parseTemplatePlan(raw, IDS).stages).toHaveLength(STAGES.length);
  });

  // 입력 칸이 아닌 곳에 물음을 붙이면 화면에 걸 자리가 없다
  it("입력 칸이 아니면 물음과 안내를 버린다", () => {
    const raw = JSON.stringify({
      ...OK,
      stages: OK.stages.map((s) =>
        s.id === "run" ? { ...s, title: "여기서 뭘 넣나요?", help: "안내" } : s,
      ),
    });
    const run = parseTemplatePlan(raw, IDS).stages.find((s) => s.id === "run");
    expect(run?.title).toBeUndefined();
    expect(run?.help).toBeUndefined();
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

  // 지금 쓰는 이름을 보여주면 모델이 그대로 베낀다 — 플레이리스트 목표에도 "업무 소개"가 나온다
  it("절차가 지금 쓰는 이름을 프롬프트에 싣지 않는다", async () => {
    const { seen, client } = llmOf(JSON.stringify(OK));
    await planTemplate(client, "유튜브에서 취향에 맞는 플레이리스트를 만들고 싶습니다", CHOICES);
    // 절차를 설명하는 구간만 본다 — 뒤쪽 안내에는 "이렇게 쓰지 말라"는 예시로 일부러 들어간다
    const listed = seen[0].slice(
      seen[0].indexOf("## 고를 수 있는 평가 절차"),
      seen[0].indexOf("## 무엇보다 중요한 것"),
    );
    expect(listed).toContain("question:material");
    for (const stage of STAGES) {
      expect(listed).not.toContain(stage.name);
    }
  });

  // 절차 이름을 넘기면 모델이 그 어휘로 끌려간다 — "음악 추천 인수인계 템플릿"이 나온다
  it("절차 이름을 넘길 자리 자체가 없다", async () => {
    const { seen, client } = llmOf(JSON.stringify(OK));
    await planTemplate(client, "플레이리스트를 만들고 싶습니다", CHOICES);
    const listed = seen[0].slice(
      seen[0].indexOf("## 고를 수 있는 평가 절차"),
      seen[0].indexOf("## 무엇보다 중요한 것"),
    );
    // 고를 때 필요한 것은 id와 "무엇을 어떻게 재는지"뿐이다
    expect(listed).not.toContain("인수인계");
    expect(listed).toContain('id="handover"');
  });

  it("칸이 하는 일과 받는 것은 싣는다", async () => {
    const { seen, client } = llmOf(JSON.stringify(OK));
    await planTemplate(client, "플레이리스트를 만들고 싶습니다", CHOICES);
    expect(seen[0]).toContain("question:material");
    expect(seen[0]).toContain("근거로 삼을 자료를 받는 칸");
    expect(seen[0]).toContain("긴 자유 서술 + 파일 첨부");
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
