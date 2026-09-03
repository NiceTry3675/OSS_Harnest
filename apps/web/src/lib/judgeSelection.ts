/** 위저드의 채점 모델 초기값 — '입력 수정'으로 돌아온 경우 승인하려던 공급자·모델을 잇는다.
 *  다른 답변(draft)은 savedAnswers에서 복원되는데 이 단계만 기본값으로 되돌아가면, 저장된 키가
 *  있는 공급자의 첫 모델이 조용히 판정 절차에 동결되고 다이제스트가 바뀌어 점검 비용까지 다시 든다. */

import type { EvaluationPack, JudgeProvider } from "@harnest/contracts";

export interface JudgeSelection {
  choice: JudgeProvider;
  /** 빈 문자열이면 공급자 기본 모델을 쓴다(모의 모델은 모델 이름이 없다) */
  model: string;
}

export const DEFAULT_JUDGE_SELECTION: JudgeSelection = { choice: "openai", model: "" };

export function judgeSelectionOf(pack: EvaluationPack | null | undefined): JudgeSelection {
  const procedure = pack?.judgeProcedure;
  if (procedure === undefined || procedure.kind !== "case_answering") return DEFAULT_JUDGE_SELECTION;
  const { provider, model } = procedure.judge;
  return { choice: provider, model: provider === "mock" ? "" : model };
}
