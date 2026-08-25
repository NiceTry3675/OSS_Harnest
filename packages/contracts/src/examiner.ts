/** 시험관 검증 리포트 계약 — LLM 판정 루프의 승인 전 요건
 *  (SPEC §3 원칙 2, §5.1 검증 배터리). 결정적 전용 루프는 면제(§10).
 *
 *  배터리는 실행마다 달라질 수 있는 것(사용자가 고른 저지 모델)만 검사한다:
 *  안정성(재채점 흔들림)과 꼼수 내성(날조·아첨 오염 응답 채점). 결정적 코드(게이트)는
 *  유닛 테스트가, 설정의 산술적 성질(분량 상한 대 기록 길이)은 컴파일 시 안내가 맡는다.
 *
 *  리포트는 digestScope 안에 들어갈 수 없다(자기 순환 — 리포트가 다이제스트를
 *  참조하므로 다이제스트 계산에 포함될 수 없다). 대신 forDigest로 판정 절차에 결속한다:
 *  기준 수정 → 재컴파일 → definitionDigest 변경 → 이전 리포트는 불일치로 기계적 무효.
 *  "수정→재검증 왕복"(SPEC §4.1)의 구현이 이 필드 하나이며, 재검증은 UI가 자동 실행한다.
 *  표시는 통과/주의/실패뿐 — 소표본 재채점으로 정밀 수치를 주장하지 않는다. */

import type { EvaluationPack, JudgeProvider } from "./pack";

export type ExaminerVerdict = "pass" | "warn" | "fail";

export type ExaminerCheckId = "stability" | "hack_resistance";

export interface ExaminerCheckResult {
  id: ExaminerCheckId;
  verdict: ExaminerVerdict;
  /** 한 줄 사유 — 판정의 근거 설명. 수치 헤드라인 금지 */
  note: string;
}

export interface ExaminerReport {
  checks: ExaminerCheckResult[];
  /** 최악 판정 — fail이 하나라도 있으면 fail */
  overall: ExaminerVerdict;
  /** 이 리포트가 검증한 판정 절차의 definitionDigest — 불일치 = 무효(재검증 필요) */
  forDigest: string;
  /** 배터리를 실제 구동한 저지 — 동결 선언과 다르면 이 절차를 인증하지 못한다 */
  judge: { provider: JudgeProvider; model: string };
  ranAt: string;
}

const VERDICT_ORDER: Record<ExaminerVerdict, number> = { pass: 0, warn: 1, fail: 2 };

export function worstVerdict(verdicts: ExaminerVerdict[]): ExaminerVerdict {
  return verdicts.reduce<ExaminerVerdict>(
    (worst, v) => (VERDICT_ORDER[v] > VERDICT_ORDER[worst] ? v : worst),
    "pass",
  );
}

/** 승인 차단 사유 — 빈 배열이어야 승인할 수 있다. fail은 승인을 차단한다(2026-08-23 결정):
 *  검증에 실패한 시험관의 동결은 제품의 자기모순이다. warn은 승인 가능하되 표기가 따라간다.
 *  모의 저지는 모델명 표기가 유동적이라 provider만 대조한다(templates 등록소의 실행 가드와 동일 규칙). */
export function approvalBlockers(
  pack: EvaluationPack,
  report: ExaminerReport | null,
): string[] {
  const jp = pack.judgeProcedure;
  if (jp.kind === "deterministic_only") return [];

  const blockers: string[] = [];
  if (report === null) {
    blockers.push("시험관 검증 리포트가 없습니다 — 검증을 실행해야 승인할 수 있습니다.");
  } else if (report.forDigest !== pack.definitionDigest) {
    blockers.push("기준이 수정되어 이전 검증 리포트가 무효화되었습니다 — 다시 검증해 주세요.");
  } else if (
    report.judge.provider !== jp.judge.provider ||
    (jp.judge.provider !== "mock" && report.judge.model !== jp.judge.model)
  ) {
    blockers.push("검증을 구동한 채점 모델이 동결 선언과 다릅니다 — 승인할 모델로 다시 검증해 주세요.");
  } else if (report.overall === "fail") {
    blockers.push("시험관 검증 실패 — 실패한 기준은 동결할 수 없습니다. 기준을 수정한 뒤 다시 검증해 주세요.");
  }
  return blockers;
}
