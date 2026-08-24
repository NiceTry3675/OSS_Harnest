"""Harnest 선택형 저장 API — 저장·조회 전용, 임의 코드 실행 없음 (SPEC §7).

레거시 프로젝트 API는 호환성을 위해 유지한다. 정식 내보내기 봉투는 원문 JSON
바이트와 검색용 메타데이터만 저장하며, 판정 절차나 승인 의미를 해석·변경하지 않는다.
"""

import hashlib
import json
import math
import os
import re
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Dict, List, Tuple

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# 테스트가 임시 DB를 쓸 수 있도록 환경변수 우회 허용. 기본은 이 파일 옆 harnest.db
DB_PATH = os.environ.get(
    "HARNEST_DB", os.path.join(os.path.dirname(os.path.abspath(__file__)), "harnest.db")
)
WEB_ORIGIN = "http://localhost:5173"
MAX_EXPORT_BYTES = 1024 * 1024

app = FastAPI(title="Harnest API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[WEB_ORIGIN],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Location", "X-Content-SHA256"],
)

DB_SCHEMA_VERSION = 1
EXPORT_KIND = "harnest.project-export"
EXPORT_ENVELOPE_VERSION = 1
INTERVIEW_SCHEMA_VERSION = "skeleton-1"
PACK_VERSION = "skeleton-1"
SHA256_HEX_RE = re.compile(r"^[0-9a-f]{64}$")


@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with db() as conn:
        current_version = conn.execute("PRAGMA user_version").fetchone()[0]
        if current_version > DB_SCHEMA_VERSION:
            raise RuntimeError(
                f"지원하지 않는 DB 스키마 버전입니다: {current_version}"
            )

        # 기존 DB에도 테이블과 인덱스를 한 트랜잭션으로 추가한다. 레거시 행은 건드리지 않는다.
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(
            """CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                interview TEXT NOT NULL,
                pack TEXT NOT NULL,
                loop_spec TEXT NOT NULL,
                created_at TEXT NOT NULL
            )"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS project_exports (
                id TEXT PRIMARY KEY,
                envelope_version INTEGER NOT NULL,
                template_id TEXT NOT NULL,
                pack_version TEXT NOT NULL,
                definition_digest TEXT NOT NULL,
                run_id TEXT NOT NULL,
                payload BLOB NOT NULL,
                content_sha256 TEXT NOT NULL,
                created_at TEXT NOT NULL
            )"""
        )
        conn.execute(
            """CREATE INDEX IF NOT EXISTS idx_project_exports_digest_created
               ON project_exports(definition_digest, created_at DESC)"""
        )
        conn.execute(
            """CREATE INDEX IF NOT EXISTS idx_project_exports_template_created
               ON project_exports(template_id, created_at DESC)"""
        )
        conn.execute(
            """CREATE INDEX IF NOT EXISTS idx_project_exports_run
               ON project_exports(run_id) WHERE run_id IS NOT NULL"""
        )
        if current_version < DB_SCHEMA_VERSION:
            conn.execute(f"PRAGMA user_version = {DB_SCHEMA_VERSION}")
        conn.execute(
            """CREATE TABLE IF NOT EXISTS results (
                seq INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT NOT NULL REFERENCES projects(id),
                checkpoint TEXT NOT NULL,
                created_at TEXT NOT NULL
            )"""
        )


init_db()


class ProjectIn(BaseModel):
    interview: Dict[str, Any]
    pack: Dict[str, Any]
    loopSpec: Dict[str, Any]


class ResultIn(BaseModel):
    checkpoint: Dict[str, Any]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class DuplicateJsonKey(ValueError):
    pass


def reject_duplicate_keys(pairs: List[Tuple[str, Any]]) -> Dict[str, Any]:
    result: Dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise DuplicateJsonKey(f"중복 JSON 키입니다: {key}")
        result[key] = value
    return result


def reject_non_json_constant(value: str) -> None:
    raise ValueError(f"JSON 상수가 아닙니다: {value}")


def require_object(value: Any, path: str) -> Dict[str, Any]:
    if not isinstance(value, dict):
        raise HTTPException(status_code=422, detail=f"{path}는 객체여야 합니다.")
    return value


