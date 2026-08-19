import type {
  EvaluationSuggestion,
  InterviewPayload,
  LoopSpec,
  RunResult,
} from "./types";

const keys = {
  interviewPayload: "harnest.interviewPayload",
  evaluationSuggestion: "harnest.evaluationSuggestion",
  loopSpec: "harnest.loopSpec",
  runResult: "harnest.runResult",
};

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") {
    return null;
  }

  const value = window.localStorage.getItem(key);

  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function writeJson<T>(key: string, value: T) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

export const harnestStorage = {
  getInterviewPayload: () => readJson<InterviewPayload>(keys.interviewPayload),
  setInterviewPayload: (payload: InterviewPayload) =>
    writeJson(keys.interviewPayload, payload),
  getEvaluationSuggestion: () =>
    readJson<EvaluationSuggestion>(keys.evaluationSuggestion),
  setEvaluationSuggestion: (suggestion: EvaluationSuggestion) =>
    writeJson(keys.evaluationSuggestion, suggestion),
  getLoopSpec: () => readJson<LoopSpec>(keys.loopSpec),
  setLoopSpec: (loopSpec: LoopSpec) => writeJson(keys.loopSpec, loopSpec),
  getRunResult: () => readJson<RunResult>(keys.runResult),
  setRunResult: (result: RunResult) => writeJson(keys.runResult, result),
  clearExecution: () => {
    window.localStorage.removeItem(keys.loopSpec);
    window.localStorage.removeItem(keys.runResult);
  },
};
