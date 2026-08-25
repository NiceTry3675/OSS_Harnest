/** 완료된 승인·실행을 휴대하거나 서버에 기록할 때 쓰는 정식 JSON 계약.
 *
 * 로컬 자동 복원용 ProjectSnapshot과 다르다. 이 봉투는 현재 승인본과 완료 결과만 담고,
 * 편집 중 상태·시험관 산출물·재검증 계수·API 키는 의도적으로 포함하지 않는다.
 * 승인 증거는 definitionDigest를 참조하므로 digestScope 밖에서 forDigest로 결속한다. */

import { sha256Canonical } from "./digest";
import {
  approvalBlockers,
  calibrationVerdict,
  worstVerdict,
  type CalibrationResult,
  type ExaminerCheckId,
  type ExaminerReport,
} from "./examiner";
import type { InterviewSubmission } from "./interview";
import { SCORE_CEILING, type LoopCheckpoint, type LoopSpec } from "./loop";
import { digestScope, type EvaluationPack } from "./pack";

export const PROJECT_EXPORT_KIND = "harnest.project-export" as const;
export const PROJECT_EXPORT_VERSION = 1 as const;

export interface ApprovalBinding {
  /** 사용자가 승인한 Evaluation Pack의 definitionDigest */
  forDigest: string;
  approvedAt: string;
}

/** Pack과 그 승인 전 증거를 함께 운반하는 자기참조 없는 봉투. */
export interface ApprovedEvaluationRecord {
  pack: EvaluationPack;
  /** 결정적 전용 템플릿에서는 null */
  examinerReport: ExaminerReport | null;
  /** 결정적 전용 템플릿에서는 null */
  calibration: CalibrationResult | null;
  approval: ApprovalBinding;
}

export interface HoldoutCaseScore {
  caseId: string;
  question: string;
  score: number;
  why: string;
  /** 반복 여부는 차단 조건이 아니라 결과 해석용 표기다. */
  caseType: "repeated" | "new";
}

export type HoldoutEvaluation =
  | {
      gateRejected: true;
      score: null;
      perCase: [];
      violations: string[];
    }
  | {
      gateRejected: false;
      score: number;
      perCase: HoldoutCaseScore[];
      violations: string[];
    };

export interface HoldoutScores {
  baseline: HoldoutEvaluation | null;
  final: HoldoutEvaluation | null;
  /** 로컬 복원 호환을 위해 optional. 새 상태는 단계별 실패를 명시해 null(진행 중)과 구분한다. */
  errors?: {
    baseline: string | null;
    final: string | null;
  };
}

export type HoldoutPhaseRecord =
  | { status: "scored"; evaluation: HoldoutEvaluation }
  | { status: "failed"; error: string };

/** 정식 결과는 홀드아웃 없음과 단계별 성공·실패를 명시적으로 구분한다. */
export type HoldoutRecord =
  | { mode: "none" }
  | {
      mode: "measured";
      baseline: HoldoutPhaseRecord;
      final: HoldoutPhaseRecord;
    };

export interface RunResultRecord<A = unknown> {
  checkpoint: LoopCheckpoint<A>;
  holdout: HoldoutRecord;
}

/**
 * 완료 결과의 감사·보관용 단일 JSON 봉투.
 *
 * `problem`은 인터뷰 답변에서 파생되고, 시험관 artifacts는 승인 후 판정 근거가 아니므로 중복
 * 저장하지 않는다. 진행 중 프로젝트의 이식·재개 형식도 아니다.
 */
export interface ProjectExportEnvelope<A = unknown> {
  kind: typeof PROJECT_EXPORT_KIND;
  envelopeVersion: typeof PROJECT_EXPORT_VERSION;
  exportedAt: string;
  project: {
    interview: InterviewSubmission;
    evaluation: ApprovedEvaluationRecord;
    loopSpec: LoopSpec;
  };
  result: RunResultRecord<A>;
}

export type ProjectExportInput<A = unknown> = Omit<
  ProjectExportEnvelope<A>,
  "kind" | "envelopeVersion"
>;

export interface ContractIssue {
  path: string;
  message: string;
}

export class ProjectExportContractError extends Error {
  constructor(readonly issues: ContractIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
    this.name = "ProjectExportContractError";
  }
}

