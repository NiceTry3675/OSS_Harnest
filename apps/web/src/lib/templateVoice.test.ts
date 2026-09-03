/** 0단계 어휘는 이름만 바꾼다 — 칸이 받아내는 값과 검증은 템플릿의 것이다. */

import { describe, expect, it } from "vitest";
import type { Question } from "@harnest/contracts";
import { pickVoice, readVoice, VOICE_KEYS, voiceFlow, voiceQuestions } from "./templateVoice";
import type { TemplateFlow } from "./flowStep";

const QUESTIONS: Question[] = [
  {
    id: "material",
    role: "material",
    type: "textarea",
    label: "어떤 업무를 넘기시나요?",
    shortLabel: "업무 소개",
    help: "지금 하고 있는 일을 적어주세요.",
    nextLabel: "질문 넣으러 가기",
    placeholder: "예: 저는 사내 배포 파이프라인을 관리합니다.",
    maxChars: 30_000,
  },
  { id: "cases", role: "material", type: "caseList", label: "질문과 답", min: 4, max: 20 },
  {
    id: "conciseness",
    role: "criteria",
    type: "toggle",
    label: "길이를 점수에도 반영할까요?",
    sameStep: true,
    defaultValue: true,
  },
];

const FLOW: TemplateFlow = {
  approval: { pending: "사전 점검·승인", approved: "기준 확정" },
  run: "실행",
  result: "결과",
};

const ANSWERS = {
  builtName: "대학 시간표 템플릿",
  builtGoal: "효율적인 시간표를 짜고 싶습니다",
  builtStages: [
    {
      id: "question:material",
      label: "과목 수집",
      title: "어떤 수업을 듣고 싶으세요?",
      help: "후보 과목을 적어주세요.",
      next: "확인할 것 정하러 가기",
      placeholder: "예: 월/수 9시 알고리즘, 화/목 11시 운영체제…",
    },
    { id: "approval:pending", label: "기준 점검" },
    { id: "result", label: "최적 시간표" },
  ],
};

describe("readVoice", () => {
  it("만든 템플릿으로 들어온 게 아니면 없다", () => {
    expect(readVoice({ lengthCap: 4000 })).toBeNull();
  });

  it("이름만 있고 단계가 없어도 읽는다", () => {
    expect(readVoice({ builtName: "무언가" })?.stages).toEqual([]);
  });

  it("모양이 어긋난 단계는 버린다", () => {
    const voice = readVoice({ builtName: "무언가", builtStages: [{ id: "run" }, 3, null] });
    expect(voice?.stages).toEqual([]);
  });
});

describe("voiceQuestions", () => {
  const voiced = voiceQuestions(QUESTIONS, readVoice(ANSWERS));

  it("이름과 물음을 갈아끼운다", () => {
    expect(voiced[0].shortLabel).toBe("과목 수집");
    expect(voiced[0].label).toBe("어떤 수업을 듣고 싶으세요?");
    expect(voiced[0].help).toBe("후보 과목을 적어주세요.");
  });

  // 단계 이름만 바꾸고 안쪽이 남으면 화면이 두 말투로 갈라진다
  it("버튼 글자와 입력 예시까지 갈아끼운다", () => {
    expect(voiced[0].nextLabel).toBe("확인할 것 정하러 가기");
    expect(voiced[0].placeholder).toBe("예: 월/수 9시 알고리즘, 화/목 11시 운영체제…");
  });

  it("주지 않은 안쪽 문구는 원래 것을 지킨다", () => {
    const only = voiceQuestions(QUESTIONS, readVoice({
      builtName: "무언가",
      builtStages: [{ id: "question:material", label: "과목 수집" }],
    }));
    expect(only[0].nextLabel).toBe("질문 넣으러 가기");
    expect(only[0].placeholder).toBe("예: 저는 사내 배포 파이프라인을 관리합니다.");
  });

  // 이름이 바뀌어도 받아내는 값과 검증은 그대로여야 화면과 실제가 어긋나지 않는다
  it("id·type·검증 값은 손대지 않는다", () => {
    expect(voiced.map((q) => q.id)).toEqual(QUESTIONS.map((q) => q.id));
    expect(voiced.map((q) => q.type)).toEqual(QUESTIONS.map((q) => q.type));
    expect(voiced[0]).toMatchObject({ maxChars: 30_000 });
    expect(voiced[1]).toMatchObject({ min: 4, max: 20 });
  });

  it("이름을 주지 않은 칸은 원래 문구로 둔다", () => {
    expect(voiced[1].label).toBe("질문과 답");
  });

  // 앞 질문에 붙은 칸은 자기 단계가 없으므로 이름을 가질 수 없다
  it("같은 화면에 붙은 질문은 건드리지 않는다", () => {
    expect(voiced[2]).toBe(QUESTIONS[2]);
  });

  it("어휘가 없으면 원래 질문 그대로다", () => {
    expect(voiceQuestions(QUESTIONS, null)).toEqual(QUESTIONS);
  });
});

describe("voiceFlow", () => {
  it("준 칸만 바꾸고 나머지는 템플릿 문구를 지킨다", () => {
    const flow = voiceFlow(FLOW, readVoice(ANSWERS));
    expect(flow.approval.pending).toBe("기준 점검");
    expect(flow.approval.approved).toBe("기준 확정");
    expect(flow.run).toBe("실행");
    expect(flow.result).toBe("최적 시간표");
  });

  it("어휘가 없으면 원래 흐름 그대로다", () => {
    expect(voiceFlow(FLOW, null)).toBe(FLOW);
  });
});

describe("pickVoice", () => {
  // 제출 시 answers가 질문 id만으로 교체되면 승인 화면부터 단계 이름이 기본 문구로 돌아간다
  it("제출 답변에 합쳐도 어휘가 살아남는다", () => {
    const submitted: Record<string, unknown> = { material: "자료", cases: [], lengthCap: 4000, conciseness: true };
    const merged = { ...pickVoice({ ...ANSWERS, questionFocus: ["마감"], material: "옛 자료" }), ...submitted };
    expect(readVoice(merged)?.name).toBe("대학 시간표 템플릿");
    expect(merged.questionFocus).toEqual(["마감"]);
    expect(merged.material).toBe("자료");
  });

  it("어휘 키 밖의 옛 질문 키는 옮기지 않는다", () => {
    const picked = pickVoice({ builtName: "무언가", material: "옛 자료", staff: "가, 나" });
    expect(Object.keys(picked)).toEqual(["builtName"]);
    expect(VOICE_KEYS).not.toContain("material");
  });

  it("어휘가 없으면 빈 객체다", () => {
    expect(pickVoice({ lengthCap: 4000 })).toEqual({});
  });
});