def require_nonempty_string(value: Any, path: str) -> str:
    if not isinstance(value, str) or not value:
        raise HTTPException(status_code=422, detail=f"{path}는 빈 문자열이 아니어야 합니다.")
    if any(0xD800 <= ord(character) <= 0xDFFF for character in value):
        raise HTTPException(status_code=422, detail=f"{path}에 잘못된 Unicode surrogate가 있습니다.")
    return value


def require_string(value: Any, path: str) -> str:
    if not isinstance(value, str):
        raise HTTPException(status_code=422, detail=f"{path}는 문자열이어야 합니다.")
    return value


def require_present_object_member(body: Dict[str, Any], key: str, path: str) -> Any:
    """`null`도 계약상 값일 수 있으므로, 값의 진실성이 아니라 키 존재만 확인한다."""
    if key not in body:
        raise HTTPException(status_code=422, detail=f"{path}가 필요합니다.")
    return body[key]


def require_nullable_object(value: Any, path: str) -> Dict[str, Any] | None:
    if value is None:
        return None
    return require_object(value, path)


def require_array(value: Any, path: str) -> List[Any]:
    if not isinstance(value, list):
        raise HTTPException(status_code=422, detail=f"{path}는 배열이어야 합니다.")
    return value


def require_number(value: Any, path: str) -> int | float:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or (isinstance(value, float) and not math.isfinite(value))
    ):
        raise HTTPException(status_code=422, detail=f"{path}는 숫자여야 합니다.")
    return value


def require_boolean(value: Any, path: str) -> bool:
    if not isinstance(value, bool):
        raise HTTPException(status_code=422, detail=f"{path}는 boolean이어야 합니다.")
    return value


def require_exact_members(body: Dict[str, Any], required: set[str], path: str) -> None:
    missing = required.difference(body)
    if missing:
        name = sorted(missing)[0]
        raise HTTPException(status_code=422, detail=f"{path}.{name}가 필요합니다.")
    unknown = set(body).difference(required)
    if unknown:
        name = sorted(unknown)[0]
        raise HTTPException(status_code=422, detail=f"{path}.{name}는 v1 계약 필드가 아닙니다.")


def require_string_array(value: Any, path: str) -> List[str]:
    items = require_array(value, path)
    for index, item in enumerate(items):
        require_string(item, f"{path}[{index}]")
    return items


def validate_well_formed_unicode(value: Any) -> None:
    pending = [value]
    while pending:
        item = pending.pop()
        if isinstance(item, str):
            if any(0xD800 <= ord(character) <= 0xDFFF for character in item):
                raise HTTPException(status_code=422, detail="짝이 맞지 않는 Unicode surrogate가 있습니다.")
        elif isinstance(item, list):
            pending.extend(item)
        elif isinstance(item, dict):
            pending.extend(item.keys())
            pending.extend(item.values())


