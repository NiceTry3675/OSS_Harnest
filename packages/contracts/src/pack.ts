/** Evaluation Pack — 승인 순간 동결되는 판정 절차 전체 (SPEC §3 원칙 4).
 *  결정적 전용 절차는 examinerReport·캘리브레이션에서 면제된다(SPEC §10). */

export interface CriterionDef {
  id: string;
  kind: "deterministic" | "case_answering";
  scorer: string;
  params: Record<string, number | string>;
  /** weight 합은 1.0 — 게이트는 저울이 아니라 문이므로 weight가 없다 */
  weight: number;
  label: string;
}

export interface GateDef {
  id: string;
  kind: "deterministic";
  scorer: string;
  params: Record<string, number | string>;
  /** 현재 지원하는 gate 효과는 reject뿐이다 */
  effect: "reject";
  label: string;
}

/** 판정 절차에 동결할 수 있는 저지 프로바이더 — 모델 ID와 함께 다이제스트에 결속된다. */
export type JudgeProvider = "gemini" | "vertex" | "openai" | "mock";

/** 결정적 전용 — 면제 사유를 화면에 정직하게 표시한다(SPEC §10). */
export interface JudgeDeterministicOnly {
  kind: "deterministic_only";
  exemptions: { examinerReport: string; calibration: string; pairwise: string };
}

/** 케이스 실측 채점 — responder는 산출물+케이스 질문만 본다(불변식).
 *  채택은 케이스 집계 스칼라 엄격 개선(SPEC §5.1.1).
 *  검증 리포트·캘리브레이션은 이 절차의 승인 전 요건이며 forDigest로 결속된다(./examiner.ts).
 *  리포트가 다이제스트를 참조하므로 digestScope에는 들어갈 수 없고, 현재는 팩 밖 별도 상태다. */
export interface JudgeCaseAnswering {
  kind: "case_answering";
  judge: {
    /** 저지·responder 구동 모델 — 판정 절차의 일부로 동결된다(교체=재승인) */
    provider: JudgeProvider;
    model: string;
  };
  /** 현재 채택 모드에서 pairwise를 적용하지 않는 이유를 화면에 표시한다 */
  pairwiseNotice: string;
}

export interface EvaluationPack {
  packVersion: "skeleton-1";
  templateId: string;
  criteria: CriterionDef[];
  gates: GateDef[];
  judgeProcedure: JudgeDeterministicOnly | JudgeCaseAnswering;
  holdoutPolicy:
    | { mode: "none"; note: string }
    | {
        /** 자동 꼬리 분할 — 마지막 1/3이 홀드아웃. 루프(Generator)에는 절대 노출되지 않는다 */
        mode: "auto_tail";
        note: string;
        holdoutCaseIds: string[];
      };
  /** 판정 절차 전체(packVersion+templateId+criteria+gates+judgeProcedure+holdoutPolicy)의 SHA-256.
   *  승인 시 계산·동결 — 이후 어떤 필드가 바뀌어도 다이제스트가 어긋난다. */
  definitionDigest: string;
}

/** 다이제스트 결속 범위 — 이 함수가 곧 "동결의 단위는 판정 절차 전체"의 정의다 */
export function digestScope(pack: Omit<EvaluationPack, "definitionDigest">): unknown {
  return {
    packVersion: pack.packVersion,
    templateId: pack.templateId,
    criteria: pack.criteria,
    gates: pack.gates,
    judgeProcedure: pack.judgeProcedure,
    holdoutPolicy: pack.holdoutPolicy,
  };
}
