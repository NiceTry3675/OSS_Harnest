import type {
  EvaluationSuggestion,
  InterviewPayload,
  LoopSpec,
  ResultUploadResponse,
  RunResult,
} from "./types";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;

function apiUrl(path: string) {
  if (!apiBaseUrl) {
    throw new Error("VITE_API_BASE_URL is required for the E2E API flow");
  }

  return `${apiBaseUrl?.replace(/\/$/, "")}${path}`;
}

export async function submitInterviewDraft(
  payload: InterviewPayload,
): Promise<EvaluationSuggestion> {
  const response = await fetch(apiUrl("/interviews/draft"), {
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
  const response = await fetch(apiUrl("/interviews/approved"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error("Failed to submit approved criteria");
  }

  return response.json();
}

export async function startRun(loopSpec: LoopSpec): Promise<RunResult> {
  const response = await fetch(apiUrl("/runs"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(loopSpec),
  });

  if (!response.ok) {
    throw new Error("Failed to start run");
  }

  return response.json();
}

export async function getRun(runId: string): Promise<RunResult> {
  const response = await fetch(apiUrl(`/runs/${runId}`));

  if (!response.ok) {
    throw new Error("Failed to get run");
  }

  return response.json();
}

export async function uploadRunResult(
  result: RunResult,
): Promise<ResultUploadResponse> {
  const response = await fetch(apiUrl(`/runs/${result.runId}/result`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(result),
  });

  if (!response.ok) {
    throw new Error("Failed to upload run result");
  }

  return response.json();
}
