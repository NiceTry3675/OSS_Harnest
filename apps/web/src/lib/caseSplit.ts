/** 위저드 케이스 목록의 용도 표시 — compile 결과의 holdoutPolicy(실제 분할)를 입력 순서로 되돌린다.
 *
 *  분할 산식(비율·시드 셔플)도, 케이스 id 규약도 템플릿의 것이며 여기서 복제하지 않는다 — 어떤 질문이
 *  어느 용도인지는 오직 pack이 말해 주고, id가 몇 번째 제출 쌍인지는 등록소가 넘겨준 caseIdAt
 *  (TemplateEntry.caseIdAt)만 안다. compile은 제출 대상 쌍(미확인 초안·빈 쌍 제외)에 입력 순서대로
 *  id를 붙이므로, 같은 규칙으로 걸러 낸 j번째 쌍의 id가 caseIdAt(j)다. pack의 id가 그 규약 밖이면
 *  (범위 밖 번호·형식 불일치·같은 쌍의 이중 배정) 표시를 포기한다(null) — 틀린 배지보다 없는 배지가
 *  낫다. 템플릿이 caseIdAt을 내놓지 않아도 같다. */

import type { EvaluationPack } from "@harnest/contracts";
import type { CasePair } from "../components/WizardCaseList";

export type CaseUse = "holdout" | "guard" | "visible";

/** toAnswers와 같은 제출 규칙 — 확인하지 않은 초안과 반쪽짜리 쌍은 answers에 실리지 않는다 */
export function isSubmittablePair(pair: CasePair): boolean {
  return (
    pair.needsConfirm !== true &&
    pair.question.trim().length > 0 &&
    pair.expectedAnswer.trim().length > 0
  );
}

/** 쌍마다 용도를 돌려준다. 제출되지 않는 쌍은 null. 분할이 없는 정책이거나 id를 되돌릴 수 없으면
 *  전체 null. */
export function caseUses(
  pairs: readonly CasePair[],
  holdoutPolicy: EvaluationPack["holdoutPolicy"],
  caseIdAt: ((index: number) => string) | undefined,
): Array<CaseUse | null> | null {
  if (holdoutPolicy.mode !== "seeded_split" || caseIdAt === undefined) return null;
  const submittable = pairs.map(isSubmittablePair);
  const count = submittable.filter(Boolean).length;
  // 제출 순서 j → id: 템플릿 규약을 그대로 불러 표를 만들고, pack의 id는 이 표에서만 찾는다
  const indexOfId = new Map<string, number>();
  for (let j = 0; j < count; j++) indexOfId.set(caseIdAt(j), j);
  const uses = new Map<number, CaseUse>();
  for (const [ids, use] of [
    [holdoutPolicy.holdoutCaseIds, "holdout"],
    [holdoutPolicy.guardCaseIds, "guard"],
  ] as const) {
    for (const id of ids) {
      const index = indexOfId.get(id);
      // 같은 쌍이 두 용도에 겹치면 분할이 아니다 — 규약이 어긋난 신호
      if (index === undefined || uses.has(index)) return null;
      uses.set(index, use);
    }
  }
  let next = 0;
  return pairs.map((_, i) => {
    if (!submittable[i]) return null;
    const use = uses.get(next) ?? "visible";
    next += 1;
    return use;
  });
}
