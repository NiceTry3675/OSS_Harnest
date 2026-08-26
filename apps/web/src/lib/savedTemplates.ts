/** 사용자가 0단계에서 만든 템플릿 보관함.
 *
 *  보관되는 것은 절차가 아니라 **설정**이다 — 어떤 평가 절차 위에서, 분량은 얼마로,
 *  길이를 점수에 반영할지, 무엇을 확인하는 질문을 뽑을지. 채점기·관문·분할 비율은
 *  여전히 절차(템플릿)가 소유한다. 화면도 그렇게 표기한다.
 *
 *  이 브라우저에만 남는다. 저장·수정·삭제 모두 사용자 손에 있고, 서버로 가지 않는다. */

import type { TemplatePlan } from "./templatePlan";

export interface SavedTemplate extends TemplatePlan {
  /** 보관함 안에서의 식별자 */
  savedId: string;
  /** 어떤 목표에서 만들어졌는지 */
  goal: string;
  /** 만든 시각(ISO) */
  createdAt: string;
}

const KEY = "harnest.savedTemplates";
const MAX = 20;

function read(): SavedTemplate[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SavedTemplate => {
      if (typeof item !== "object" || item === null) return false;
      const v = item as Record<string, unknown>;
      return typeof v.savedId === "string" && typeof v.name === "string";
    });
  } catch {
    // 저장소를 못 읽어도 기본 템플릿으로 계속 쓸 수 있어야 한다
    return [];
  }
}

function write(list: SavedTemplate[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* 저장할 수 없으면 이번 세션에만 없는 것으로 둔다 */
  }
}

export function listSavedTemplates(): SavedTemplate[] {
  return read();
}

export function saveTemplate(plan: TemplatePlan, goal: string): SavedTemplate {
  const saved: SavedTemplate = {
    ...plan,
    savedId: `saved-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    goal,
    createdAt: new Date().toISOString(),
  };
  write([saved, ...read()]);
  return saved;
}

export function updateSavedTemplate(savedId: string, patch: Partial<TemplatePlan>): void {
  write(read().map((item) => (item.savedId === savedId ? { ...item, ...patch } : item)));
}

export function removeSavedTemplate(savedId: string): void {
  write(read().filter((item) => item.savedId !== savedId));
}