function issue(path: string, message: string): ContractIssue {
  return { path, message };
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function jsonRepresentationIssues(
  value: unknown,
  path: string,
  ancestors: WeakSet<object> = new WeakSet(),
): ContractIssue[] {
  if (value === null || typeof value === "boolean") return [];
  if (typeof value === "string") {
    return hasUnpairedSurrogate(value)
      ? [issue(path, "짝이 맞지 않는 Unicode surrogate는 JSON 기록에 허용하지 않습니다.")]
      : [];
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? [] : [issue(path, "JSON은 NaN·Infinity를 보존할 수 없습니다.")];
  }
  if (typeof value !== "object") {
    return [issue(path, `JSON에 저장할 수 없는 값입니다: ${typeof value}`)];
  }
  if (ancestors.has(value)) return [issue(path, "순환 참조는 JSON에 저장할 수 없습니다.")];

  ancestors.add(value);
  const issues: ContractIssue[] = [];
  if (Object.getOwnPropertySymbols(value).length > 0) {
    issues.push(issue(path, "Symbol 키는 JSON에 저장할 수 없습니다."));
  }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      issues.push(issue(path, "일반 Array가 아닌 배열 객체는 JSON 기록에 넣을 수 없습니다."));
    }
    const ownNames = Object.getOwnPropertyNames(value);
    for (const name of ownNames) {
      if (name === "length") continue;
      const index = Number(name);
      if (!Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== name) {
        issues.push(issue(`${path}.${name}`, "배열의 사용자 정의 속성은 JSON에서 보존되지 않습니다."));
      }
    }
    for (let index = 0; index < value.length; index += 1) {
      const itemPath = `${path}[${index}]`;
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined) {
        issues.push(issue(itemPath, "희소 배열의 빈 항목은 JSON에서 null로 바뀝니다."));
      } else if (!("value" in descriptor) || !descriptor.enumerable) {
        issues.push(issue(itemPath, "배열 접근자·비열거 속성은 JSON 기록에 허용하지 않습니다."));
      } else {
        issues.push(...jsonRepresentationIssues(descriptor.value, itemPath, ancestors));
      }
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      issues.push(issue(path, "Map·Set·Date 같은 비일반 객체는 JSON 기록에 넣을 수 없습니다."));
    } else {
      for (const key of Object.getOwnPropertyNames(value)) {
        const propertyPath = path === "$" ? `$.${key}` : `${path}.${key}`;
        if (hasUnpairedSurrogate(key)) {
          issues.push(
            issue(propertyPath, "짝이 맞지 않는 Unicode surrogate가 포함된 키는 허용하지 않습니다."),
          );
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (!("value" in descriptor) || !descriptor.enumerable) {
          issues.push(
            issue(
              propertyPath,
              "접근자·비열거 속성·toJSON 훅은 검사와 직렬화가 달라질 수 있어 허용하지 않습니다.",
            ),
          );
        } else {
          issues.push(...jsonRepresentationIssues(descriptor.value, propertyPath, ancestors));
        }
      }
    }
  }
  ancestors.delete(value);
  return issues;
}

const REQUIRED_EXAMINER_CHECK_IDS = [
  "ordering",
  "discrimination",
  "stability",
  "hack_resistance",
] as const satisfies readonly ExaminerCheckId[];

function examinerCheckIssues(report: ExaminerReport): ContractIssue[] {
  const counts = new Map<string, number>();
  for (const check of report.checks) counts.set(check.id, (counts.get(check.id) ?? 0) + 1);
  const hasExactBattery =
    report.checks.length === REQUIRED_EXAMINER_CHECK_IDS.length &&
    REQUIRED_EXAMINER_CHECK_IDS.every((id) => counts.get(id) === 1);
  return hasExactBattery
    ? []
    : [
        issue(
          "project.evaluation.examinerReport.checks",
          "ordering·discrimination·stability·hack_resistance 검사가 각각 정확히 한 번 필요합니다.",
        ),
      ];
}

