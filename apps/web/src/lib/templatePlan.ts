/** 목표 한 문장에서 평가 템플릿 구성을 받아온다.
 *
 *  모델이 정하는 것은 "무엇을 만들지", "어떻게 잴지의 설정값", 그리고 **절차 각 단계를
 *  목표의 언어로 뭐라고 부를지**다 — 템플릿 종류, 분량 상한, 길이를 점수에 반영할지,
 *  어떤 질문을 뽑아야 할지, 각 단계의 이름과 묻는 말.
 *
 *  재는 방식(채점기·관문·분할 비율)과 **절차의 골격 자체**는 템플릿이 소유한다.
 *  모델은 단계를 더하거나 뺄 수 없고 이름만 바꾼다 — 3단계가 실제로 분량을 받는 칸이면
 *  뭐라 부르든 분량을 받는다. 어휘만 갈아끼우므로 화면과 실제가 어긋나지 않는다.
 *
 *  받아온 구성은 그대로 실행되지 않는다. 위저드의 기본값으로 들어가 사용자가
 *  고치고, 승인 화면에서 사람이 확인한 뒤에야 잠긴다. */

import type { LlmClient } from "@harnest/template-handover";

const NL = String.fromCharCode(10);

/** 절차 한 칸의 사용자 언어. id는 템플릿이 소유하고 모델이 만들지 않는다. */
export interface StageVoice {
  /** FlowStep.id와 같은 값 — `question:<질문id>` | approval:pending | approval:approved | run | result */
  id: string;
  /** 단계 표시 이름 */
  label: string;
  /** 질문 칸이면 화면 머리에 걸리는 물음 */
  title?: string;
  /** 질문 칸이면 그 아래 안내문 */
  help?: string;
  /** 질문 칸이면 다음으로 넘어가는 버튼 글자 */
  next?: string;
  /** 질문 칸이면 입력란에 흐리게 뜨는 예시 */
  placeholder?: string;
}

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
  /** 절차 각 칸의 이름과 문구 — 개수와 순서는 템플릿이 정한다 */
  stages: StageVoice[];
}

/** 템플릿이 선언한 절차 한 칸.
 *
 *  모델에게는 **이 칸이 하는 일(purpose)만** 넘긴다. 지금 쓰는 이름은 넘기지 않는다 —
 *  넘기면 모델이 그대로 베껴서, 플레이리스트를 만드는 목표에도 "업무 소개"가 나온다. */
export interface PlanStage {
  id: string;
  /** 지금 화면에 쓰이는 이름. 모델에게 보이지 않고, 모델이 이름을 안 줬을 때만 쓴다 */
  name: string;
  /** 이 칸이 하는 일 — 절차 어휘가 아니라 기능으로 적는다. 없으면 이름만 바꾸게 둔다 */
  purpose: string | null;
  /** 입력 칸이면 무엇을 받는 칸인지. 입력 칸이 아니면 null */
  input: string | null;
}

export interface PlanTemplateChoice {
  id: string;
  /** 절차가 무엇을 어떻게 재는지 — 절차 이름은 넣지 않는다 */
  description: string;
  stages: PlanStage[];
}

const LENGTH_MIN = 500;
const LENGTH_MAX = 20_000;

export class TemplatePlanError extends Error {}

const INPUT_KIND: Record<string, string> = {
  textarea: "긴 자유 서술 + 파일 첨부",
  caseList: "질문과 답 여러 쌍",
  number: "숫자 하나",
  toggle: "켜기/끄기",
  judgeModel: "AI 모델 고르기",
};

function stageLines(stages: PlanStage[]): string {
  return stages
    .map((stage, i) => {
      const kind =
        stage.input === null
          ? "사용자 입력 없음 — label만"
          : (INPUT_KIND[stage.input] ?? stage.input);
      const purpose = stage.purpose ?? "";
      return `  ${i + 1}. id="${stage.id}" [${kind}] ${purpose}`;
    })
    .join(NL);
}

