"""Harnest 선택형 저장 API — 저장·조회 전용, 임의 코드 실행 없음 (SPEC §7).

레거시 프로젝트 API는 호환성을 위해 유지한다. 정식 내보내기 봉투는 원문 JSON
바이트와 검색용 메타데이터만 저장하며, 판정 절차나 승인 의미를 해석·변경하지 않는다.

이 서버는 기본적으로 벤더 모델 호출을 중계하지 않는다(SPEC §3 원칙 1 — BYO 키는
브라우저에서 벤더로 직행). `/proxy/*`는 관리자가 자신의 벤더 키를 서버 환경변수에
설정했을 때만 열리는 예외 경로다. 사용자가 자기 키를 넣지 않아도 그 벤더를 쓸 수
있게 하되, 관리자의 계정으로 요청과 비용이 발생하므로 IP별 시간당 한도로 막는다.
"""

import hashlib
import json
import logging
import math
import os
import re
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Dict, List, Tuple

import httpx
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from ratelimit import build_rate_limiter

# 테스트가 임시 DB를 쓸 수 있도록 환경변수 우회 허용. 기본은 이 파일 옆 harnest.db
DB_PATH = os.environ.get(
    "HARNEST_DB", os.path.join(os.path.dirname(os.path.abspath(__file__)), "harnest.db")
)
MAX_EXPORT_BYTES = 1024 * 1024
# DB 파일 총량 상한(바이트). SQLite의 max_page_count로 강제해 볼륨이 꽉 차 500이 나기 전에 507로 막는다.
DB_MAX_BYTES = int(os.environ.get("HARNEST_DB_MAX_BYTES", str(800 * 1024 * 1024)))
# POST /exports의 IP당 시간당 저장 횟수 상한 — 프록시 한도와 별도 버킷("exports:<ip>")을 쓴다.
EXPORT_RATE_LIMIT_PER_HOUR = int(os.environ.get("HARNEST_EXPORT_RATE_LIMIT", "30"))

logger = logging.getLogger("harnest.api")

app = FastAPI(title="Harnest API", version="0.1.0")


def _cors_origins() -> List[str]:
    """쉼표로 구분한 허용 오리진 목록. 기본은 로컬 웹 앱뿐이다 — 배포 출처는 배포 설정(fly.toml [env])에서 넣는다."""
    raw = os.environ.get("HARNEST_CORS_ORIGINS", "http://localhost:5173")
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


ALLOWED_ORIGINS = set(_cors_origins())

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(ALLOWED_ORIGINS),
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Location", "X-Content-SHA256"],
)

DB_SCHEMA_VERSION = 1
EXPORT_KIND = "harnest.project-export"
EXPORT_ENVELOPE_VERSION = 3
INTERVIEW_SCHEMA_VERSION = "skeleton-1"
PACK_VERSION = "skeleton-1"
SHA256_HEX_RE = re.compile(r"^[0-9a-f]{64}$")
JUDGE_PROVIDERS = {
    "gemini",
    "vertex",
    "openai",
    "anthropic",
    "openrouter",
    "ollama",
    "mock",
}
# 아래 목록은 packages/contracts/src/loop.ts의 사본이다. 계약이 늘어나면 여기도 같이 늘려야
# 브라우저가 정상 생산한 봉투를 서버가 422로 거부하는 일이 없다.
DONE_REASONS = {"max_rounds", "plateau", "ceiling"}  # LoopCheckpoint.doneReason
PROVENANCE_TYPES = {  # ProvenanceType
    "run_started",
    "round",
    "adopted",
    "paused",
    "resumed",
    "finished",
    "plateau_stop",
    "ceiling_stop",
    "error",
}
FEEDBACK_MODES = {  # LoopSpec.feedbackMode
    "champion_only",
    "champion_and_last_public_rejection",
    "recent_public_experiments_v1",
}
SCORE_CEILING = 100  # 동결 스칼라 척도의 상한 — ceiling 종료는 챔피언이 여기 도달했을 때만 성립한다
# ExperimentStrategy 검증 규칙 — packages/contracts/src/storage.ts의 것을 그대로 옮겼다.
_STRATEGY_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
STRATEGY_SUMMARY_MAX_CHARS = 500
rate_limiter = build_rate_limiter()