function checkpointIssues(
  checkpoint: LoopCheckpoint<unknown>,
  spec: LoopSpec,
): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const checkpointPath = "result.checkpoint";
  const validMaxRounds = Number.isInteger(spec.maxRounds) && spec.maxRounds >= 0;
  const validPlateauRounds = Number.isInteger(spec.plateauRounds) && spec.plateauRounds > 0;

  if (!validMaxRounds) {
    issues.push(issue("project.loopSpec.maxRounds", "0 이상의 정수여야 합니다."));
  }
  if (!validPlateauRounds) {
    issues.push(issue("project.loopSpec.plateauRounds", "1 이상의 정수여야 합니다."));
  }
  if (spec.adoptionRule !== "scalar_strict") {
    issues.push(issue("project.loopSpec.adoptionRule", "현재 계약은 scalar_strict만 지원합니다."));
  }
  if (!Number.isInteger(spec.seed)) {
    issues.push(issue("project.loopSpec.seed", "유한 정수여야 합니다."));
  }
  if (!Number.isInteger(checkpoint.round) || checkpoint.round < 0) {
    issues.push(issue(`${checkpointPath}.round`, "0 이상의 정수여야 합니다."));
  } else if (validMaxRounds && checkpoint.round > spec.maxRounds) {
    issues.push(issue(`${checkpointPath}.round`, "loopSpec.maxRounds를 넘을 수 없습니다."));
  }
  if (checkpoint.curve.length !== checkpoint.round + 1) {
    issues.push(issue(`${checkpointPath}.curve`, "라운드 0부터 현재 라운드까지 점수가 하나씩 필요합니다."));
  }
  if (checkpoint.tree.length !== checkpoint.round) {
    issues.push(issue(`${checkpointPath}.tree`, "각 개선 라운드의 기록이 정확히 하나씩 필요합니다."));
  }

  const scoreIssue = (value: number, path: string): void => {
    if (!Number.isFinite(value) || value < 0 || value > SCORE_CEILING) {
      issues.push(issue(path, "점수는 0 이상 100 이하의 유한한 수여야 합니다."));
    }
  };
  scoreIssue(checkpoint.championScore, `${checkpointPath}.championScore`);
  checkpoint.curve.forEach((score, index) => {
    scoreIssue(score, `${checkpointPath}.curve[${index}]`);
  });
  checkpoint.tree.forEach((record, index) => {
    scoreIssue(record.candidateScore, `${checkpointPath}.tree[${index}].candidateScore`);
    scoreIssue(record.championScore, `${checkpointPath}.tree[${index}].championScore`);
  });

  for (let index = 1; index < checkpoint.curve.length; index += 1) {
    if (checkpoint.curve[index] < checkpoint.curve[index - 1]) {
      issues.push(issue(`${checkpointPath}.curve[${index}]`, "챔피언 점수는 내려갈 수 없습니다."));
    }
  }

  const comparableRounds = Math.min(
    checkpoint.tree.length,
    Math.max(0, checkpoint.curve.length - 1),
  );
  for (let index = 0; index < comparableRounds; index += 1) {
    const record = checkpoint.tree[index];
    const recordPath = `${checkpointPath}.tree[${index}]`;
    const previousChampionScore = checkpoint.curve[index];
    const expectedAdopted =
      !record.gateRejected && record.candidateScore > previousChampionScore;
    const expectedChampionScore = expectedAdopted
      ? record.candidateScore
      : previousChampionScore;

    if (record.round !== index + 1) {
      issues.push(issue(`${recordPath}.round`, "라운드 번호가 1부터 순서대로 이어져야 합니다."));
    }
    if (record.adopted !== expectedAdopted) {
      issues.push(
        issue(
          `${recordPath}.adopted`,
          record.gateRejected
            ? "게이트 기각 후보는 채택할 수 없습니다."
            : "후보 점수가 직전 챔피언보다 엄격히 높을 때만 채택해야 합니다.",
        ),
      );
    }
    if (record.championScore !== expectedChampionScore) {
      issues.push(issue(`${recordPath}.championScore`, "채택 판정 후 챔피언 점수와 다릅니다."));
    }
    if (checkpoint.curve[index + 1] !== record.championScore) {
      issues.push(issue(`${checkpointPath}.curve[${index + 1}]`, "해당 라운드 챔피언 점수와 다릅니다."));
    }
  }

  if (
    checkpoint.curve.length > 0 &&
    checkpoint.championScore !== checkpoint.curve[checkpoint.curve.length - 1]
  ) {
    issues.push(issue(`${checkpointPath}.championScore`, "최종 곡선의 챔피언 점수와 다릅니다."));
  }

  let trailingRejections = 0;
  for (
    let index = checkpoint.tree.length - 1;
    index >= 0 && !checkpoint.tree[index].adopted;
    index -= 1
  ) {
    trailingRejections += 1;
  }

  if (checkpoint.status !== "done") {
    issues.push(issue(`${checkpointPath}.status`, "완료된 실행만 정식 결과로 내보낼 수 있습니다."));
  } else if (checkpoint.doneReason === "max_rounds") {
    if (validMaxRounds && checkpoint.round !== spec.maxRounds) {
      issues.push(issue(`${checkpointPath}.doneReason`, "max_rounds 종료는 최대 라운드에 도달해야 합니다."));
    }
    if (validPlateauRounds && trailingRejections >= spec.plateauRounds) {
      issues.push(
        issue(
          `${checkpointPath}.doneReason`,
          "plateau 조건이 먼저 성립한 실행은 max_rounds로 종료할 수 없습니다.",
        ),
      );
    }
    if (checkpoint.championScore >= SCORE_CEILING) {
      issues.push(
        issue(
          `${checkpointPath}.doneReason`,
          "척도 상한에 도달한 실행은 ceiling으로 종료해야 합니다.",
        ),
      );
    }
  } else if (checkpoint.doneReason === "plateau") {
    if (validPlateauRounds && trailingRejections !== spec.plateauRounds) {
      issues.push(
        issue(
          `${checkpointPath}.doneReason`,
          "plateau 종료 시 꼬리 연속 미채택 횟수는 plateauRounds와 정확히 같아야 합니다.",
        ),
      );
    }
    if (checkpoint.championScore >= SCORE_CEILING) {
      issues.push(
        issue(
          `${checkpointPath}.doneReason`,
          "척도 상한에 도달한 실행은 ceiling으로 종료해야 합니다.",
        ),
      );
    }
  } else if (checkpoint.doneReason === "ceiling") {
    if (checkpoint.championScore < SCORE_CEILING) {
      issues.push(
        issue(
          `${checkpointPath}.doneReason`,
          "ceiling 종료는 챔피언 점수가 척도 상한에 도달해야 합니다.",
        ),
      );
    }
  } else {
    issues.push(
      issue(`${checkpointPath}.doneReason`, "완료 사유는 max_rounds, plateau 또는 ceiling이어야 합니다."),
    );
  }

  return issues;
}