function planPrompt(goal: string, choices: PlanTemplateChoice[]): string {
  const list = choices
    .map(
      (choice) =>
        [
          `- id="${choice.id}" — ${choice.description}`,
          `  이 절차가 밟는 칸(${choice.stages.length}개, 더하거나 뺄 수 없음):`,
          stageLines(choice.stages),
        ].join(NL),
    )
    .join(NL);
  return [
    "사용자가 만들고 싶은 것을 한 문장으로 말했습니다. 이 목표를 어떻게 평가할지 구성을 짜세요.",
    "",
    "## 목표",
    goal,
    "",
    "## 고를 수 있는 평가 절차",
    list,
    "",
    "목표에 가장 가까운 절차를 하나 고르고, 나머지 설정을 정하세요.",
    "",
    "## 무엇보다 중요한 것",
    "이 화면을 보는 사람은 위에 적힌 목표를 가진 사람 한 명입니다. 모든 이름과 문구는",
    "그 사람에게 그대로 말을 거는 말이어야 합니다. \"업무\", \"인수인계\", \"담당자\", \"문서\" 같은",
    "사무실 어휘를 습관적으로 쓰지 마세요 — 목표가 회사 일이 아니면 전부 틀린 말입니다.",
    "",
    "- 목표가 \"유튜브에서 취향에 맞는 음악을 골라 플레이리스트를 만들고 싶다\"라면",
    "  자료를 받는 칸은 \"어떤 음악을 좋아하세요?\"이지 \"업무 소개\"가 아닙니다.",
    "  안내는 \"자주 듣는 아티스트, 싫어하는 장르, 주로 듣는 상황을 적어주세요\"처럼",
    "  이 사람이 실제로 적을 것을 짚어야 합니다.",
    "- 목표가 \"수강 시간표를 짜고 싶다\"라면 \"어떤 과목을 듣고, 무슨 요일을 비우고 싶으세요?\"입니다.",
    "- 확인 질문을 받는 칸도 마찬가지입니다. \"실제로 받았던 질문\"이 아니라",
    "  \"이 플레이리스트가 잘 나왔는지 무엇으로 확인하시겠어요?\"처럼 목표의 말로 물으세요.",
    "",
    "- name: 만들어진 템플릿의 이름. \"OO 템플릿\" 꼴로 짧게.",
    "- artifact: 사용자가 손에 쥐게 될 결과물 이름. 한 단어에서 짧은 구.",
    `- lengthCap: 결과물의 분량 상한(자). ${LENGTH_MIN}~${LENGTH_MAX} 사이 정수.`,
    "  짧게 훑는 안내문이면 작게, 절차가 많은 문서면 크게 잡으세요.",
    "- useConciseness: 길이를 점수에 반영할지. 같은 내용이면 짧을수록 좋은 결과물이면 true.",
    "- questionFocus: 이 목표가 잘 이뤄졌는지 확인하려면 어떤 질문을 던져야 하는지 3~5개.",
    "  질문 자체가 아니라 \"무엇을 묻는 질문이어야 하는지\"를 적으세요.",
    "- stages: 고른 절차의 **모든** 칸을 위에 적힌 id 그대로, 같은 순서로 하나씩 적고",
    "  목표의 언어로 이름과 문구를 새로 쓰세요. 칸을 더하거나 빼거나 순서를 바꾸지 마세요.",
    "  각 칸이 [ ] 안에 적힌 것을 받고, 그 뒤에 적힌 일을 한다는 것만 지키면 됩니다.",
    "  - label: 상단 단계 표시에 걸릴 짧은 이름(공백 포함 12자 이내).",
    "  - title: 입력 칸이면 화면 머리에 걸릴 물음. 그 칸이 하는 일을 목표의 말로 물으세요.",
    "  - help: 입력 칸이면 그 아래 한두 문장 안내. 이 목표를 가진 사람이 무엇을 적어야 하는지",
    "    구체적인 항목으로 짚어주세요.",
    "  - next: 입력 칸이면 다음 칸으로 넘어가는 버튼 글자. 다음 칸이 무엇을 받는지 가리키게.",
    "  - placeholder: 입력 칸이면 입력란에 흐리게 뜰 예시 한 줄. 목표의 상황으로 쓰세요.",
    "  입력 칸이 아닌 칸은 label만 적으세요. label 말고는 화면에 걸 자리가 없습니다.",
    "",
    "설명·코드 펜스 없이 JSON 객체 하나만 출력하세요:",
    '{"templateId":"<id>","name":"<이름>","artifact":"<결과물>","lengthCap":<정수>,"useConciseness":<true|false>,"questionFocus":["...","..."],"stages":[{"id":"<위 id>","label":"<이름>","title":"<물음>","help":"<안내>","next":"<버튼>","placeholder":"<예시>"}]}',
  ].join(NL);
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

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > max) return undefined;
  return trimmed;
}

/** 모델이 준 이름을 템플릿이 선언한 칸에 맞춰 정렬한다.
 *  칸의 개수·순서·id는 템플릿의 것이고, 빠진 칸은 원래 이름으로 채운다. */
function alignStages(value: unknown, declared: PlanStage[]): StageVoice[] {
  const given = new Map<string, Record<string, unknown>>();
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item !== "object" || item === null) continue;
      const record = item as Record<string, unknown>;
      if (typeof record.id === "string") given.set(record.id, record);
    }
  }
  return declared.map((stage) => {
    const found = given.get(stage.id);
    const label = found ? text(found.label, 24) : undefined;
    const voice: StageVoice = { id: stage.id, label: label ?? stage.name };
    if (stage.input === null || !found) return voice;
    const title = text(found.title, 120);
    const help = text(found.help, 400);
    const next = text(found.next, 30);
    const placeholder = text(found.placeholder, 160);
    return {
      ...voice,
      ...(title ? { title } : {}),
      ...(help ? { help } : {}),
      ...(next ? { next } : {}),
      ...(placeholder ? { placeholder } : {}),
    };
  });
}

export function parseTemplatePlan(raw: string, choices: readonly PlanTemplateChoice[]): TemplatePlan {
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
  const choice = choices.find((item) => item.id === templateId);
  if (choice === undefined) {
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
    stages: alignStages(value.stages, choice.stages),
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
  const prompt = planPrompt(trimmed, choices);
  const first = await llm.complete(prompt, { temperature: 0.3, maxOutputTokens: 2048 });
  try {
    return parseTemplatePlan(first, choices);
  } catch (error) {
    if (!(error instanceof TemplatePlanError)) throw error;
  }
  const retried = await llm.complete(
    [prompt, "", "이전 출력은 사용할 수 없었습니다:", first, "", "위 형식의 JSON 객체만 다시 출력하세요."].join(NL),
    { temperature: 0, maxOutputTokens: 2048 },
  );
  return parseTemplatePlan(retried, choices);
}

