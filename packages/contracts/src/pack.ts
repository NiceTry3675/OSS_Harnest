/** Evaluation Pack — 승인 순간 동결되는 판정 절차 전체 (SPEC §3 원칙 4, PHILOSOPHY §5).
 *  스켈레톤은 결정적 전용: examinerReport·캘리브레이션 면제, pairwise 금지 (SPEC §10 특례 ①·②). */

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
  /** 스켈레톤은 reject만 — cap의 채택 시 의미는 출력 명세(미결 4) 확정 후 */
  effect: "reject";
  label: string;
}

/** 결정적 전용 — 면제의 방어 세트 표기 (SPEC §10 특례 ①·②) */
export interface JudgeDeterministicOnly {
  kind: "deterministic_only";
  exemptions: { examinerReport: string; calibration: string; pairwise: string };
}

/** 케이스 실측 채점 — responder는 산출물+케이스 질문만 본다(불변식, 스키마 §5).
 *  채택은 제3 모드(케이스 집계 스칼라 엄격 개선 — SPEC §5.1.1, 실측 02b~05로 검증). */
export interface JudgeCaseAnswering {
  kind: "case_answering";
  judge: {
    /** 저지·responder 구동 모델 — 판정 절차의 일부로 동결된다(교체=재승인) */
    provider: "gemini" | "mock";
    model: string;
  };
  /** 미구현 요건의 정직 표기 — 숨기지 않고 승인 화면에 노출한다 */
  notices: { examinerReport: string; calibration: string; pairwise: string };
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