function holdoutIssues(
  record: HoldoutRecord,
  policy: EvaluationPack["holdoutPolicy"],
): ContractIssue[] {
  const issues: ContractIssue[] = [];
  if (policy.mode === "none") {
    if (record.mode !== "none") {
      issues.push(issue("result.holdout", "홀드아웃이 없는 Pack에는 측정 결과를 붙이지 않습니다."));
    }
    return issues;
  }
  if (record.mode !== "measured") {
    issues.push(issue("result.holdout", "홀드아웃 단계별 성공 또는 실패 기록이 필요합니다."));
    return issues;
  }

  const expectedIds = new Set(policy.holdoutCaseIds);
  if (expectedIds.size === 0) {
    issues.push(
      issue(
        "project.evaluation.pack.holdoutPolicy.holdoutCaseIds",
        "auto_tail 홀드아웃에는 한 개 이상의 caseId가 필요합니다.",
      ),
    );
  }
  if (expectedIds.size !== policy.holdoutCaseIds.length) {
    issues.push(
      issue(
        "project.evaluation.pack.holdoutPolicy.holdoutCaseIds",
        "동결된 홀드아웃 caseId에 중복이 없어야 합니다.",
      ),
    );
  }

  for (const phase of ["baseline", "final"] as const) {
    const phaseRecord = record[phase];
    const phasePath = `result.holdout.${phase}`;
    if (phaseRecord.status === "failed") {
      if (phaseRecord.error.trim().length === 0) {
        issues.push(issue(`${phasePath}.error`, "빈 실패 사유는 허용하지 않습니다."));
      }
      continue;
    }

    const evaluation = phaseRecord.evaluation;
    if (evaluation.gateRejected) {
      if (evaluation.score !== null || evaluation.perCase.length !== 0) {
        issues.push(
          issue(
            `${phasePath}.evaluation`,
            "게이트 기각 단계는 점수 없이 빈 perCase로 기록해야 합니다.",
          ),
        );
      }
      continue;
    }

    if (!Number.isFinite(evaluation.score) || evaluation.score < 0 || evaluation.score > 100) {
      issues.push(
        issue(
          `${phasePath}.evaluation.score`,
          "홀드아웃 총점은 0 이상 100 이하의 유한한 수여야 합니다.",
        ),
      );
    }

    const actualIds = evaluation.perCase.map((caseScore) => caseScore.caseId);
    const actualIdSet = new Set(actualIds);
    if (actualIdSet.size !== actualIds.length) {
      issues.push(issue(`${phasePath}.evaluation.perCase`, "같은 caseId를 중복 기록할 수 없습니다."));
    }
    if (
      actualIdSet.size !== expectedIds.size ||
      !policy.holdoutCaseIds.every((caseId) => actualIdSet.has(caseId))
    ) {
      issues.push(
        issue(
          `${phasePath}.evaluation.perCase`,
          "동결된 holdoutCaseIds와 정확히 같은 케이스 집합을 기록해야 합니다.",
        ),
      );
    }
    for (let index = 0; index < evaluation.perCase.length; index += 1) {
      const caseScore = evaluation.perCase[index];
      if (caseScore.score !== 0 && caseScore.score !== 0.5 && caseScore.score !== 1) {
        issues.push(
          issue(
            `${phasePath}.evaluation.perCase[${index}].score`,
            "케이스 점수는 0, 0.5, 1 중 하나여야 합니다.",
          ),
        );
      }
    }
    if (evaluation.perCase.length > 0) {
      const expectedScore =
        Math.round(
          (evaluation.perCase.reduce((sum, caseScore) => sum + caseScore.score, 0) /
            evaluation.perCase.length) *
            1000,
        ) / 10;
      if (evaluation.score !== expectedScore) {
        issues.push(
          issue(
            `${phasePath}.evaluation.score`,
            "perCase 평균을 소수점 첫째 자리로 반올림한 총점과 다릅니다.",
          ),
        );
      }
    }
  }

  const scoredCases = (["baseline", "final"] as const).map((phase) => {
    const phaseRecord = record[phase];
    return phaseRecord.status === "scored" && !phaseRecord.evaluation.gateRejected
      ? new Map(phaseRecord.evaluation.perCase.map((caseScore) => [caseScore.caseId, caseScore]))
      : null;
  });
  if (scoredCases[0] !== null && scoredCases[1] !== null) {
    for (const caseId of policy.holdoutCaseIds) {
      const baseline = scoredCases[0].get(caseId);
      const final = scoredCases[1].get(caseId);
      if (
        baseline !== undefined &&
        final !== undefined &&
        (baseline.question !== final.question || baseline.caseType !== final.caseType)
      ) {
        issues.push(
          issue(
            "result.holdout",
            `baseline과 final의 ${caseId} 질문·반복 구분이 서로 다릅니다.`,
          ),
        );
      }
    }
  }
  return issues;
}

