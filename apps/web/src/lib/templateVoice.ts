/** 0단계에서 만든 템플릿의 어휘를 실제 화면에 씌운다.
 *
 *  바꾸는 것은 **부르는 이름**뿐이다. 단계의 개수·순서·id, 각 칸이 받아내는 값,
 *  검증과 컴파일은 템플릿이 그대로 소유한다. 3단계가 분량을 받는 칸이면
 *  "분량·간결성"이라 부르든 "학점 상한 설정"이라 부르든 분량을 받는다.
 *
 *  그래서 이름을 갈아끼워도 화면과 실제가 어긋나지 않는다 — 절차를 흉내 내는 것이
 *  아니라, 같은 절차를 사용자의 언어로 부르는 것이다. */

import type { Question } from "@harnest/contracts";
import type { TemplateFlow } from "./flowStep";
import type { StageVoice } from "./templatePlan";

export interface TemplateVoice {
  name: string;
  goal: string;
  stages: StageVoice[];
}

/** 0단계가 답변 맵에 얹는 어휘·확인 방향 키. compile은 이 키들을 읽지 않는다(다이제스트 무관).
 *  위저드 제출은 질문 id만 다시 쓰므로, 이 네 키만 골라 옮겨야 승인·실행·결과 화면까지
 *  같은 이름으로 이어진다. 답변 전체를 옮기면 지난 제출의 옛 질문 키가 되살아난다. */
export const VOICE_KEYS = ["builtName", "builtGoal", "builtStages", "questionFocus"] as const;

/** 답변 맵에서 어휘 키만 골라낸다 — 없는 키는 만들지 않는다. */
export function pickVoice(answers: Record<string, unknown>): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of VOICE_KEYS) {
    if (answers[key] !== undefined) picked[key] = answers[key];
  }
  return picked;
}

function stageList(value: unknown): StageVoice[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is StageVoice => {
    if (typeof item !== "object" || item === null) return false;
    const record = item as Record<string, unknown>;
    return typeof record.id === "string" && typeof record.label === "string";
  });
}

/** 위저드 답안에 실려 온 어휘를 읽는다. 없으면 템플릿 원래 문구로 간다. */
export function readVoice(answers: Record<string, unknown>): TemplateVoice | null {
  const name = typeof answers.builtName === "string" ? answers.builtName : null;
  if (name === null) return null;
  const stages = stageList(answers.builtStages);
  return {
    name,
    goal: typeof answers.builtGoal === "string" ? answers.builtGoal : "",
    stages,
  };
}

function find(stages: StageVoice[], id: string): StageVoice | undefined {
  return stages.find((stage) => stage.id === id);
}

/** 질문의 표시 문구만 바꾼다 — id·type·검증 관련 필드는 손대지 않는다. */
export function voiceQuestions(
  questions: readonly Question[],
  voice: TemplateVoice | null,
): Question[] {
  if (voice === null || voice.stages.length === 0) return [...questions];
  return questions.map((question) => {
    // 앞 질문에 붙은 칸은 자기 단계를 갖지 않으므로 이름도 갖지 않는다
    if (question.sameStep === true) return question;
    const stage = find(voice.stages, `question:${question.id}`);
    if (stage === undefined) return question;
    return {
      ...question,
      label: stage.title ?? question.label,
      shortLabel: stage.label,
      ...(stage.help !== undefined ? { help: stage.help } : {}),
      ...(stage.next !== undefined ? { nextLabel: stage.next } : {}),
      ...(stage.placeholder !== undefined ? { placeholder: stage.placeholder } : {}),
    };
  });
}

/** 질문 뒤 공통 칸(승인·실행·결과)의 이름을 바꾼다. */
export function voiceFlow(flow: TemplateFlow, voice: TemplateVoice | null): TemplateFlow {
  if (voice === null || voice.stages.length === 0) return flow;
  const pending = find(voice.stages, "approval:pending");
  const approved = find(voice.stages, "approval:approved");
  const run = find(voice.stages, "run");
  const result = find(voice.stages, "result");
  return {
    approval: {
      pending: pending?.label ?? flow.approval.pending,
      approved: approved?.label ?? flow.approval.approved,
    },
    run: run?.label ?? flow.run,
    result: result?.label ?? flow.result,
  };
}