# 관리자가 설정하지 않으면 빈 문자열이고, /proxy/* 해당 벤더는 404로 막는다.
SHARED_OPENAI_API_KEY = os.environ.get("SHARED_OPENAI_API_KEY", "")
SHARED_GEMINI_API_KEY = os.environ.get("SHARED_GEMINI_API_KEY", "")
PROXY_RATE_LIMIT_PER_HOUR = int(os.environ.get("HARNEST_PROXY_RATE_LIMIT", "20"))
_MODEL_NAME_RE = re.compile(r"^[a-zA-Z0-9._-]{1,100}$")


def _model_allowlist(env_name: str, default: str) -> set:
    """쉼표로 구분한 허용 모델 목록. 공유 키는 관리자 계정에서 과금되므로 방문자가 모델을 고르지 못하게 한다."""
    raw = os.environ.get(env_name, default)
    return {name.strip() for name in raw.split(",") if name.strip()}


SHARED_OPENAI_MODELS = _model_allowlist("SHARED_OPENAI_MODELS", "gpt-5.6-sol")
SHARED_GEMINI_MODELS = _model_allowlist("SHARED_GEMINI_MODELS", "gemini-3.8-flash")
# 한 요청이 낼 수 있는 출력 토큰 상한 — 인수인계 최대 분량(2만 자) 생성에도 충분하고, 그 이상은 폭주다.
PROXY_MAX_OUTPUT_TOKENS = int(os.environ.get("HARNEST_PROXY_MAX_OUTPUT_TOKENS", "65536"))
PROXY_MAX_BODY_BYTES = MAX_EXPORT_BYTES
# 상류(벤더) 응답을 기다리는 시간(초)의 바닥. 실제 읽기 한도는 요청마다 출력 토큰 상한(잘린 값)에
# 비례해 늘린다 — 브라우저 클라이언트가 한 번에 받는 호출에 쓰는 산식(토큰당 30ms, 최소 5분)과 같고,
# 공유 경로의 브라우저 클라이언트는 여기에 60초 여유를 더해 기다리므로(클라이언트 타이머는 요청 전에,
# 이쪽 타이머는 벤더에 쓴 뒤에 시작된다) 시간 초과는 이 서버의 504가 먼저 알린다. 서버가 끊어도 벤더 쪽
# 생성·과금은 완주한다. 클라이언트는 504도, 자기 시간 초과도, 네트워크 단절도 재시도하지 않는다 —
# 끊긴 생성도 벤더 쪽에서는 완주·과금되므로 다시 보내면 관리자 비용만 반복된다.
# 비례 한도에는 상한(HARNEST_PROXY_MAX_TIMEOUT)이 있다 — 이 서버는 상류 응답을 다 받은 뒤에야 첫
# 바이트를 보내므로, 배포 edge·리버스 프록시의 유휴 한도(fly.toml의 idle_timeout, Fly 최댓값 900초)가
# 브라우저 대기 시간(읽기 한도 + 60초)보다 짧으면 edge가 먼저 연결을 끊고 504가 사용자에게 닿지
# 않는다. 그래서 읽기 한도는 edge 한도 − 60초(브라우저 여유) − 60초(edge 여유) = 780초에서 멈춘다.
# 상한을 올리면 edge 한도도 그보다 60초 이상 크게 함께 올려야 한다. 브라우저 클라이언트도 같은
# 상한을 안다(apps/web/src/lib/llm.ts).
PROXY_UPSTREAM_TIMEOUT_SECONDS = float(os.environ.get("HARNEST_PROXY_TIMEOUT", "300"))
PROXY_UPSTREAM_TIMEOUT_CEILING_SECONDS = float(os.environ.get("HARNEST_PROXY_MAX_TIMEOUT", "780"))
PROXY_SECONDS_PER_OUTPUT_TOKEN = 0.03


def _upstream_read_timeout(max_output_tokens: int) -> float:
    """요청의 출력 토큰 상한에 비례한 읽기 한도 — 바닥은 HARNEST_PROXY_TIMEOUT, 상한은
    HARNEST_PROXY_MAX_TIMEOUT(edge 유휴 한도 아래). 상한이 바닥보다 작으면 상한이 이긴다."""
    proportional = max(PROXY_UPSTREAM_TIMEOUT_SECONDS, max_output_tokens * PROXY_SECONDS_PER_OUTPUT_TOKEN)
    return min(proportional, PROXY_UPSTREAM_TIMEOUT_CEILING_SECONDS)
