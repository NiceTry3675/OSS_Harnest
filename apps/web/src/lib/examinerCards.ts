/** 승인 화면 검사 카드 문구 — 검사 id(contracts)는 공통이지만, 각 검사가 실제로 무엇을 어떻게 재는지
 *  (안정성 임계의 산식, 꼼수 내성 프로브의 종류)는 배터리를 구현한 템플릿만 안다. 페이지는 여기의
 *  일반 문구를 기본으로 쓰고, 템플릿이 등록소(TemplateEntry.examiner.checkCards)로 넘긴 문구가 있으면
 *  그것으로 덮는다 — 페이지에 템플릿별 문구를 두지 않기 위해서다(SPEC §6 경계 원칙). */

import type { ExaminerCheckId } from "@harnest/contracts";

export interface CheckCardText {
  name: string;
  desc: string;
}

/** 템플릿이 넘기는 덮어쓰기 — 검사별로 이름·설명 중 필요한 것만 */
export type CheckCardOverrides = Partial<Record<ExaminerCheckId, Partial<CheckCardText>>>;

/** 배터리가 검사를 돌리는 순서와 같다 — 진행 중 카드는 '결과가 아직 없는 첫 카드'로 정한다 */
export const CHECK_ORDER: readonly ExaminerCheckId[] = ["stability", "hack_resistance"];

/** 어떤 배터리에도 맞는 일반 문구 — 임계·프로브 같은 구현 세부를 말하지 않는다 */
export const DEFAULT_CHECK_CARDS: Record<ExaminerCheckId, CheckCardText> = {
  stability: {
    name: "재채점 결과가 안정적인가",
    desc: "같은 결과물을 다시 채점해도 판정이 크게 흔들리지 않는지",
  },
  hack_resistance: {
    name: "꾸며낸 답을 가려내는가",
    desc: "채점을 속이려는 답에 높은 점수를 주지 않는지",
  },
};

export function checkCardTexts(
  overrides?: CheckCardOverrides,
): Record<ExaminerCheckId, CheckCardText> {
  const merged = {} as Record<ExaminerCheckId, CheckCardText>;
  for (const id of CHECK_ORDER) {
    const base = DEFAULT_CHECK_CARDS[id];
    const over = overrides?.[id];
    merged[id] = {
      name: over?.name?.trim() || base.name,
      desc: over?.desc?.trim() || base.desc,
    };
  }
  return merged;
}