function copyPack(pack: EvaluationPack): EvaluationPack {
  const judgeProcedure: EvaluationPack["judgeProcedure"] =
    pack.judgeProcedure.kind === "deterministic_only"
      ? {
          kind: "deterministic_only",
          exemptions: {
            examinerReport: pack.judgeProcedure.exemptions.examinerReport,
            calibration: pack.judgeProcedure.exemptions.calibration,
            pairwise: pack.judgeProcedure.exemptions.pairwise,
          },
        }
      : {
          kind: "case_answering",
          judge: {
            provider: pack.judgeProcedure.judge.provider,
            model: pack.judgeProcedure.judge.model,
          },
          pairwiseNotice: pack.judgeProcedure.pairwiseNotice,
        };
  const holdoutPolicy: EvaluationPack["holdoutPolicy"] =
    pack.holdoutPolicy.mode === "none"
      ? { mode: "none", note: pack.holdoutPolicy.note }
      : {
          mode: "auto_tail",
          note: pack.holdoutPolicy.note,
          holdoutCaseIds: [...pack.holdoutPolicy.holdoutCaseIds],
        };
  return {
    packVersion: pack.packVersion,
    templateId: pack.templateId,
    criteria: pack.criteria.map((criterion) => ({
      id: criterion.id,
      kind: criterion.kind,
      scorer: criterion.scorer,
      params: criterion.params,
      weight: criterion.weight,
      label: criterion.label,
    })),
    gates: pack.gates.map((gate) => ({
      id: gate.id,
      kind: gate.kind,
      scorer: gate.scorer,
      params: gate.params,
      effect: gate.effect,
      label: gate.label,
    })),
    judgeProcedure,
    holdoutPolicy,
    definitionDigest: pack.definitionDigest,
  };
}