# 방문자 IP를 읽을 신뢰 헤더 이름(소문자). 미설정이면 접속 소켓 IP만 쓴다 — 리버스 프록시가 붙이는
# 헤더라도 그 프록시 뒤에 있지 않은 배포에서는 클라이언트가 마음대로 꾸밀 수 있기 때문이다.
TRUSTED_IP_HEADER = os.environ.get("HARNEST_TRUSTED_IP_HEADER", "").strip().lower()


@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    # 총량 상한은 연결마다 다시 걸어야 한다. 이미 상한보다 큰 DB는 현재 크기로 고정되어 더는 늘지 않는다.
    page_size = conn.execute("PRAGMA page_size").fetchone()[0]
    conn.execute(f"PRAGMA max_page_count = {max(1, DB_MAX_BYTES // page_size)}")
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


def require_nullable_number(value: Any, path: str) -> int | float | None:
    if value is None:
        return None
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or (isinstance(value, float) and not math.isfinite(value))
    ):
        raise HTTPException(status_code=422, detail=f"{path}는 null이거나 숫자여야 합니다.")
    return value


def require_boolean(value: Any, path: str) -> bool:
    if not isinstance(value, bool):
        raise HTTPException(status_code=422, detail=f"{path}는 boolean이어야 합니다.")
    return value


def require_exact_members(
    body: Dict[str, Any],
    required: set[str],
    path: str,
    optional: frozenset[str] = frozenset(),
) -> None:
    """required는 모두 있어야 하고, optional 밖의 알 수 없는 키는 거부한다."""
    missing = required.difference(body)
    if missing:
        name = sorted(missing)[0]
        raise HTTPException(status_code=422, detail=f"{path}.{name}가 필요합니다.")
    unknown = set(body).difference(required).difference(optional)
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
        if check.get("id") not in {"stability", "hack_resistance"}:
            raise HTTPException(status_code=422, detail=f"{item_path}.id가 올바르지 않습니다.")
        if check.get("verdict") not in {"pass", "warn", "fail"}:
            raise HTTPException(status_code=422, detail=f"{item_path}.verdict가 올바르지 않습니다.")
        require_string(check.get("note"), f"{item_path}.note")
    if value.get("overall") not in {"pass", "warn", "fail"}:
        raise HTTPException(status_code=422, detail=f"{path}.overall이 올바르지 않습니다.")
    require_string(value.get("forDigest"), f"{path}.forDigest")
    judge = require_object(value.get("judge"), f"{path}.judge")
    require_exact_members(judge, {"provider", "model"}, f"{path}.judge")
    if judge.get("provider") not in JUDGE_PROVIDERS:
        raise HTTPException(status_code=422, detail=f"{path}.judge.provider가 올바르지 않습니다.")
    require_string(judge.get("model"), f"{path}.judge.model")
    require_string(value.get("ranAt"), f"{path}.ranAt")


