import { criteria, experimentNodes } from "@/lib/mock-data";
import type {
  EvaluationSuggestion,
  InterviewPayload,
  LoopSpec,
  RunResult,
} from "./types";

export async function submitInterviewDraft(
  payload: InterviewPayload,
): Promise<EvaluationSuggestion> {
  void payload;

  return {
    projectId: "mock-project-resume-match",
    criteria,
  };
}

export async function submitApprovedCriteria(
  payload: InterviewPayload,
): Promise<LoopSpec> {
  void payload;

  return {
    projectId: "mock-project-resume-match",
    runId: "mock-run-001",
    criteriaLocked: true,
    maxIterations: 30,
  };
}

export async function uploadRunResult(result: RunResult) {
  void result;

  return {
    projectId: "mock-project-resume-match",
    shareUrl: null,
  };
}

export function getMockRunResult(): RunResult {
  return {
    runId: "mock-run-001",
    startScore: 62,
    finalScore: 78,
    nodes: experimentNodes,
  };
}