def validate_pack_items(pack: Dict[str, Any]) -> None:
    criteria = require_array(pack.get("criteria"), "project.evaluation.pack.criteria")
    for index, value in enumerate(criteria):
        path = f"project.evaluation.pack.criteria[{index}]"
        criterion = require_object(value, path)
        require_exact_members(
            criterion, {"id", "kind", "scorer", "params", "weight", "label"}, path
        )
        require_string(criterion.get("id"), f"{path}.id")
        if criterion.get("kind") not in {"deterministic", "case_answering"}:
            raise HTTPException(status_code=422, detail=f"{path}.kind가 올바르지 않습니다.")
        require_string(criterion.get("scorer"), f"{path}.scorer")
        params = require_object(criterion.get("params"), f"{path}.params")
        for key, item in params.items():
            if not isinstance(key, str) or (
                not isinstance(item, str)
                and (isinstance(item, bool) or not isinstance(item, (int, float)))
            ):
                raise HTTPException(
                    status_code=422,
                    detail=f"{path}.params는 문자열 또는 숫자 값만 가져야 합니다.",
                )
            if isinstance(item, float) and not math.isfinite(item):
                raise HTTPException(status_code=422, detail=f"{path}.params 숫자가 유한하지 않습니다.")
        require_number(criterion.get("weight"), f"{path}.weight")
        require_string(criterion.get("label"), f"{path}.label")

    gates = require_array(pack.get("gates"), "project.evaluation.pack.gates")
    for index, value in enumerate(gates):
        path = f"project.evaluation.pack.gates[{index}]"
        gate = require_object(value, path)
        require_exact_members(
            gate, {"id", "kind", "scorer", "params", "effect", "label"}, path
        )
        require_string(gate.get("id"), f"{path}.id")
        if gate.get("kind") != "deterministic" or gate.get("effect") != "reject":
            raise HTTPException(status_code=422, detail=f"{path}의 kind/effect가 올바르지 않습니다.")
        require_string(gate.get("scorer"), f"{path}.scorer")
        params = require_object(gate.get("params"), f"{path}.params")
        for key, item in params.items():
            if not isinstance(key, str) or (
                not isinstance(item, str)
                and (isinstance(item, bool) or not isinstance(item, (int, float)))
            ):
                raise HTTPException(
                    status_code=422,
                    detail=f"{path}.params는 문자열 또는 숫자 값만 가져야 합니다.",
                )
            if isinstance(item, float) and not math.isfinite(item):
                raise HTTPException(status_code=422, detail=f"{path}.params 숫자가 유한하지 않습니다.")
        require_string(gate.get("label"), f"{path}.label")


def validate_examiner_report(value: Dict[str, Any], path: str) -> None:
    require_exact_members(value, {"checks", "overall", "forDigest", "judge", "ranAt"}, path)
    checks = require_array(value.get("checks"), f"{path}.checks")
    for index, item in enumerate(checks):
        item_path = f"{path}.checks[{index}]"
        check = require_object(item, item_path)
        require_exact_members(check, {"id", "verdict", "note"}, item_path)
        if check.get("id") not in {"ordering", "discrimination", "stability", "hack_resistance"}:
            raise HTTPException(status_code=422, detail=f"{item_path}.id가 올바르지 않습니다.")
        if check.get("verdict") not in {"pass", "warn", "fail"}:
            raise HTTPException(status_code=422, detail=f"{item_path}.verdict가 올바르지 않습니다.")
        require_string(check.get("note"), f"{item_path}.note")
    if value.get("overall") not in {"pass", "warn", "fail"}:
        raise HTTPException(status_code=422, detail=f"{path}.overall이 올바르지 않습니다.")
    require_string(value.get("forDigest"), f"{path}.forDigest")
    judge = require_object(value.get("judge"), f"{path}.judge")
    require_exact_members(judge, {"provider", "model"}, f"{path}.judge")
    if judge.get("provider") not in {"gemini", "openai", "mock"}:
        raise HTTPException(status_code=422, detail=f"{path}.judge.provider가 올바르지 않습니다.")
    require_string(judge.get("model"), f"{path}.judge.model")
    require_string(value.get("ranAt"), f"{path}.ranAt")


def validate_calibration(value: Dict[str, Any], path: str) -> None:
    require_exact_members(
        value, {"pairs", "verdict", "forDigest", "forReportAt", "ranAt"}, path
    )
    pairs = require_array(value.get("pairs"), f"{path}.pairs")
    for index, item in enumerate(pairs):
        item_path = f"{path}.pairs[{index}]"
        pair = require_object(item, item_path)
        require_exact_members(
            pair, {"id", "kind", "userChoice", "examinerChoice", "agreed"}, item_path
        )
        require_string(pair.get("id"), f"{item_path}.id")
        if pair.get("kind") not in {"quality", "hack_probe"}:
            raise HTTPException(status_code=422, detail=f"{item_path}.kind가 올바르지 않습니다.")
        if pair.get("userChoice") not in {"A", "B"} or pair.get("examinerChoice") not in {"A", "B"}:
            raise HTTPException(status_code=422, detail=f"{item_path}의 A/B 선택이 올바르지 않습니다.")
        require_boolean(pair.get("agreed"), f"{item_path}.agreed")
    if value.get("verdict") not in {"pass", "warn", "fail"}:
        raise HTTPException(status_code=422, detail=f"{path}.verdict가 올바르지 않습니다.")
    require_string(value.get("forDigest"), f"{path}.forDigest")
    require_string(value.get("forReportAt"), f"{path}.forReportAt")
    require_string(value.get("ranAt"), f"{path}.ranAt")