function copyExaminerReport(report: ExaminerReport | null): ExaminerReport | null {
  if (report === null) return null;
  return {
    checks: report.checks.map((check) => ({
      id: check.id,
      verdict: check.verdict,
      note: check.note,
    })),
    overall: report.overall,
    forDigest: report.forDigest,
    judge: { provider: report.judge.provider, model: report.judge.model },
    ranAt: report.ranAt,
  };
}

function copyCalibration(calibration: CalibrationResult | null): CalibrationResult | null {
  if (calibration === null) return null;
  return {
    pairs: calibration.pairs.map((pair) => ({
      id: pair.id,
      kind: pair.kind,
      userChoice: pair.userChoice,
      examinerChoice: pair.examinerChoice,
      agreed: pair.agreed,
    })),
    verdict: calibration.verdict,
    forDigest: calibration.forDigest,
    forReportAt: calibration.forReportAt,
    ranAt: calibration.ranAt,
  };
}

function copyHoldoutEvaluation(evaluation: HoldoutEvaluation): HoldoutEvaluation {
  if (evaluation.gateRejected) {
    return {
      gateRejected: true,
      score: null,
      perCase: [],
      violations: [...evaluation.violations],
    };
  }
  return {
    gateRejected: false,
    score: evaluation.score,
    perCase: evaluation.perCase.map((caseScore) => ({
      caseId: caseScore.caseId,
      question: caseScore.question,
      score: caseScore.score,
      why: caseScore.why,
      caseType: caseScore.caseType,
    })),
    violations: [...evaluation.violations],
  };
}

function copyHoldoutRecord(record: HoldoutRecord): HoldoutRecord {
  if (record.mode === "none") return { mode: "none" };
  const copyPhase = (phase: HoldoutPhaseRecord): HoldoutPhaseRecord =>
    phase.status === "failed"
      ? { status: "failed", error: phase.error }
      : { status: "scored", evaluation: copyHoldoutEvaluation(phase.evaluation) };
  return {
    mode: "measured",
    baseline: copyPhase(record.baseline),
    final: copyPhase(record.final),
  };
}

function copyCheckpoint<A>(checkpoint: LoopCheckpoint<A>): LoopCheckpoint<A> {
  return {
    runId: checkpoint.runId,
    packDigest: checkpoint.packDigest,
    status: checkpoint.status,
    ...(checkpoint.doneReason === undefined ? {} : { doneReason: checkpoint.doneReason }),
    round: checkpoint.round,
    champion: checkpoint.champion,
    championScore: checkpoint.championScore,
    championViolations: [...checkpoint.championViolations],
    curve: [...checkpoint.curve],
    tree: checkpoint.tree.map((record) => ({
      round: record.round,
      candidateScore: record.candidateScore,
      championScore: record.championScore,
      adopted: record.adopted,
      gateRejected: record.gateRejected,
      violations: [...record.violations],
    })),
    provenance: checkpoint.provenance.map((entry) => ({
      at: entry.at,
      type: entry.type,
      detail: entry.detail,
    })),
    rngState: checkpoint.rngState,
  };
}

/** definitionDigest가 실제 Pack 판정 범위의 SHA-256인지 다시 계산한다. */
export async function verifyDefinitionDigest(pack: EvaluationPack): Promise<boolean> {
  const withoutDigest: Omit<EvaluationPack, "definitionDigest"> = {
    packVersion: pack.packVersion,
    templateId: pack.templateId,
    criteria: pack.criteria,
    gates: pack.gates,
    judgeProcedure: pack.judgeProcedure,
    holdoutPolicy: pack.holdoutPolicy,
  };
  return (await sha256Canonical(digestScope(withoutDigest))) === pack.definitionDigest;
}

/**
 * 앱 내부의 타입을 충족한 생산자 객체가 가리키는 승인본과 결과의 귀속을 검사한다.
 * 이는 내용 일관성 검증이지 서명이나 작성자 인증이 아니다. 서버 저장 여부도 이 검증을
 * 대신하지 않는다. 외부 JSON을 `unknown`에서 읽는 import decoder는 현재 생산자 전용 범위 밖이다.
 */
