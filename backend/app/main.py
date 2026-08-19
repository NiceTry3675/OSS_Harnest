from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .lite_engine import create_evaluation_suggestion, create_loop_spec, run_lite_loop
from .schemas import (
    EvaluationSuggestion,
    InterviewPayload,
    LoopSpec,
    ResultUploadResponse,
    RunResult,
)

app = FastAPI(title="Harnest Lite API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

run_store: dict[str, RunResult] = {}
approved_payload_store: dict[str, InterviewPayload] = {}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/interviews/draft", response_model=EvaluationSuggestion)
def create_interview_draft(payload: InterviewPayload) -> EvaluationSuggestion:
    if payload.evaluation is not None:
        raise HTTPException(status_code=400, detail="draft request must use evaluation: null")

    return create_evaluation_suggestion(payload)


@app.post("/api/interviews/approved", response_model=LoopSpec)
def approve_interview(payload: InterviewPayload) -> LoopSpec:
    try:
        loop_spec = create_loop_spec(payload)
        approved_payload_store[loop_spec.runId] = payload
        return loop_spec
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/api/runs", response_model=RunResult)
def start_run(loop_spec: LoopSpec) -> RunResult:
    payload = approved_payload_store.get(loop_spec.runId)

    if payload is None:
        raise HTTPException(status_code=404, detail="approved interview payload not found")

    result = run_lite_loop(loop_spec, payload)
    run_store[result.runId] = result
    return result


@app.get("/api/runs/{run_id}", response_model=RunResult)
def get_run(run_id: str) -> RunResult:
    result = run_store.get(run_id)

    if result is None:
        raise HTTPException(status_code=404, detail="run not found")

    return result


@app.post("/api/runs/{run_id}/result", response_model=ResultUploadResponse)
def upload_run_result(run_id: str, result: RunResult) -> ResultUploadResponse:
    run_store[run_id] = result
    project_id = next(
        (
            loop_payload.projectId
            for stored_run_id, loop_payload in approved_payload_store.items()
            if stored_run_id == run_id and loop_payload.projectId is not None
        ),
        "local-project",
    )
    return ResultUploadResponse(projectId=project_id, shareUrl=None)
