/** 결과 화면의 현재 상태를 정식 기록 봉투로 바꾸고 JSON 파일로 내보낸다. */

import {
  createProjectExportEnvelope,
  type EvaluationPack,
  type ExaminerReport,
  type HoldoutPhaseRecord,
  type HoldoutRecord,
  type HoldoutScores,
  type LoopCheckpoint,
  type ProjectExportEnvelope,
  ProjectExportContractError,
} from "@harnest/contracts";
import type { CompiledGeneric } from "../state";

export interface ProjectExportSource<A = unknown> {
  compiled: CompiledGeneric;
  answers: Record<string, unknown>;
  examinerReport: ExaminerReport | null;
  /** 승인 순간 캡처한 값이어야 한다. 현재 Pack에서 다시 파생하지 않는다. */
  approvedDigest: string;
  approvedAt: string;
  checkpoint: LoopCheckpoint<A>;
  holdout: HoldoutScores;
  exportedAt?: string;
}

function phaseSettled(holdout: HoldoutScores, phase: "baseline" | "final"): boolean {
  const hasEvaluation = holdout[phase] !== null;
  const hasError = Boolean(holdout.errors?.[phase]?.trim());
  return hasEvaluation !== hasError;
}

/** 결과도 실패 사유도 없어 실제 채점 호출이 필요한 단계인지 판별한다. */
export function isHoldoutPhasePending(
  holdout: HoldoutScores,
  phase: "baseline" | "final",
): boolean {
  return holdout[phase] === null && !holdout.errors?.[phase]?.trim();
}

export function isHoldoutSettled(pack: EvaluationPack, holdout: HoldoutScores): boolean {
  return (
    pack.holdoutPolicy.mode === "none" ||
    (phaseSettled(holdout, "baseline") && phaseSettled(holdout, "final"))
  );
}

export type HoldoutPhase = "baseline" | "final";

/** 이 체크포인트 통지에서 채점을 시작해야 하는 홀드아웃 단계 — 라운드 0이면 시작, 완료면 종료
 *  (라운드 0에서 곧바로 완료되면 둘 다). 이미 결과나 실패 사유가 있는 단계는 돌려주지 않는다.
 *  "같은 통지에 두 번 시작하지 않기"(started 플래그)는 호출자의 몫이다 — 여기서는 시점 규칙만
 *  판단한다(SPEC §3 원칙 7: 홀드아웃은 라운드 0과 종료 시에만). */
export function holdoutPhaseToScore(
  checkpoint: Pick<LoopCheckpoint<unknown>, "round" | "status">,
  holdout: HoldoutScores,
): HoldoutPhase[] {
  const phases: HoldoutPhase[] = [];
  if (checkpoint.round === 0 && isHoldoutPhasePending(holdout, "baseline")) phases.push("baseline");
  if (checkpoint.status === "done" && isHoldoutPhasePending(holdout, "final")) phases.push("final");
  return phases;
}

/** 새로고침 뒤 완료 챔피언으로 다시 계산할 수 있는 홀드아웃 단계가 남았는지 판별한다. */
export function needsRestoredHoldoutRecovery(
  pack: EvaluationPack,
  checkpoint: LoopCheckpoint<unknown> | null,
  holdout: HoldoutScores,
): boolean {
  return (
    pack.holdoutPolicy.mode !== "none" &&
    checkpoint?.status === "done" &&
    (isHoldoutPhasePending(holdout, "final") ||
      (checkpoint.round === 0 && isHoldoutPhasePending(holdout, "baseline")))
  );
}

function holdoutPhaseRecord(
  holdout: HoldoutScores,
  phase: "baseline" | "final",
): HoldoutPhaseRecord {
  const evaluation = holdout[phase];
  const error = holdout.errors?.[phase]?.trim();
  if (evaluation !== null && error) {
    throw new ProjectExportContractError([
      { path: `result.holdout.${phase}`, message: "채점 결과와 실패 사유를 동시에 기록할 수 없습니다." },
    ]);
  }
  if (evaluation !== null) return { status: "scored", evaluation };
  if (error) return { status: "failed", error };
  throw new ProjectExportContractError([
    { path: `result.holdout.${phase}`, message: "최종 확인 채점이 아직 끝나지 않았습니다." },
  ]);
}

function holdoutRecord(pack: EvaluationPack, holdout: HoldoutScores): HoldoutRecord {
  if (pack.holdoutPolicy.mode === "none") return { mode: "none" };
  return {
    mode: "measured",
    baseline: holdoutPhaseRecord(holdout, "baseline"),
    final: holdoutPhaseRecord(holdout, "final"),
  };
}

/** 명시한 상태만 복사한다. localStorage는 접근하지 않는다. */
export async function buildProjectExport<A>(
  source: ProjectExportSource<A>,
): Promise<ProjectExportEnvelope<A>> {
  return createProjectExportEnvelope({
    exportedAt: source.exportedAt ?? new Date().toISOString(),
    project: {
      interview: {
        schemaVersion: "skeleton-1",
        templateId: source.compiled.pack.templateId,
        answers: source.answers,
      },
      evaluation: {
        pack: source.compiled.pack,
        examinerReport: source.examinerReport,
        approval: {
          forDigest: source.approvedDigest,
          approvedAt: source.approvedAt,
        },
      },
      loopSpec: source.compiled.loopSpec,
    },
    result: {
      checkpoint: source.checkpoint,
      holdout: holdoutRecord(source.compiled.pack, source.holdout),
    },
  });
}

export function serializeProjectExport(envelope: ProjectExportEnvelope): string {
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

export function projectExportFilename(envelope: ProjectExportEnvelope): string {
  return `harnest-${envelope.project.evaluation.pack.definitionDigest.slice(0, 8)}.json`;
}

export function downloadProjectExport(
  envelope: ProjectExportEnvelope,
  serialized: string = serializeProjectExport(envelope),
): void {
  const blob = new Blob([serialized], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = projectExportFilename(envelope);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
