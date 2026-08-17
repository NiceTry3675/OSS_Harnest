import type {
  EvaluationSuggestion,
  InterviewPayload,
  LoopSpec,
  RunResult,
} from "./types";
import {
  submitApprovedCriteria as submitApprovedCriteriaMock,
  submitInterviewDraft as submitInterviewDraftMock,
  uploadRunResult as uploadRunResultMock,
} from "./mock";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

export async function submitInterviewDraft(
  payload: InterviewPayload,
): Promise<EvaluationSuggestion> {
  if (!apiBaseUrl) {
    return submitInterviewDraftMock(payload);
  }

  const response = await fetch(`${apiBaseUrl}/interviews/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error("Failed to submit interview draft");
  }

  return response.json();
}

export async function submitApprovedCriteria(
  payload: InterviewPayload,
): Promise<LoopSpec> {
  if (!apiBaseUrl) {
    return submitApprovedCriteriaMock(payload);
  }

  const response = await fetch(`${apiBaseUrl}/interviews/approved`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error("Failed to submit approved criteria");
  }

  return response.json();
}

export async function uploadRunResult(result: RunResult) {
  if (!apiBaseUrl) {
    return uploadRunResultMock(result);
  }

  const response = await fetch(`${apiBaseUrl}/runs/${result.runId}/result`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(result),
  });

  if (!response.ok) {
    throw new Error("Failed to upload run result");
  }

  return response.json();
}
