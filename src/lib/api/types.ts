import type { Criteria, ExperimentNode } from "@/lib/types";

export type InterviewPayload = {
  schemaVersion: "0.1.0";
  projectId: string | null;
  template: {
    id: "resume-match";
    version: "1.0.0";
  };
  mode: "lite";
  goal: string;
  artifact: {
    type: "text";
    label: string;
    content: string;
    origin: "user" | "generated";
  };
  answers: Record<string, { type: string; value: string | number | string[] }>;
  evaluation: null | {
    status: "approved";
    approvedAt: string;
    criteria: Criteria[];
  };
  loop: {
    maxIterations: number;
    llmRoute: "trial" | "byok";
    branching: { width: number };
    critic: boolean;
    stop: {
      targetScore: number | null;
      plateauRounds: number;
    };
  };
  client: {
    locale: "ko";
    submittedAt: string;
  };
};

export type EvaluationSuggestion = {
  projectId: string;
  criteria: Criteria[];
};

export type LoopSpec = {
  projectId: string;
  runId: string;
  criteriaLocked: true;
  maxIterations: number;
};

export type RunResult = {
  runId: string;
  startScore: number;
  finalScore: number;
  nodes: ExperimentNode[];
};
