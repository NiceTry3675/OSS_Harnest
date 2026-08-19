from typing import Any, Literal

from pydantic import BaseModel, Field


class Criteria(BaseModel):
    id: str
    title: str
    kind: Literal["deterministic", "llm_judge"]
    weight: float
    description: str
    locked: bool = False


class InterviewPayload(BaseModel):
    schemaVersion: str
    projectId: str | None = None
    template: dict[str, Any]
    mode: Literal["lite", "advanced"]
    goal: str
    artifact: dict[str, Any]
    answers: dict[str, Any]
    evaluation: dict[str, Any] | None = None
    loop: dict[str, Any]
    client: dict[str, Any]


class EvaluationSuggestion(BaseModel):
    projectId: str
    criteria: list[Criteria]


class StopCondition(BaseModel):
    targetScore: int | None = None
    plateauRounds: int = 8


class LoopSpec(BaseModel):
    projectId: str
    runId: str
    criteriaLocked: Literal[True] = True
    maxIterations: int
    stop: StopCondition
    llmRoute: Literal["trial", "byok"]


class ExperimentNode(BaseModel):
    id: str
    round: int
    title: str
    score: int
    status: Literal["accepted", "rejected", "running"]
    note: str


class DiffSummary(BaseModel):
    before: str
    after: str


class RunResult(BaseModel):
    runId: str
    startScore: int
    finalScore: int
    nodes: list[ExperimentNode]
    diff: DiffSummary
    finalArtifact: str


class ResultUploadResponse(BaseModel):
    projectId: str
    shareUrl: str | None = Field(default=None)