export async function projectExportIssues(
  envelope: ProjectExportEnvelope<unknown>,
): Promise<ContractIssue[]> {
  const issues: ContractIssue[] = [];
  const { interview, evaluation } = envelope.project;
  const { pack, examinerReport, calibration, approval } = evaluation;

  if (envelope.kind !== PROJECT_EXPORT_KIND) {
    issues.push(issue("kind", `지원하지 않는 형식입니다: ${String(envelope.kind)}`));
  }
  if (envelope.envelopeVersion !== PROJECT_EXPORT_VERSION) {
    issues.push(
      issue("envelopeVersion", `지원하지 않는 봉투 버전입니다: ${String(envelope.envelopeVersion)}`),
    );
  }
  if (Number.isNaN(Date.parse(envelope.exportedAt))) {
    issues.push(issue("exportedAt", "유효한 ISO 시각이어야 합니다."));
  }
  if (interview.schemaVersion !== "skeleton-1") {
    issues.push(issue("project.interview.schemaVersion", "지원하지 않는 인터뷰 스키마 버전입니다."));
  }
  if (interview.templateId.length === 0) {
    issues.push(issue("project.interview.templateId", "빈 템플릿 식별자는 허용하지 않습니다."));
  }
  if (pack.packVersion !== "skeleton-1") {
    issues.push(issue("project.evaluation.pack.packVersion", "지원하지 않는 Pack 버전입니다."));
  }
  if (pack.templateId.length === 0) {
    issues.push(issue("project.evaluation.pack.templateId", "빈 템플릿 식별자는 허용하지 않습니다."));
  }
  if (interview.templateId !== pack.templateId) {
    issues.push(issue("project.interview.templateId", "Pack의 templateId와 다릅니다."));
  }
  if (!(await verifyDefinitionDigest(pack))) {
    issues.push(issue("project.evaluation.pack.definitionDigest", "Pack 판정 범위의 SHA-256과 다릅니다."));
  }
  if (approval.forDigest !== pack.definitionDigest) {
    issues.push(issue("project.evaluation.approval.forDigest", "현재 Pack에 대한 승인이 아닙니다."));
  }
  if (Number.isNaN(Date.parse(approval.approvedAt))) {
    issues.push(issue("project.evaluation.approval.approvedAt", "유효한 ISO 시각이어야 합니다."));
  }

  if (pack.judgeProcedure.kind === "deterministic_only") {
    if (examinerReport !== null) {
      issues.push(issue("project.evaluation.examinerReport", "결정적 전용 Pack에는 리포트를 붙이지 않습니다."));
    }
    if (calibration !== null) {
      issues.push(issue("project.evaluation.calibration", "결정적 전용 Pack에는 캘리브레이션을 붙이지 않습니다."));
    }
  } else {
    if (!(["gemini", "vertex", "openai", "mock"] as const).includes(pack.judgeProcedure.judge.provider)) {
      issues.push(
        issue(
          "project.evaluation.pack.judgeProcedure.judge.provider",
          "지원하지 않는 저지 provider입니다.",
        ),
      );
    }
    if (pack.judgeProcedure.judge.model.length === 0) {
      issues.push(
        issue(
          "project.evaluation.pack.judgeProcedure.judge.model",
          "빈 저지 모델 식별자는 허용하지 않습니다.",
        ),
      );
    }
    for (const blocker of approvalBlockers(pack, examinerReport, calibration)) {
      issues.push(issue("project.evaluation", blocker));
    }
  }

  if (examinerReport !== null) {
    issues.push(...examinerCheckIssues(examinerReport));
    if (examinerReport.forDigest !== pack.definitionDigest) {
      issues.push(issue("project.evaluation.examinerReport.forDigest", "현재 Pack과 결속되지 않았습니다."));
    }
    if (examinerReport.overall !== worstVerdict(examinerReport.checks.map((check) => check.verdict))) {
      issues.push(issue("project.evaluation.examinerReport.overall", "개별 검사에서 계산한 최악 판정과 다릅니다."));
    }
    if (Number.isNaN(Date.parse(examinerReport.ranAt))) {
      issues.push(issue("project.evaluation.examinerReport.ranAt", "유효한 ISO 시각이어야 합니다."));
    }
  }

  if (calibration !== null) {
    if (calibration.forDigest !== pack.definitionDigest) {
      issues.push(issue("project.evaluation.calibration.forDigest", "현재 Pack과 결속되지 않았습니다."));
    }
    if (examinerReport === null) {
      issues.push(issue("project.evaluation.calibration.forReportAt", "결속할 검증 리포트가 없습니다."));
    } else if (calibration.forReportAt !== examinerReport.ranAt) {
      issues.push(issue("project.evaluation.calibration.forReportAt", "현재 검증 리포트 인스턴스와 다릅니다."));
    }
    if (
      calibration.pairs.some(
        (pair) => pair.agreed !== (pair.userChoice === pair.examinerChoice),
      )
    ) {
      issues.push(issue("project.evaluation.calibration.pairs", "선택과 agreed 값이 서로 모순됩니다."));
    }
    if (calibration.verdict !== calibrationVerdict(calibration.pairs)) {
      issues.push(issue("project.evaluation.calibration.verdict", "쌍 판정에서 계산한 verdict와 다릅니다."));
    }
    if (Number.isNaN(Date.parse(calibration.ranAt))) {
      issues.push(issue("project.evaluation.calibration.ranAt", "유효한 ISO 시각이어야 합니다."));
    }
  }

  const checkpoint = envelope.result.checkpoint;
  if (checkpoint.packDigest !== pack.definitionDigest) {
    issues.push(issue("result.checkpoint.packDigest", "현재 Pack에 귀속된 체크포인트가 아닙니다."));
  }
  if (checkpoint.runId.trim().length === 0) {
    issues.push(issue("result.checkpoint.runId", "빈 실행 식별자는 허용하지 않습니다."));
  }
  issues.push(...checkpointIssues(checkpoint, envelope.project.loopSpec));
  issues.push(...holdoutIssues(envelope.result.holdout, pack.holdoutPolicy));

  return issues;
}

