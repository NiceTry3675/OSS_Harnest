/** 모델 목록 추리기 — 벤더가 주는 목록은 100개를 넘고, 대부분은 채점에 쓸 수 없다.
 *
 *  거르는 방식을 "빼는 목록"에서 "남기는 목록"으로 바꿨다. 빼는 방식은 새 잡동사니가
 *  나올 때마다 규칙이 늘어나고, 그 사이 구형 모델이 목록 맨 앞에 앉는다
 *  (실제로 OpenAI 목록에서 babbage-002가 기본으로 잡혔다).
 *
 *  추린 목록에 없어도 이름을 직접 적어 쓸 수 있고, 화면에서 전체 목록을 펼칠 수도 있다.
 *  그러니 여기서 좁게 잡아도 막히는 길은 없다. */

import type { AvailableModel } from "./llm";

/** 지금 세대의 갈래 — 새 모델이 나오면 여기 한 줄이면 된다.
 *  OpenRouter는 `벤더/모델` 꼴이라 앞의 벤더를 떼고 맞춰 본다. */
const CURRENT_FAMILY: RegExp[] = [
  /^gpt-[5-9]/, // OpenAI
  /^o[3-9](-|$)/, // OpenAI 추론 계열
  /^claude-(opus|sonnet)-(4-[6-9]|[5-9])/, // Anthropic — adaptive thinking·effort를 받는 4.6 이후만
  /^gemini-[3-9][.-]/, // Google
  /^llama-?[3-9]/, // Meta · Ollama
  /^qwen[3-9]?/, // Alibaba
  /^deepseek-(v[3-9]|r[1-9])/, // DeepSeek
  /^mistral-(large|medium|small)/, // Mistral
  /^gemma-?[3-9]/, // Google 오픈 모델
];

/** 채점에 쓸 수 없는 갈래 — 음성·이미지·임베딩 등 */
const NOT_FOR_JUDGING =
  /(tts|embed|vision|audio|image|imagen|live|computer-use|deep-research|antigravity|realtime|moderation|whisper|dall-e|babbage|davinci|transcribe|speech|search|rerank|guard)/i;

/** 날짜가 박힌 스냅샷 — 같은 갈래의 별칭이 따로 있으므로 기본 목록에서는 뺀다.
 *  `-2024-04-09` · `-20240409` · `-0613` 꼴을 모두 잡는다. */
const DATED_SNAPSHOT = /-(\d{4}-\d{2}-\d{2}|\d{8}|\d{4})$/;

/** 벤더 접두사를 뗀 모델 이름 — `openai/gpt-5.6-sol` → `gpt-5.6-sol` */
function bareId(id: string): string {
  const slash = id.lastIndexOf("/");
  return (slash >= 0 ? id.slice(slash + 1) : id).toLowerCase();
}

function worthShowing(model: AvailableModel): boolean {
  const id = bareId(model.id);
  if (NOT_FOR_JUDGING.test(id) || NOT_FOR_JUDGING.test(model.label)) return false;
  if (DATED_SNAPSHOT.test(id)) return false;
  return CURRENT_FAMILY.some((family) => family.test(id));
}

/** 기본으로 보여줄 목록. 하나도 안 남으면 거르지 않은 목록을 그대로 돌려준다 —
 *  규칙이 시대에 뒤처져도 고를 것이 사라지면 안 된다. */
export function preferredModels(models: readonly AvailableModel[]): AvailableModel[] {
  const kept = models.filter(worthShowing);
  return kept.length > 0 ? kept : [...models];
}

/** 목록을 새로 받았을 때 어떤 모델을 고를지.
 *  이미 고른 것이 목록에 있으면 그대로 두고, 없으면 추린 목록의 첫 번째를 집는다. */
export function pickModel(models: readonly AvailableModel[], current: string): string {
  if (current && models.some((m) => m.id === current)) return current;
  return preferredModels(models)[0]?.id ?? current;
}