def validate_checkpoint_shape(checkpoint: Dict[str, Any]) -> None:
    path = "result.checkpoint"
    require_exact_members(
        checkpoint,
        {
            "runId",
            "packDigest",
            "status",
            "doneReason",
            "round",
            "champion",
            "championScore",
            "championViolations",
            "curve",
            "tree",
            "provenance",
            "rngState",
        },
        path,
    )
    require_number(checkpoint.get("round"), f"{path}.round")
    require_number(checkpoint.get("championScore"), f"{path}.championScore")
    require_string_array(checkpoint.get("championViolations"), f"{path}.championViolations")
    curve = require_array(checkpoint.get("curve"), f"{path}.curve")
    for index, score in enumerate(curve):
        require_number(score, f"{path}.curve[{index}]")
    tree = require_array(checkpoint.get("tree"), f"{path}.tree")
    for index, item in enumerate(tree):
        item_path = f"{path}.tree[{index}]"
        record = require_object(item, item_path)
        require_exact_members(
            record,
            {"round", "candidateScore", "championScore", "adopted", "gateRejected", "violations"},
            item_path,
        )
        require_number(record.get("round"), f"{item_path}.round")
        require_number(record.get("candidateScore"), f"{item_path}.candidateScore")
        require_number(record.get("championScore"), f"{item_path}.championScore")
        require_boolean(record.get("adopted"), f"{item_path}.adopted")
        require_boolean(record.get("gateRejected"), f"{item_path}.gateRejected")
        require_string_array(record.get("violations"), f"{item_path}.violations")
    provenance = require_array(checkpoint.get("provenance"), f"{path}.provenance")
    for index, item in enumerate(provenance):
        item_path = f"{path}.provenance[{index}]"
        entry = require_object(item, item_path)
        require_exact_members(entry, {"at", "type", "detail"}, item_path)
        require_string(entry.get("at"), f"{item_path}.at")
        if entry.get("type") not in {
            "run_started",
            "round",
            "adopted",
            "paused",
            "resumed",
            "finished",
            "plateau_stop",
        }:
            raise HTTPException(status_code=422, detail=f"{item_path}.type이 올바르지 않습니다.")
        require_string(entry.get("detail"), f"{item_path}.detail")
    require_number(checkpoint.get("rngState"), f"{path}.rngState")


def validate_holdout_evaluation(value: Dict[str, Any], path: str) -> None:
    require_exact_members(value, {"gateRejected", "score", "perCase", "violations"}, path)
    gate_rejected = require_boolean(value.get("gateRejected"), f"{path}.gateRejected")
    per_case = require_array(value.get("perCase"), f"{path}.perCase")
    require_string_array(value.get("violations"), f"{path}.violations")
    if gate_rejected:
        if value.get("score") is not None or per_case:
            raise HTTPException(status_code=422, detail=f"{path}의 게이트 기각 형태가 올바르지 않습니다.")
        return
    require_number(value.get("score"), f"{path}.score")
    for index, item in enumerate(per_case):
        item_path = f"{path}.perCase[{index}]"
        case = require_object(item, item_path)
        require_exact_members(case, {"caseId", "question", "score", "why", "caseType"}, item_path)
        require_string(case.get("caseId"), f"{item_path}.caseId")
        require_string(case.get("question"), f"{item_path}.question")
        require_number(case.get("score"), f"{item_path}.score")
        require_string(case.get("why"), f"{item_path}.why")
        if case.get("caseType") not in {"repeated", "new"}:
            raise HTTPException(status_code=422, detail=f"{item_path}.caseType이 올바르지 않습니다.")


