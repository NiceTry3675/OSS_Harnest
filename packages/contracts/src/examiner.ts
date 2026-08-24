/** 시험관 검증 리포트·캘리브레이션 계약 — llm_judge 포함 루프의 승인 전 요건
 *  (SPEC §3 원칙 2, §5.1 검증 배터리, §12 미결 11). 결정적 전용 루프는 면제(§10 특례 ①).
 *
 *  리포트·캘리브레이션은 digestScope 안에 들어갈 수 없다(자기 순환 — 리포트가 다이제스트를
 *  참조하므로 다이제스트 계산에 포함될 수 없다). 대신 forDigest로 판정 절차에 결속한다:
 *  기준 수정 → 재컴파일 → definitionDigest 변경 → 이전 리포트·캘리브레이션은 불일치로
 *  기계적 무효. "수정→재검증 왕복"(SPEC §4.1)의 구현이 이 필드 하나다.
 *  표시는 통과/주의/실패뿐 — 소표본 재채점으로 정밀 수치를 주장하지 않는다(§12 미결 2). */

import type { EvaluationPack, JudgeProvider } from "./pack";

export type ExaminerVerdict = "pass" | "warn" | "fail";

export type ExaminerCheckId = "ordering" | "discrimination" | "stability" | "hack_resistance";

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

export type CalibrationPairKind = "quality" | "hack_probe";
export type AbChoice = "A" | "B";

/** 캘리브레이션 A/B 쌍 사양 — 위치(A/B)는 다이제스트에서 파생된 결정적 무작위.
 *  examinerChoice는 사용자가 먼저 고르기 전까지 화면에 노출하지 말 것(블라인드). */
export interface CalibrationPairSpec {
  id: string;
  kind: CalibrationPairKind;
  a: unknown;
  b: unknown;
  examinerChoice: AbChoice;
  /** 판정 공개 시 보여줄 근거 한 줄 */
  basis: string;
}

export interface CalibrationPairResult {
  id: string;
  kind: CalibrationPairKind;
  userChoice: AbChoice;
  examinerChoice: AbChoice;
  agreed: boolean;
}

export interface CalibrationResult {
  pairs: CalibrationPairResult[];
  verdict: ExaminerVerdict;
  forDigest: string;
  /** 판정한 쌍을 만든 검증 리포트의 ranAt — 검증을 다시 실행하면 쌍(산출물)이 바뀌므로
   *  캘리브레이션도 리포트 인스턴스에 결속된다("새 리포트 = 새 캘리브레이션"의 기계화) */
  forReportAt: string;
  ranAt: string;
}

const VERDICT_ORDER: Record<ExaminerVerdict, number> = { pass: 0, warn: 1, fail: 2 };

export function worstVerdict(verdicts: ExaminerVerdict[]): ExaminerVerdict {
  return verdicts.reduce<ExaminerVerdict>(
    (worst, v) => (VERDICT_ORDER[v] > VERDICT_ORDER[worst] ? v : worst),
    "pass",
  );
}

/** 캘리브레이션 판정 규칙 — 꼼수 쌍 불일치는 즉시 실패: 사용자가 꼼수 산출물을 선호했다면
 *  기준이 사용자 가치와 어긋난 것이고, 시험관이 꼼수를 택했다면 방어가 뚫린 것이다.
 *  어느 쪽이든 이 기준은 동결할 수 없다. 불일치 과반도 실패, 품질 쌍 일부 불일치는 주의.
 *  꼼수 쌍이 아예 없는 캘리브레이션도 실패다 — "알려진 꼼수 예시 1개 이상 포함"은
 *  SPEC §3 원칙 2의 정의 요건이라 템플릿 선의가 아니라 계약이 강제한다. */
export function calibrationVerdict(pairs: CalibrationPairResult[]): ExaminerVerdict {
  if (pairs.length === 0) return "fail";
  if (!pairs.some((p) => p.kind === "hack_probe")) return "fail";
  const disagreed = pairs.filter((p) => !p.agreed);
  if (disagreed.some((p) => p.kind === "hack_probe")) return "fail";
  if (disagreed.length * 2 > pairs.length) return "fail";
  return disagreed.length > 0 ? "warn" : "pass";
}

/** 사용자 판정 확정 — 모든 쌍의 선택이 모여야 결과가 된다. 템플릿 무관 조립:
 *  쌍 사양(specs)은 템플릿이 만들고, 일치 여부·판정·결속(다이제스트+리포트 인스턴스)은
 *  계약이 정의한다. */
export function judgeCalibration(
  specs: CalibrationPairSpec[],
  userChoices: AbChoice[],
  pack: EvaluationPack,
  report: ExaminerReport,
): CalibrationResult {
  if (userChoices.length !== specs.length) {
    throw new Error("모든 쌍을 판정해야 캘리브레이션이 완료됩니다.");
  }
  const pairs = specs.map((s, i) => ({
    id: s.id,
    kind: s.kind,
    userChoice: userChoices[i],
    examinerChoice: s.examinerChoice,
    agreed: userChoices[i] === s.examinerChoice,
  }));
  return {
    pairs,
    verdict: calibrationVerdict(pairs),
    forDigest: pack.definitionDigest,
    forReportAt: report.ranAt,
    ranAt: new Date().toISOString(),
  };
}

/** 승인 차단 사유 — 빈 배열이어야 승인할 수 있다. fail은 승인을 차단한다(2026-08-23 결정):
 *  검증에 실패한 시험관의 동결은 제품의 자기모순이다. warn은 승인 가능하되 표기가 따라간다.
 *  모의 저지는 모델명 표기가 유동적이라 provider만 대조한다(templates 등록소의 실행 가드와 동일 규칙). */
export function approvalBlockers(
  pack: EvaluationPack,
  report: ExaminerReport | null,
  calibration: CalibrationResult | null,
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

  if (calibration === null) {
    blockers.push("캘리브레이션(A/B 직접 판정)이 완료되지 않았습니다.");
  } else if (calibration.forDigest !== pack.definitionDigest) {
    blockers.push("기준이 수정되어 이전 캘리브레이션이 무효화되었습니다 — 다시 판정해 주세요.");
  } else if (report !== null && calibration.forReportAt !== report.ranAt) {
    // 검증을 다시 실행하면 쌍(산출물)이 바뀐다 — 옛 쌍에 대한 판정은 새 리포트를 인증하지 못한다
    blockers.push("검증이 다시 실행되었습니다 — 새 검증 결과의 쌍으로 캘리브레이션을 다시 판정해 주세요.");
  } else if (calibration.verdict === "fail") {
    blockers.push(
      "캘리브레이션 실패 — 시험관 판정과 당신의 판단이 어긋납니다. 기준을 수정한 뒤 다시 확인해 주세요.",
    );
  }
  return blockers;
}
