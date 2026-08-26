/** 목표 한 문장에서 평가 템플릿 구성을 받아온다.
 *
 *  모델이 정하는 것은 "무엇을 만들지"와 "어떻게 잴지의 설정값"이다 —
 *  템플릿 종류, 분량 상한, 길이를 점수에 반영할지, 어떤 질문을 뽑아야 할지.
 *  재는 방식(채점기·관문·분할 비율) 자체는 템플릿이 소유하며 모델이 바꾸지 못한다.
 *
 *  받아온 구성은 그대로 실행되지 않는다. 위저드의 기본값으로 들어가 사용자가
 *  고치고, 승인 화면에서 사람이 확인한 뒤에야 잠긴다. */

import type { LlmClient } from "@harnest/template-handover";

export interface TemplatePlan {
  /** 실제로 진행할 템플릿의 id */
  templateId: string;
  /** 만들어진 템플릿의 이름 */
  name: string;
  /** 무엇을 만드는가 */
  artifact: string;
  /** 분량 상한(자) */
  lengthCap: number;
  /** 길이를 점수에 반영할지 */
  useConciseness: boolean;
  /** 이 목표를 재려면 어떤 질문을 뽑아야 하는지 */
  questionFocus: string[];
  /** 진행 단계 이름 */
  steps: string[];
}

export interface PlanTemplateChoice {
  id: string;
  name: string;
  description: string;
}

const LENGTH_MIN = 500;
const LENGTH_MAX = 20_000;

export class TemplatePlanError extends Error {}

function planPrompt(goal: string, choices: PlanTemplateChoice[]): string {
  const list = choices
    .map((choice) => `- ${choice.id}: ${choice.name} — ${choice.description}`)
    .join("\n");
  return `사용자가 만들고 싶은 것을 한 문장으로 말했습니다. 이 목표를 어떻게 평가할지 구성을 짜세요.

## 목표
${goal}

## 고를 수 있는 평가 절차
${list}

목표에 가장 가까운 절차를 하나 고르고, 나머지 설정을 정하세요.

- name: 만들어진 템플릿의 이름. "OO 템플릿" 꼴로 짧게.
- artifact: 사용자가 손에 쥐게 될 결과물 이름. 한 단어에서 짧은 구.
- lengthCap: 결과물의 분량 상한(자). ${LENGTH_MIN}~${LENGTH_MAX} 사이 정수.
  짧게 훑는 안내문이면 작게, 절차가 많은 문서면 크게 잡으세요.
- useConciseness: 길이를 점수에 반영할지. 같은 내용이면 짧을수록 좋은 결과물이면 true.
- questionFocus: 이 목표가 잘 이뤄졌는지 확인하려면 어떤 질문을 던져야 하는지 3~5개.
  질문 자체가 아니라 "무엇을 묻는 질문이어야 하는지"를 적으세요.
- steps: 사용자가 밟을 진행 단계 이름 5~8개. 마지막은 결과로 끝나게.

설명·코드 펜스 없이 JSON 객체 하나만 출력하세요:
{"templateId":"<id>","name":"<이름>","artifact":"<결과물>","lengthCap":<정수>,"useConciseness":<true|false>,"questionFocus":["...","..."],"steps":["...","..."]}`;
}

function withoutFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```[a-zA-Z]*\s*/, "").replace(/```\s*$/, "").trim();
}

function textList(value: unknown, field: string, min: number, max: number): string[] {
  if (!Array.isArray(value)) throw new TemplatePlanError(`${field}는 배열이어야 합니다.`);
  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= 120);
  if (items.length < min) throw new TemplatePlanError(`${field}는 ${min}개 이상이어야 합니다.`);
  return items.slice(0, max);
}

export function parseTemplatePlan(raw: string, allowedIds: readonly string[]): TemplatePlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(withoutFence(raw));
  } catch {
    throw new TemplatePlanError("구성 출력이 유효한 JSON이 아닙니다.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TemplatePlanError("구성 출력은 JSON 객체여야 합니다.");
  }
  const value = parsed as Record<string, unknown>;

  const templateId = typeof value.templateId === "string" ? value.templateId : "";
  if (!allowedIds.includes(templateId)) {
    throw new TemplatePlanError("고를 수 있는 평가 절차가 아닙니다.");
  }
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const artifact = typeof value.artifact === "string" ? value.artifact.trim() : "";
  if (name === "" || artifact === "") {
    throw new TemplatePlanError("이름과 결과물은 비어 있을 수 없습니다.");
  }
  const rawCap = Number(value.lengthCap);
  if (!Number.isFinite(rawCap)) throw new TemplatePlanError("분량 상한이 숫자가 아닙니다.");
  // 범위를 벗어난 값은 거절 대신 잘라 쓴다 — 사용자가 다음 화면에서 고칠 수 있다
  const lengthCap = Math.min(LENGTH_MAX, Math.max(LENGTH_MIN, Math.round(rawCap)));

  return {
    templateId,
    name,
    artifact,
    lengthCap,
    useConciseness: value.useConciseness !== false,
    questionFocus: textList(value.questionFocus, "questionFocus", 1, 5),
    steps: textList(value.steps, "steps", 3, 8),
  };
}

/** 목표를 주면 구성을 한 번 받아온다. 형식이 어긋나면 한 번만 다시 요청한다. */
export async function planTemplate(
  llm: LlmClient,
  goal: string,
  choices: PlanTemplateChoice[],
): Promise<TemplatePlan> {
  const trimmed = goal.trim();
  if (trimmed.length < 5) {
    throw new TemplatePlanError("목표를 한 문장으로 적어 주세요.");
  }
  const ids = choices.map((choice) => choice.id);
  const prompt = planPrompt(trimmed, choices);
  const first = await llm.complete(prompt, { temperature: 0.3, maxOutputTokens: 1024 });
  try {
    return parseTemplatePlan(first, ids);
  } catch (error) {
    if (!(error instanceof TemplatePlanError)) throw error;
  }
  const retried = await llm.complete(
    `${prompt}\n\n이전 출력은 사용할 수 없었습니다:\n${first}\n\n위 형식의 JSON 객체만 다시 출력하세요.`,
    { temperature: 0, maxOutputTokens: 1024 },
  );
  return parseTemplatePlan(retried, ids);
}