/**
 * 앱 내부의 타입을 충족한 생산자 상태에서 고정 계약 필드만 복제해 정식 봉투를 만든다.
 * 템플릿 산출물·답변·params처럼 계약상 열린 JSON 값은 보존한다. 외부 JSON import용
 * `unknown` decoder가 아니며, 그런 decoder는 현재 범위 밖이다.
 */
export async function createProjectExportEnvelope<A>(
  input: ProjectExportInput<A>,
): Promise<ProjectExportEnvelope<A>> {
  const candidate: ProjectExportEnvelope<A> = {
    kind: PROJECT_EXPORT_KIND,
    envelopeVersion: PROJECT_EXPORT_VERSION,
    exportedAt: input.exportedAt,
    project: {
      interview: {
        schemaVersion: input.project.interview.schemaVersion,
        templateId: input.project.interview.templateId,
        answers: input.project.interview.answers,
      },
      evaluation: {
        pack: copyPack(input.project.evaluation.pack),
        examinerReport: copyExaminerReport(input.project.evaluation.examinerReport),
        calibration: copyCalibration(input.project.evaluation.calibration),
        approval: {
          forDigest: input.project.evaluation.approval.forDigest,
          approvedAt: input.project.evaluation.approval.approvedAt,
        },
      },
      loopSpec: {
        maxRounds: input.project.loopSpec.maxRounds,
        plateauRounds: input.project.loopSpec.plateauRounds,
        adoptionRule: input.project.loopSpec.adoptionRule,
        seed: input.project.loopSpec.seed,
      },
    },
    result: {
      checkpoint: copyCheckpoint(input.result.checkpoint),
      holdout: copyHoldoutRecord(input.result.holdout),
    },
  };
  let representationIssues: ContractIssue[];
  try {
    representationIssues = jsonRepresentationIssues(candidate, "$");
  } catch {
    throw new ProjectExportContractError([
      issue("$", "속성 검사를 안전하게 수행할 수 없는 객체는 JSON 기록에 넣을 수 없습니다."),
    ]);
  }
  if (representationIssues.length > 0) throw new ProjectExportContractError(representationIssues);

  let envelope: ProjectExportEnvelope<A>;
  try {
    envelope = JSON.parse(JSON.stringify(candidate)) as ProjectExportEnvelope<A>;
  } catch {
    throw new ProjectExportContractError([issue("$", "JSON 직렬화에 실패했습니다.")]);
  }
  const issues = await projectExportIssues(envelope);
  if (issues.length > 0) throw new ProjectExportContractError(issues);
  return envelope;
}