def validate_strategy(value: Any, path: str) -> None:
    """tree 레코드의 선택 필드 strategy(ExperimentStrategy) — key·summary 필수, label 선택."""
    if not isinstance(value, dict):
        raise HTTPException(status_code=422, detail=f"{path}는 key와 summary를 가진 객체여야 합니다.")
    require_exact_members(value, {"key", "summary"}, path, optional=frozenset({"label"}))
    key = require_string(value.get("key"), f"{path}.key")
    if _STRATEGY_KEY_RE.fullmatch(key) is None:
        raise HTTPException(
            status_code=422,
            detail=f"{path}.key는 영문 소문자·숫자·_- 조합의 1~64자여야 합니다.",
        )
    summary = require_string(value.get("summary"), f"{path}.summary")
    if not summary.strip() or len(summary) > STRATEGY_SUMMARY_MAX_CHARS:
        raise HTTPException(
            status_code=422,
            detail=f"{path}.summary는 비어 있지 않은 {STRATEGY_SUMMARY_MAX_CHARS}자 이하 문자열이어야 합니다.",
        )
    if "label" in value:
        require_string(value.get("label"), f"{path}.label")


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
            "championGuardScore",
            "curve",
            "guardCurve",
            "tree",
            "provenance",
            "rngState",
        },
        path,
    )
    require_number(checkpoint.get("round"), f"{path}.round")
    require_number(checkpoint.get("championScore"), f"{path}.championScore")
    require_string_array(checkpoint.get("championViolations"), f"{path}.championViolations")
    require_nullable_number(
        checkpoint.get("championGuardScore"), f"{path}.championGuardScore"
    )
    curve = require_array(checkpoint.get("curve"), f"{path}.curve")
    for index, score in enumerate(curve):
        require_number(score, f"{path}.curve[{index}]")
    guard_curve = require_array(checkpoint.get("guardCurve"), f"{path}.guardCurve")
    for index, score in enumerate(guard_curve):
        require_nullable_number(score, f"{path}.guardCurve[{index}]")
    tree = require_array(checkpoint.get("tree"), f"{path}.tree")
    for index, item in enumerate(tree):
        item_path = f"{path}.tree[{index}]"
        record = require_object(item, item_path)
        require_exact_members(
            record,
            {
                "round",
                "candidateScore",
                "championScore",
                "adopted",
                "gateRejected",
                "violations",
                "candidateGuardScore",
                "guardSafe",
            },
            item_path,
            optional=frozenset({"strategy"}),
        )
        if "strategy" in record:
            validate_strategy(record.get("strategy"), f"{item_path}.strategy")
        require_number(record.get("round"), f"{item_path}.round")
        require_number(record.get("candidateScore"), f"{item_path}.candidateScore")
        require_number(record.get("championScore"), f"{item_path}.championScore")
        require_boolean(record.get("adopted"), f"{item_path}.adopted")
        require_boolean(record.get("gateRejected"), f"{item_path}.gateRejected")
        require_string_array(record.get("violations"), f"{item_path}.violations")
        require_nullable_number(
            record.get("candidateGuardScore"), f"{item_path}.candidateGuardScore"
        )
        require_boolean(record.get("guardSafe"), f"{item_path}.guardSafe")
    provenance = require_array(checkpoint.get("provenance"), f"{path}.provenance")
    for index, item in enumerate(provenance):
        item_path = f"{path}.provenance[{index}]"
        entry = require_object(item, item_path)
        require_exact_members(entry, {"at", "type", "detail"}, item_path)
        require_string(entry.get("at"), f"{item_path}.at")
        if entry.get("type") not in PROVENANCE_TYPES:
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


def require_allowed_origin(request: Request) -> None:
    """모든 쓰기·프록시 경로의 공통 가드. CORS 헤더는 응답 공개만 제어하고 단순 요청의 쓰기
    자체를 막지 않으므로, 브라우저가 붙이는 Origin을 직접 확인한다."""
    origin = request.headers.get("origin")
    if origin is not None and origin not in ALLOWED_ORIGINS:
        raise HTTPException(status_code=403, detail="허용하지 않는 Origin입니다.")


