/** Evaluation Pack — 승인 순간 동결되는 판정 절차 전체 (SPEC §3 원칙 4, PHILOSOPHY §5).
 *  스켈레톤은 결정적 전용: examinerReport·캘리브레이션 면제, pairwise 금지 (SPEC §10 특례 ①·②). */

export interface CriterionDef {
  id: string;
  kind: "deterministic";
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
  /** 스켈레톤은 reject만 — cap의 채택 시 의미는 출력 명세(미결 4) 확정 후 */
  effect: "reject";
  label: string;
}

export interface EvaluationPack {
  packVersion: "skeleton-1";
  templateId: string;
  criteria: CriterionDef[];
  gates: GateDef[];
  judgeProcedure: {
    kind: "deterministic_only";
    /** 결정적 전용 면제의 방어 세트 표기 (미결 4 표기 규칙의 스켈레톤 구현) */
    exemptions: { examinerReport: string; calibration: string; pairwise: string };
  };
  holdoutPolicy: { mode: "none"; note: string };
  /** 판정 절차 전체(criteria+gates+judgeProcedure+holdoutPolicy)의 SHA-256.
   *  승인 시 계산·동결 — 이후 어떤 필드가 바뀌어도 다이제스트가 어긋난다. */
  definitionDigest: string;
}

/** 다이제스트 결속 범위 — 이 함수가 곧 "동결의 단위는 판정 절차 전체"의 정의다 */
export function digestScope(pack: Omit<EvaluationPack, "definitionDigest">): unknown {
  return {
    criteria: pack.criteria,
    gates: pack.gates,
    judgeProcedure: pack.judgeProcedure,
    holdoutPolicy: pack.holdoutPolicy,
  };
}