async def read_export_payload(request: Request) -> bytes:
    # CORS 헤더는 응답 공개만 제어하고 단순 요청의 쓰기 자체를 막지 않는다.
    origin = request.headers.get("origin")
    if origin is not None and origin != WEB_ORIGIN:
        raise HTTPException(status_code=403, detail="허용하지 않는 Origin입니다.")

    media_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if media_type != "application/json":
        raise HTTPException(status_code=415, detail="Content-Type은 application/json이어야 합니다.")

    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            announced_size = int(content_length)
        except ValueError as error:
            raise HTTPException(status_code=400, detail="Content-Length가 올바르지 않습니다.") from error
        if announced_size < 0:
            raise HTTPException(status_code=400, detail="Content-Length가 올바르지 않습니다.")
        if announced_size > MAX_EXPORT_BYTES:
            raise HTTPException(status_code=413, detail="내보내기 기록이 너무 큽니다.")

    payload = bytearray()
    async for chunk in request.stream():
        payload.extend(chunk)
        if len(payload) > MAX_EXPORT_BYTES:
            raise HTTPException(status_code=413, detail="내보내기 기록이 너무 큽니다.")
    return bytes(payload)


def extract_export_metadata(
    value: Any,
) -> Tuple[int, str, str, str, str]:
    """저장 가능한 v1 봉투의 골격과 귀속만 확인한다.

    이 API는 원문 JSON을 exact-byte로 보존하는 저장소다. Pack 다이제스트 재계산,
    examiner/calibration 판정, checkpoint 곡선 같은 의미 검증은 브라우저의
    `packages/contracts` 생산자 계약이 권위다. 다만 불완전하거나 다른 Pack에 결속된
    레코드를 색인하지 않도록, 여기서는 v1 봉투의 필수 노드와 승인·실행 귀속은 확인한다.
    """
    body = require_object(value, "본문")
    require_exact_members(
        body, {"kind", "envelopeVersion", "exportedAt", "project", "result"}, "본문"
    )
    if body.get("kind") != EXPORT_KIND:
        raise HTTPException(status_code=422, detail="지원하지 않는 내보내기 종류입니다.")

    envelope_version = body.get("envelopeVersion")
    if type(envelope_version) is not int or envelope_version != EXPORT_ENVELOPE_VERSION:
        raise HTTPException(status_code=422, detail="지원하지 않는 봉투 버전입니다.")
    require_nonempty_string(body.get("exportedAt"), "exportedAt")

    project = require_object(body.get("project"), "project")
    require_exact_members(project, {"interview", "evaluation", "loopSpec"}, "project")
    interview = require_object(project.get("interview"), "project.interview")
    require_exact_members(
        interview, {"schemaVersion", "templateId", "answers"}, "project.interview"
    )
    if interview.get("schemaVersion") != INTERVIEW_SCHEMA_VERSION:
        raise HTTPException(status_code=422, detail="지원하지 않는 인터뷰 스키마 버전입니다.")
    interview_template_id = require_nonempty_string(
        interview.get("templateId"), "project.interview.templateId"
    )
    require_object(interview.get("answers"), "project.interview.answers")

    evaluation = require_object(project.get("evaluation"), "project.evaluation")
    require_exact_members(
        evaluation,
        {"pack", "examinerReport", "calibration", "approval"},
        "project.evaluation",
    )
    pack = require_object(evaluation.get("pack"), "project.evaluation.pack")
    require_exact_members(
        pack,
        {
            "packVersion",
            "templateId",
            "criteria",
            "gates",
            "judgeProcedure",
            "holdoutPolicy",
            "definitionDigest",
        },
        "project.evaluation.pack",
    )
    template_id = require_nonempty_string(
        pack.get("templateId"), "project.evaluation.pack.templateId"
    )
    if interview_template_id != template_id:
        raise HTTPException(
            status_code=422,
            detail="project.interview.templateId가 Pack의 templateId와 다릅니다.",
        )
    pack_version = pack.get("packVersion")
    if pack_version != PACK_VERSION:
        raise HTTPException(status_code=422, detail="지원하지 않는 Pack 버전입니다.")
    definition_digest = require_nonempty_string(
        pack.get("definitionDigest"), "project.evaluation.pack.definitionDigest"
    )
    if SHA256_HEX_RE.fullmatch(definition_digest) is None:
        raise HTTPException(
            status_code=422,
            detail="project.evaluation.pack.definitionDigest는 소문자 SHA-256이어야 합니다.",
        )

    validate_pack_items(pack)
    judge_procedure = require_object(
        pack.get("judgeProcedure"), "project.evaluation.pack.judgeProcedure"
    )
    judge_kind = judge_procedure.get("kind")
    if judge_kind == "deterministic_only":
        require_exact_members(
            judge_procedure,
            {"kind", "exemptions"},
            "project.evaluation.pack.judgeProcedure",
        )
        exemptions = require_object(
            judge_procedure.get("exemptions"),
            "project.evaluation.pack.judgeProcedure.exemptions",
        )
        require_exact_members(
            exemptions,
            {"examinerReport", "calibration", "pairwise"},
            "project.evaluation.pack.judgeProcedure.exemptions",
        )
        for exemption in ("examinerReport", "calibration", "pairwise"):
            require_string(
                exemptions.get(exemption),
                f"project.evaluation.pack.judgeProcedure.exemptions.{exemption}",
            )
    elif judge_kind == "case_answering":
        require_exact_members(
            judge_procedure,
            {"kind", "judge", "pairwiseNotice"},
            "project.evaluation.pack.judgeProcedure",
        )
        judge = require_object(
            judge_procedure.get("judge"),
            "project.evaluation.pack.judgeProcedure.judge",
        )
        require_exact_members(
            judge,
            {"provider", "model"},
            "project.evaluation.pack.judgeProcedure.judge",
        )
        if judge.get("provider") not in {"gemini", "openai", "mock"}:
            raise HTTPException(status_code=422, detail="지원하지 않는 저지 provider입니다.")
        require_nonempty_string(
            judge.get("model"), "project.evaluation.pack.judgeProcedure.judge.model"
        )
        require_string(
            judge_procedure.get("pairwiseNotice"),
            "project.evaluation.pack.judgeProcedure.pairwiseNotice",
        )
    else:
        raise HTTPException(status_code=422, detail="지원하지 않는 judgeProcedure.kind입니다.")
    holdout_policy = require_object(
        pack.get("holdoutPolicy"), "project.evaluation.pack.holdoutPolicy"
    )
    holdout_policy_mode = holdout_policy.get("mode")
    if holdout_policy_mode not in {"none", "auto_tail"}:
        raise HTTPException(status_code=422, detail="지원하지 않는 holdoutPolicy.mode입니다.")
    require_string(holdout_policy.get("note"), "project.evaluation.pack.holdoutPolicy.note")
    if holdout_policy_mode == "auto_tail":
        require_exact_members(
            holdout_policy,
            {"mode", "note", "holdoutCaseIds"},
            "project.evaluation.pack.holdoutPolicy",
        )
        require_string_array(
            holdout_policy.get("holdoutCaseIds"),
            "project.evaluation.pack.holdoutPolicy.holdoutCaseIds",
        )
    else:
        require_exact_members(
            holdout_policy, {"mode", "note"}, "project.evaluation.pack.holdoutPolicy"
        )

    # 판정 내용은 실행하지 않되, procedure discriminant가 선언한 nullable-object 형태는 고정한다.
    examiner_report = require_nullable_object(
        require_present_object_member(
            evaluation, "examinerReport", "project.evaluation.examinerReport"
        ),
        "project.evaluation.examinerReport",
    )
    calibration = require_nullable_object(
        require_present_object_member(
            evaluation, "calibration", "project.evaluation.calibration"
        ),
        "project.evaluation.calibration",
    )
    if judge_kind == "deterministic_only":
        if examiner_report is not None or calibration is not None:
            raise HTTPException(
                status_code=422,
                detail="결정적 전용 Pack에는 examinerReport와 calibration이 null이어야 합니다.",
            )
    elif examiner_report is None or calibration is None:
        raise HTTPException(
            status_code=422,
            detail="case_answering Pack에는 examinerReport와 calibration 객체가 필요합니다.",
        )
    else:
        validate_examiner_report(examiner_report, "project.evaluation.examinerReport")
        validate_calibration(calibration, "project.evaluation.calibration")
        if examiner_report.get("forDigest") != definition_digest:
            raise HTTPException(
                status_code=422,
                detail="project.evaluation.examinerReport.forDigest가 현재 Pack과 다릅니다.",
            )
        if calibration.get("forDigest") != definition_digest:
            raise HTTPException(
                status_code=422,
                detail="project.evaluation.calibration.forDigest가 현재 Pack과 다릅니다.",
            )
        if calibration.get("forReportAt") != examiner_report.get("ranAt"):
            raise HTTPException(
                status_code=422,
                detail="project.evaluation.calibration.forReportAt가 현재 리포트와 다릅니다.",
            )
        report_judge = examiner_report["judge"]
        pack_judge = judge_procedure["judge"]
        if report_judge.get("provider") != pack_judge.get("provider") or (
            pack_judge.get("provider") != "mock"
            and report_judge.get("model") != pack_judge.get("model")
        ):
            raise HTTPException(
                status_code=422,
                detail="project.evaluation.examinerReport.judge가 현재 Pack과 다릅니다.",
            )
    approval = require_object(evaluation.get("approval"), "project.evaluation.approval")
    require_exact_members(
        approval, {"forDigest", "approvedAt"}, "project.evaluation.approval"
    )
    approval_digest = require_nonempty_string(
        approval.get("forDigest"), "project.evaluation.approval.forDigest"
    )
    if approval_digest != definition_digest:
        raise HTTPException(
            status_code=422,
            detail="project.evaluation.approval.forDigest가 현재 Pack과 다릅니다.",
        )
    require_nonempty_string(approval.get("approvedAt"), "project.evaluation.approval.approvedAt")

    loop_spec = require_object(project.get("loopSpec"), "project.loopSpec")
    require_exact_members(
        loop_spec, {"maxRounds", "plateauRounds", "adoptionRule", "seed"}, "project.loopSpec"
    )
    require_number(loop_spec.get("maxRounds"), "project.loopSpec.maxRounds")
    require_number(loop_spec.get("plateauRounds"), "project.loopSpec.plateauRounds")
    if loop_spec.get("adoptionRule") != "scalar_strict":
        raise HTTPException(status_code=422, detail="project.loopSpec.adoptionRule이 올바르지 않습니다.")
    require_number(loop_spec.get("seed"), "project.loopSpec.seed")

    result = require_object(body.get("result"), "result")
    require_exact_members(result, {"checkpoint", "holdout"}, "result")
    checkpoint = require_object(result.get("checkpoint"), "result.checkpoint")
    validate_checkpoint_shape(checkpoint)
    run_id = require_nonempty_string(
        checkpoint.get("runId"), "result.checkpoint.runId"
    )
    checkpoint_digest = require_nonempty_string(
        checkpoint.get("packDigest"), "result.checkpoint.packDigest"
    )
    if checkpoint_digest != definition_digest:
        raise HTTPException(
            status_code=422,
            detail="result.checkpoint.packDigest가 현재 Pack과 다릅니다.",
        )

    if checkpoint.get("status") != "done":
        raise HTTPException(status_code=422, detail="완료된 checkpoint만 저장할 수 있습니다.")
    if checkpoint.get("doneReason") not in {"max_rounds", "plateau"}:
        raise HTTPException(status_code=422, detail="완료 checkpoint에는 doneReason이 필요합니다.")
    holdout = require_object(result.get("holdout"), "result.holdout")
    if holdout_policy_mode == "none":
        require_exact_members(holdout, {"mode"}, "result.holdout")
        if holdout.get("mode") != "none":
            raise HTTPException(status_code=422, detail="holdoutPolicy=none에는 result.holdout.mode=none이 필요합니다.")
    else:
        require_exact_members(holdout, {"mode", "baseline", "final"}, "result.holdout")
        if holdout.get("mode") != "measured":
            raise HTTPException(status_code=422, detail="홀드아웃 Pack에는 측정 결과가 필요합니다.")
        for phase in ("baseline", "final"):
            phase_record = require_object(holdout.get(phase), f"result.holdout.{phase}")
            status = phase_record.get("status")
            if status == "scored":
                require_exact_members(
                    phase_record, {"status", "evaluation"}, f"result.holdout.{phase}"
                )
                phase_evaluation = require_object(
                    phase_record.get("evaluation"),
                    f"result.holdout.{phase}.evaluation",
                )
                validate_holdout_evaluation(
                    phase_evaluation, f"result.holdout.{phase}.evaluation"
                )
            elif status == "failed":
                require_exact_members(
                    phase_record, {"status", "error"}, f"result.holdout.{phase}"
                )
                require_nonempty_string(
                    phase_record.get("error"), f"result.holdout.{phase}.error"
                )
            else:
                raise HTTPException(
                    status_code=422,
                    detail=f"result.holdout.{phase}.status가 올바르지 않습니다.",
                )

    return envelope_version, template_id, pack_version, definition_digest, run_id


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/exports")
async def create_export(request: Request) -> JSONResponse:
    payload = await read_export_payload(request)
    try:
        text = payload.decode("utf-8")
        value = json.loads(
            text,
            object_pairs_hook=reject_duplicate_keys,
            parse_constant=reject_non_json_constant,
        )
    except (UnicodeDecodeError, ValueError, RecursionError) as error:
        raise HTTPException(
            status_code=422,
            detail="유효한 중복 없는 UTF-8 JSON이 아닙니다.",
        ) from error

    validate_well_formed_unicode(value)

    envelope_version, template_id, pack_version, definition_digest, run_id = (
        extract_export_metadata(value)
    )
    export_id = str(uuid.uuid4())
    stored_at = now_iso()
    content_sha256 = hashlib.sha256(payload).hexdigest()
    with db() as conn:
        conn.execute(
            """INSERT INTO project_exports (
                   id, envelope_version, template_id, pack_version, definition_digest,
                   run_id, payload, content_sha256, created_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                export_id,
                envelope_version,
                template_id,
                pack_version,
                definition_digest,
                run_id,
                sqlite3.Binary(payload),
                content_sha256,
                stored_at,
            ),
        )

    return JSONResponse(
        status_code=201,
        content={
            "id": export_id,
            "storedAt": stored_at,
            "contentSha256": content_sha256,
        },
        headers={"Location": f"/exports/{export_id}"},
    )


@app.get("/exports/{export_id}")
def get_export(export_id: str) -> Response:
    with db() as conn:
        row = conn.execute(
            "SELECT payload, content_sha256 FROM project_exports WHERE id = ?",
            (export_id,),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="내보내기 기록이 없습니다.")
    return Response(
        content=bytes(row[0]),
        media_type="application/json",
        headers={"X-Content-SHA256": row[1]},
    )


@app.post("/projects")
def create_project(body: ProjectIn) -> Dict[str, str]:
    project_id = str(uuid.uuid4())
    with db() as conn:
        conn.execute(
            "INSERT INTO projects (id, interview, pack, loop_spec, created_at) VALUES (?, ?, ?, ?, ?)",
            (
                project_id,
                json.dumps(body.interview, ensure_ascii=False),
                json.dumps(body.pack, ensure_ascii=False),
                json.dumps(body.loopSpec, ensure_ascii=False),
                now_iso(),
            ),
        )
    return {"id": project_id}


@app.get("/projects/{project_id}")
def get_project(project_id: str) -> Dict[str, Any]:
    with db() as conn:
        row = conn.execute(
            "SELECT id, interview, pack, loop_spec, created_at FROM projects WHERE id = ?",
            (project_id,),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="프로젝트가 없습니다.")
    return {
        "id": row[0],
        "interview": json.loads(row[1]),
        "pack": json.loads(row[2]),
        "loopSpec": json.loads(row[3]),
        "createdAt": row[4],
    }


@app.post("/projects/{project_id}/results")
def upload_result(project_id: str, body: ResultIn) -> Dict[str, bool]:
    with db() as conn:
        exists = conn.execute(
            "SELECT 1 FROM projects WHERE id = ?", (project_id,)
        ).fetchone()
        if exists is None:
            raise HTTPException(status_code=404, detail="프로젝트가 없습니다.")
        conn.execute(
            "INSERT INTO results (project_id, checkpoint, created_at) VALUES (?, ?, ?)",
            (project_id, json.dumps(body.checkpoint, ensure_ascii=False), now_iso()),
        )
    return {"ok": True}
