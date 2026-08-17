export type TemplateId = "resume-match" | "schedule-builder" | "prompt-tuning";

export type StepId = "template" | "interview" | "criteria" | "run" | "result";

export type TemplateDefinition = {
  id: TemplateId;
  name: string;
  status: "active" | "soon";
  description: string;
  evaluation: string;
};

export type BlueprintItem = {
  label: string;
  value: string;
  state: "empty" | "draft" | "ready" | "locked";
};

export type Criteria = {
  id: string;
  title: string;
  kind: "deterministic" | "llm_judge";
  weight: number;
  description: string;
  locked: boolean;
};

export type ExperimentNode = {
  id: string;
  round: number;
  title: string;
  score: number;
  status: "accepted" | "rejected" | "running";
  note: string;
};