async def read_export_payload(request: Request) -> bytes:
    require_allowed_origin(request)

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
    """저장 가능한 v2 봉투의 골격과 귀속만 확인한다.

    이 API는 원문 JSON을 exact-byte로 보존하는 저장소다. Pack 다이제스트 재계산,
    examiner 판정, checkpoint 곡선 같은 의미 검증은 브라우저의
    `packages/contracts` 생산자 계약이 권위다. 다만 불완전하거나 다른 Pack에 결속된
    레코드를 색인하지 않도록, 여기서는 v2 봉투의 필수 노드와 승인·실행 귀속은 확인한다.
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
        {"pack", "examinerReport", "approval"},
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
            {"examinerReport", "pairwise"},
            "project.evaluation.pack.judgeProcedure.exemptions",
        )
        for exemption in ("examinerReport", "pairwise"):
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
        if judge.get("provider") not in JUDGE_PROVIDERS:
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
    if holdout_policy_mode not in {"none", "seeded_split"}:
        raise HTTPException(status_code=422, detail="지원하지 않는 holdoutPolicy.mode입니다.")
    require_string(holdout_policy.get("note"), "project.evaluation.pack.holdoutPolicy.note")
    if holdout_policy_mode == "seeded_split":
        require_exact_members(
            holdout_policy,
            {"mode", "note", "guardCaseIds", "holdoutCaseIds", "guardTolerance"},
            "project.evaluation.pack.holdoutPolicy",
        )
        require_string_array(
            holdout_policy.get("guardCaseIds"),
            "project.evaluation.pack.holdoutPolicy.guardCaseIds",
        )
        require_string_array(
            holdout_policy.get("holdoutCaseIds"),
            "project.evaluation.pack.holdoutPolicy.holdoutCaseIds",
        )
        require_number(
            holdout_policy.get("guardTolerance"),
            "project.evaluation.pack.holdoutPolicy.guardTolerance",
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
    if judge_kind == "deterministic_only":
        if examiner_report is not None:
            raise HTTPException(
                status_code=422,
                detail="결정적 전용 Pack에는 examinerReport가 null이어야 합니다.",
            )
    elif examiner_report is None:
        raise HTTPException(
            status_code=422,
            detail="case_answering Pack에는 examinerReport 객체가 필요합니다.",
        )
    else:
        validate_examiner_report(examiner_report, "project.evaluation.examinerReport")
        if examiner_report.get("forDigest") != definition_digest:
            raise HTTPException(
                status_code=422,
                detail="project.evaluation.examinerReport.forDigest가 현재 Pack과 다릅니다.",
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
        loop_spec,
        {"maxRounds", "plateauRounds", "adoptionRule", "seed"},
        "project.loopSpec",
        optional=frozenset({"feedbackMode"}),
    )
    require_number(loop_spec.get("maxRounds"), "project.loopSpec.maxRounds")
    require_number(loop_spec.get("plateauRounds"), "project.loopSpec.plateauRounds")
    if loop_spec.get("adoptionRule") != "scalar_strict":
        raise HTTPException(status_code=422, detail="project.loopSpec.adoptionRule이 올바르지 않습니다.")
    if "feedbackMode" in loop_spec and loop_spec.get("feedbackMode") not in FEEDBACK_MODES:
        raise HTTPException(
            status_code=422,
            detail=f"project.loopSpec.feedbackMode 값이 허용 목록 밖입니다: {loop_spec.get('feedbackMode')}",
        )
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
    done_reason = checkpoint.get("doneReason")
    if done_reason not in DONE_REASONS:
        raise HTTPException(
            status_code=422,
            detail=f"doneReason 값이 허용 목록 밖입니다: {done_reason}",
        )
    if done_reason == "ceiling" and checkpoint.get("championScore") < SCORE_CEILING:
        raise HTTPException(
            status_code=422,
            detail=f"ceiling 종료는 챔피언 점수가 척도 상한({SCORE_CEILING})에 도달해야 합니다.",
        )
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
    # 골격 검사를 통과한 저장만 한도를 소모한다 — 형식 오류(422)로 정상 사용자의 횟수를 깎지 않는다.
    _enforce_export_rate_limit(request)
    export_id = str(uuid.uuid4())
    stored_at = now_iso()
    content_sha256 = hashlib.sha256(payload).hexdigest()
    try:
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
    except sqlite3.OperationalError as error:
        # max_page_count 상한이나 실제 디스크 부족 — 둘 다 "database or disk is full"로 온다.
        if "full" not in str(error).lower():
            raise
        logger.warning("내보내기 저장 거부: 저장 공간 상한 도달 (%s)", error)
        raise HTTPException(
            status_code=507,
            detail="서버 저장 공간이 가득 차 기록할 수 없습니다. 관리자에게 알리고, 지금은 JSON 내보내기로 보관해 주세요.",
        ) from error

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


@app.get("/config")
def get_config() -> Dict[str, Any]:
    """공유 키 보유 여부와, 키가 있을 때 그 키로 쓸 수 있는 모델 목록. 키 자체는 절대 담지 않는다.
    모델 목록은 브라우저가 공유 경로에서 허용 밖 모델을 고르지 못하게 미리 거르는 용도다."""
    return {
        "sharedProviders": {
            "openai": bool(SHARED_OPENAI_API_KEY),
            "gemini": bool(SHARED_GEMINI_API_KEY),
        },
        "sharedModels": {
            "openai": sorted(SHARED_OPENAI_MODELS) if SHARED_OPENAI_API_KEY else [],
            "gemini": sorted(SHARED_GEMINI_MODELS) if SHARED_GEMINI_API_KEY else [],
        },
    }


def _client_ip(request: Request) -> str:
    """속도 제한 버킷 키가 되는 방문자 IP.

    HARNEST_TRUSTED_IP_HEADER가 가리키는 헤더만 믿는다(Fly는 fly-client-ip, Render·Railway 등은
    x-forwarded-for). x-forwarded-for는 클라이언트가 앞에 아무 값이나 덧붙일 수 있으므로 첫 값이
    아니라 프록시가 마지막에 붙인 값을 쓰고, 그 외 헤더는 단일 값으로 본다. 변수가 없으면 헤더를
    전부 무시하고 접속 소켓 IP만 쓴다 — 프록시 없는 배포에서 헤더를 믿으면 요청마다 IP를 꾸며
    시간당 한도를 무한히 우회할 수 있다.
    """
    if TRUSTED_IP_HEADER:
        raw = request.headers.get(TRUSTED_IP_HEADER, "")
        if TRUSTED_IP_HEADER == "x-forwarded-for":
            candidate = raw.split(",")[-1].strip() if raw else ""
        else:
            candidate = raw.strip()
        if candidate:
            return candidate
    return request.client.host if request.client else "unknown"


async def _read_proxy_body(request: Request) -> Dict[str, Any]:
    """프록시 본문 — Origin·크기·형식을 확인한 뒤 JSON 객체로 돌려준다."""
    require_allowed_origin(request)
    media_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if media_type != "application/json":
        raise HTTPException(status_code=415, detail="Content-Type은 application/json이어야 합니다.")
    payload = bytearray()
    async for chunk in request.stream():
        payload.extend(chunk)
        if len(payload) > PROXY_MAX_BODY_BYTES:
            raise HTTPException(status_code=413, detail="요청 본문이 너무 큽니다.")
    try:
        body = json.loads(bytes(payload))
    except ValueError as error:
        raise HTTPException(status_code=400, detail="요청 본문이 JSON이 아닙니다.") from error
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="요청 본문은 JSON 객체여야 합니다.")
    return body


def _clamp_tokens(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        return PROXY_MAX_OUTPUT_TOKENS
    return min(value, PROXY_MAX_OUTPUT_TOKENS)


def _enforce_rate_limit(request: Request) -> None:
    ip = _client_ip(request)
    if not rate_limiter.check(ip, PROXY_RATE_LIMIT_PER_HOUR):
        raise HTTPException(
            status_code=429,
            detail=f"공유 키 사용량이 시간당 {PROXY_RATE_LIMIT_PER_HOUR}회를 넘었습니다. "
            "잠시 후 다시 시도하거나 본인 키를 입력해 주세요.",
        )


def _enforce_export_rate_limit(request: Request) -> None:
    # 프록시와 같은 IP 키를 쓰면 모델 호출 20회가 저장 횟수까지 잠식하므로 버킷을 분리한다.
    ip = _client_ip(request)
    if not rate_limiter.check(f"exports:{ip}", EXPORT_RATE_LIMIT_PER_HOUR):
        raise HTTPException(
            status_code=429,
            detail=f"서버 기록이 시간당 {EXPORT_RATE_LIMIT_PER_HOUR}회를 넘었습니다. "
            "잠시 후 다시 시도하거나 JSON 내보내기로 보관해 주세요.",
        )


_upstream: httpx.AsyncClient | None = None


def _upstream_client() -> httpx.AsyncClient:
    """벤더 호출용 AsyncClient — 첫 사용 때 만들어 재사용한다. 동기 httpx.post는 이벤트 루프를
    점유해 벤더 응답을 기다리는 동안 다른 사용자의 /exports·/health까지 멈추므로 쓰지 않는다."""
    global _upstream
    if _upstream is None:
        _upstream = httpx.AsyncClient(
            timeout=httpx.Timeout(
                connect=10.0, read=PROXY_UPSTREAM_TIMEOUT_SECONDS, write=30.0, pool=10.0
            )
        )
    return _upstream


async def _forward_upstream(
    vendor: str, url: str, body: Dict[str, Any], headers: Dict[str, str], max_output_tokens: int
) -> Response:
    """본문을 벤더에 보내고 응답을 그대로 돌려준다. 응답 읽기 시간 초과·읽는 도중 단절은 504(벤더가 이미
    처리 중이라 클라이언트가 재시도하면 안 된다), 연결·풀·쓰기 단계의 실패는 502(재시도 안전).
    읽기 한도는 요청의 출력 토큰 상한에 비례한다(_upstream_read_timeout)."""
    read_timeout = _upstream_read_timeout(max_output_tokens)
    timeout = httpx.Timeout(connect=10.0, read=read_timeout, write=30.0, pool=10.0)
    try:
        upstream = await _upstream_client().post(url, json=body, headers=headers, timeout=timeout)
    except httpx.ReadTimeout as exc:
        # 관리자가 비용 누수를 알아챌 수 있도록 건수를 남긴다. 본문·키는 기록하지 않는다.
        logger.warning("공유 키 프록시 상류 시간 초과: vendor=%s limit=%ss", vendor, f"{read_timeout:g}")
        raise HTTPException(
            status_code=504,
            detail=f"{vendor} 응답이 {read_timeout:g}초 안에 오지 않았습니다. "
            "같은 요청을 다시 보내면 관리자 비용만 반복되니 재시도하지 말고, 긴 생성은 본인 키로 실행해 주세요.",
        ) from exc
    except (httpx.ReadError, httpx.RemoteProtocolError) as exc:
        # 본문이 벤더에 다 쓰인 뒤 응답을 읽다 끊긴 것 — 벤더 쪽 생성은 진행 중이라 재시도하면 이중 과금
        logger.warning("공유 키 프록시 상류 응답 단절: vendor=%s", vendor)
        raise HTTPException(
            status_code=504,
            detail=f"{vendor} 응답을 받는 도중 연결이 끊겼습니다. "
            "같은 요청을 다시 보내면 관리자 비용만 반복되니 재시도하지 말고, 잠시 뒤 본인 키로 실행해 주세요.",
        ) from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"{vendor} 연결 실패: {exc}") from exc
    return Response(
        content=upstream.content, status_code=upstream.status_code, media_type="application/json"
    )


@app.post("/proxy/openai")
async def proxy_openai(request: Request) -> Response:
    if not SHARED_OPENAI_API_KEY:
        raise HTTPException(status_code=404, detail="공유 키가 설정되지 않았습니다.")
    body = await _read_proxy_body(request)
    if body.get("model") not in SHARED_OPENAI_MODELS:
        raise HTTPException(status_code=400, detail="공유 키로 쓸 수 없는 모델입니다.")
    # 스트리밍은 그대로 전달하지 않는다 — 클라이언트는 공유 경로에서 한 번에 받는다.
    body.pop("stream", None)
    body["max_output_tokens"] = _clamp_tokens(body.get("max_output_tokens"))
    _enforce_rate_limit(request)
    return await _forward_upstream(
        "OpenAI",
        "https://api.openai.com/v1/responses",
        body,
        {"Authorization": f"Bearer {SHARED_OPENAI_API_KEY}"},
        body["max_output_tokens"],
    )


@app.post("/proxy/gemini/{model}")
async def proxy_gemini(model: str, request: Request) -> Response:
    if not SHARED_GEMINI_API_KEY:
        raise HTTPException(status_code=404, detail="공유 키가 설정되지 않았습니다.")
    if not _MODEL_NAME_RE.match(model):
        raise HTTPException(status_code=400, detail="잘못된 모델 이름입니다.")
    if model not in SHARED_GEMINI_MODELS:
        raise HTTPException(status_code=400, detail="공유 키로 쓸 수 없는 모델입니다.")
    body = await _read_proxy_body(request)
    generation = body.get("generationConfig")
    if not isinstance(generation, dict):
        generation = {}
        body["generationConfig"] = generation
    generation["maxOutputTokens"] = _clamp_tokens(generation.get("maxOutputTokens"))
    _enforce_rate_limit(request)
    return await _forward_upstream(
        "Gemini",
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        body,
        {"x-goog-api-key": SHARED_GEMINI_API_KEY},
        generation["maxOutputTokens"],
    )
