"""API 왕복 테스트 — python3 test_api.py 로 실행, 실패 시 비정상 종료.

main 임포트 전에 HARNEST_DB를 임시 파일로 지정해 실 DB를 건드리지 않는다.
"""

import hashlib
import json
import os
import sqlite3
import sys
import tempfile

_tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_tmp.close()

# 실제 구버전 DB처럼 user_version=0과 레거시 테이블·행을 먼저 만든 뒤 main의 마이그레이션을 실행한다.
_legacy_id = "legacy-before-export-migration"
_legacy_interview = {"schemaVersion": "skeleton-1", "templateId": "timetable", "answers": {}}
_legacy_pack = {"packVersion": "skeleton-1", "templateId": "timetable"}
_legacy_loop_spec = {"maxRounds": 1, "plateauRounds": 1, "adoptionRule": "scalar_strict", "seed": 1}
_legacy_checkpoint = {"runId": "legacy-run", "packDigest": "0" * 64}
with sqlite3.connect(_tmp.name) as _legacy_conn:
    _legacy_conn.execute(
        """CREATE TABLE projects (
            id TEXT PRIMARY KEY,
            interview TEXT NOT NULL,
            pack TEXT NOT NULL,
            loop_spec TEXT NOT NULL,
            created_at TEXT NOT NULL
        )"""
    )
    _legacy_conn.execute(
        """CREATE TABLE results (
            seq INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id TEXT NOT NULL REFERENCES projects(id),
            checkpoint TEXT NOT NULL,
            created_at TEXT NOT NULL
        )"""
    )
    _legacy_conn.execute(
        "INSERT INTO projects (id, interview, pack, loop_spec, created_at) VALUES (?, ?, ?, ?, ?)",
        (
            _legacy_id,
            json.dumps(_legacy_interview, ensure_ascii=False),
            json.dumps(_legacy_pack, ensure_ascii=False),
            json.dumps(_legacy_loop_spec, ensure_ascii=False),
            "2026-08-24T00:00:00+00:00",
        ),
    )
    _legacy_conn.execute(
        "INSERT INTO results (project_id, checkpoint, created_at) VALUES (?, ?, ?)",
        (
            _legacy_id,
            json.dumps(_legacy_checkpoint, ensure_ascii=False),
            "2026-08-24T00:01:00+00:00",
        ),
    )

os.environ["HARNEST_DB"] = _tmp.name

from fastapi.testclient import TestClient  # noqa: E402

from main import MAX_EXPORT_BYTES, app, init_db  # noqa: E402


def run() -> None:
    client = TestClient(app)

    # health
    r = client.get("/health")
    assert r.status_code == 200, r.text
    assert r.json() == {"status": "ok"}

    # user_version=0 레거시 DB를 마이그레이션해도 기존 API 데이터는 그대로 읽힌다.
    r = client.get(f"/projects/{_legacy_id}")
    assert r.status_code == 200, r.text
    assert r.json()["interview"] == _legacy_interview
    assert r.json()["pack"] == _legacy_pack
    assert r.json()["loopSpec"] == _legacy_loop_spec

    # projects 왕복
    payload = {
        "interview": {
            "schemaVersion": "skeleton-1",
            "templateId": "timetable",
            "answers": {"staff": "가온, 나래, 다솜", "period": 14, "maxConsecutive": 3},
        },
        "pack": {
            "packVersion": "skeleton-1",
            "templateId": "timetable",
            "criteria": [],
            "gates": [],
            "judgeProcedure": {"kind": "deterministic_only"},
            "holdoutPolicy": {"mode": "none", "note": ""},
            "definitionDigest": "0" * 64,
        },
        "loopSpec": {
            "maxRounds": 40,
            "plateauRounds": 12,
            "adoptionRule": "scalar_strict",
            "seed": 1,
        },
    }
    r = client.post("/projects", json=payload)
    assert r.status_code == 200, r.text
    project_id = r.json()["id"]
    assert project_id

    r = client.get(f"/projects/{project_id}")
    assert r.status_code == 200, r.text
    stored = r.json()
    assert stored["id"] == project_id
    assert stored["interview"] == payload["interview"]
    assert stored["pack"] == payload["pack"]
    assert stored["loopSpec"] == payload["loopSpec"]
    assert stored["createdAt"]

    # results 업로드
    checkpoint = {
        "runId": "run-1",
        "packDigest": "0" * 64,
        "status": "done",
        "round": 3,
        "champion": [[0, 1], [1, 2]],
        "championScore": 87.5,
        "championViolations": [],
        "curve": [40.0, 60.0, 87.5],
        "tree": [],
        "provenance": [],
        "rngState": 12345,
    }
    r = client.post(f"/projects/{project_id}/results", json={"checkpoint": checkpoint})
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True}

    # 버전형 봉투는 완전한 v2 골격을 가지며, 원문 UTF-8 바이트를 그대로 저장하고 돌려준다.
    pack_scope = {
        "packVersion": "skeleton-1",
        "templateId": "handover",
        "criteria": [],
        "gates": [],
        "judgeProcedure": {
            "kind": "deterministic_only",
            "exemptions": {
                "examinerReport": "결정적 채점",
                "pairwise": "결정적 채점",
            },
        },
        "holdoutPolicy": {"mode": "none", "note": "해당 없음"},
    }
    canonical_scope = json.dumps(
        pack_scope,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    definition_digest = hashlib.sha256(canonical_scope).hexdigest()
    export_envelope = {
        "kind": "harnest.project-export",
        "envelopeVersion": 3,
        "exportedAt": "2026-08-24T00:02:00.000Z",
        "project": {
            "interview": {
                "schemaVersion": "skeleton-1",
                "templateId": "handover",
                "answers": {"artifact": "인수인계 초안"},
            },
            "evaluation": {
                "pack": {
                    **pack_scope,
                    "definitionDigest": definition_digest,
                },
                "examinerReport": None,
                "approval": {
                    "forDigest": definition_digest,
                    "approvedAt": "2026-08-24T00:01:00.000Z",
                },
            },
            "loopSpec": {
                "maxRounds": 1,
                "plateauRounds": 2,
                "adoptionRule": "scalar_strict",
                "seed": 1,
            },
        },
        "result": {
            "checkpoint": {
                "runId": "run-한글-1",
                "packDigest": definition_digest,
                "status": "done",
                "doneReason": "max_rounds",
                "round": 1,
                "champion": "완료 산출물",
                "championScore": 90.0,
                "championViolations": [],
                "championGuardScore": None,
                "curve": [50.0, 90.0],
                "guardCurve": [None, None],
                "tree": [
                    {
                        "round": 1,
                        "candidateScore": 90.0,
                        "championScore": 90.0,
                        "adopted": True,
                        "gateRejected": False,
                        "violations": [],
                        "candidateGuardScore": None,
                        "guardSafe": True,
                    }
                ],
                "provenance": [],
                "rngState": 123,
            },
            "holdout": {"mode": "none"},
        },
    }
    raw_export = (json.dumps(export_envelope, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    expected_hash = hashlib.sha256(raw_export).hexdigest()
    r = client.post(
        "/exports",
        content=raw_export,
        headers={"Content-Type": "application/json"},
    )
    assert r.status_code == 201, r.text
    export_record = r.json()
    export_id = export_record["id"]
    assert export_record["storedAt"]
    assert export_record["contentSha256"] == expected_hash
    assert r.headers["Location"] == f"/exports/{export_id}"

    r = client.get(f"/exports/{export_id}")
    assert r.status_code == 200, r.text
    assert r.content == raw_export
    assert r.headers["Content-Type"] == "application/json"
    assert r.headers["X-Content-SHA256"] == expected_hash

    with sqlite3.connect(_tmp.name) as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 1
        assert json.loads(
            conn.execute(
                "SELECT checkpoint FROM results WHERE project_id = ?", (_legacy_id,)
            ).fetchone()[0]
        ) == _legacy_checkpoint
        row = conn.execute(
            """SELECT envelope_version, template_id, pack_version,
                      definition_digest, run_id, payload, content_sha256
               FROM project_exports WHERE id = ?""",
            (export_id,),
        ).fetchone()
        assert row == (
            3,
            "handover",
            "skeleton-1",
            definition_digest,
            "run-한글-1",
            raw_export,
            expected_hash,
        )
        index_names = {
            index[1] for index in conn.execute("PRAGMA index_list('project_exports')")
        }
        assert {
            "idx_project_exports_digest_created",
            "idx_project_exports_template_created",
            "idx_project_exports_run",
        } <= index_names

        legacy_project_before = conn.execute(
            "SELECT interview, pack, loop_spec, created_at FROM projects WHERE id = ?",
            (project_id,),
        ).fetchone()
        legacy_results_before = conn.execute(
            "SELECT checkpoint, created_at FROM results WHERE project_id = ? ORDER BY seq",
            (project_id,),
        ).fetchall()

    # 마이그레이션 재실행은 멱등이고 레거시 행을 바꾸지 않는다.
    init_db()
    with sqlite3.connect(_tmp.name) as conn:
        assert conn.execute(
            "SELECT interview, pack, loop_spec, created_at FROM projects WHERE id = ?",
            (project_id,),
        ).fetchone() == legacy_project_before
        assert conn.execute(
            "SELECT checkpoint, created_at FROM results WHERE project_id = ? ORDER BY seq",
            (project_id,),
        ).fetchall() == legacy_results_before

    # case_answering 봉투도 승인 증거와 단계별 홀드아웃의 정식 구조로 왕복한다.
    llm_pack_scope = {
        "packVersion": "skeleton-1",
        "templateId": "handover",
        "criteria": [],
        "gates": [],
        "judgeProcedure": {
            "kind": "case_answering",
            "judge": {"provider": "mock", "model": "모의 모델"},
            "pairwiseNotice": "미적용",
        },
        "holdoutPolicy": {
            "mode": "seeded_split",
            "note": "시드 분할",
            "guardCaseIds": ["case-3"],
            "holdoutCaseIds": ["case-4"],
            "guardTolerance": 4.2,
        },
    }
    llm_digest = hashlib.sha256(
        json.dumps(
            llm_pack_scope,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    report_at = "2026-08-24T00:03:00.000Z"
    llm_export = {
        "kind": "harnest.project-export",
        "envelopeVersion": 3,
        "exportedAt": "2026-08-24T00:05:00.000Z",
        "project": {
            "interview": {
                "schemaVersion": "skeleton-1",
                "templateId": "handover",
                "answers": {"artifact": "인수인계 초안"},
            },
            "evaluation": {
                "pack": {**llm_pack_scope, "definitionDigest": llm_digest},
                "examinerReport": {
                    "checks": [
                        {"id": check_id, "verdict": "pass", "note": "통과"}
                        for check_id in ("stability", "hack_resistance")
                    ],
                    "overall": "pass",
                    "forDigest": llm_digest,
                    "judge": {"provider": "mock", "model": "모의 모델"},
                    "ranAt": report_at,
                },
                "approval": {
                    "forDigest": llm_digest,
                    "approvedAt": "2026-08-24T00:04:30.000Z",
                },
            },
            "loopSpec": {
                "maxRounds": 1,
                "plateauRounds": 2,
                "adoptionRule": "scalar_strict",
                "seed": 1,
            },
        },
        "result": {
            "checkpoint": {
                **export_envelope["result"]["checkpoint"],
                "runId": "run-llm-1",
                "packDigest": llm_digest,
            },
            "holdout": {
                "mode": "measured",
                "baseline": {
                    "status": "scored",
                    "evaluation": {
                        "gateRejected": False,
                        "score": 50.0,
                        "perCase": [
                            {
                                "caseId": "case-4",
                                "question": "숨김 질문",
                                "score": 0.5,
                                "why": "부분 정답",
                                "caseType": "new",
                            }
                        ],
                        "violations": [],
                    },
                },
                "final": {
                    "status": "failed",
                    "error": "종료 홀드아웃 모델 호출 실패",
                },
            },
        },
    }
    raw_llm_export = (json.dumps(llm_export, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    r = client.post(
        "/exports", content=raw_llm_export, headers={"Content-Type": "application/json"}
    )
    assert r.status_code == 201, r.text
    llm_export_id = r.json()["id"]
    r = client.get(f"/exports/{llm_export_id}")
    assert r.status_code == 200, r.text
    assert r.content == raw_llm_export

    # 새 BYO 공급자도 Pack·시험관 리포트의 동일 provider/model 결속을 유지해 저장한다.
    for provider, model in (
        ("vertex", "gemini-3.8-flash"),
        ("anthropic", "claude-test"),
        ("openrouter", "anthropic/claude-test"),
        ("ollama", "qwen:test"),
    ):
        provider_export = json.loads(json.dumps(llm_export, ensure_ascii=False))
        evaluation = provider_export["project"]["evaluation"]
        evaluation["pack"]["judgeProcedure"]["judge"] = {
            "provider": provider,
            "model": model,
        }
        provider_scope = dict(evaluation["pack"])
        provider_scope.pop("definitionDigest")
        provider_digest = hashlib.sha256(
            json.dumps(
                provider_scope,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()
        evaluation["pack"]["definitionDigest"] = provider_digest
        evaluation["examinerReport"]["forDigest"] = provider_digest
        evaluation["examinerReport"]["judge"] = {
            "provider": provider,
            "model": model,
        }
        evaluation["approval"]["forDigest"] = provider_digest
        provider_export["result"]["checkpoint"]["packDigest"] = provider_digest
        provider_export["result"]["checkpoint"]["runId"] = f"run-{provider}"
        r = client.post(
            "/exports",
            content=json.dumps(provider_export, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        assert r.status_code == 201, f"{provider}: {r.text}"

    # 중복 키, 미지원 버전, 불완전한 골격과 잘못된 귀속은 저장하지 않는다.
    with sqlite3.connect(_tmp.name) as conn:
        export_count_before = conn.execute(
            "SELECT COUNT(*) FROM project_exports"
        ).fetchone()[0]

    def export_bytes(value):
        return json.dumps(value, ensure_ascii=False).encode("utf-8")

    missing_exported_at = json.loads(raw_export)
    del missing_exported_at["exportedAt"]
    wrong_approval_digest = json.loads(raw_export)
    wrong_approval_digest["project"]["evaluation"]["approval"]["forDigest"] = "b" * 64
    wrong_digest_shape = json.loads(raw_export)
    wrong_digest_shape["project"]["evaluation"]["pack"]["definitionDigest"] = "A" * 64
    wrong_interview_schema = json.loads(raw_export)
    wrong_interview_schema["project"]["interview"]["schemaVersion"] = "skeleton-2"
    mismatched_template = json.loads(raw_export)
    mismatched_template["project"]["interview"]["templateId"] = "timetable"
    wrong_pack_version = json.loads(raw_export)
    wrong_pack_version["project"]["evaluation"]["pack"]["packVersion"] = "skeleton-2"
    wrong_examiner_shape = json.loads(raw_export)
    wrong_examiner_shape["project"]["evaluation"]["examinerReport"] = "not-an-object"
    case_answering_without_evidence = json.loads(raw_export)
    case_answering_without_evidence["project"]["evaluation"]["pack"]["judgeProcedure"] = {
        "kind": "case_answering",
        "judge": {"provider": "mock", "model": "모의 모델"},
        "pairwiseNotice": "미적용",
    }
    running_checkpoint = json.loads(raw_export)
    running_checkpoint["result"]["checkpoint"]["status"] = "running"
    running_checkpoint["result"]["checkpoint"].pop("doneReason")
    missing_holdout = json.loads(raw_export)
    missing_holdout["result"].pop("holdout")
    wrong_checkpoint_shape = json.loads(raw_export)
    wrong_checkpoint_shape["result"]["checkpoint"]["curve"] = "not-an-array"
    null_criterion = json.loads(raw_export)
    null_criterion["project"]["evaluation"]["pack"]["criteria"] = [None]
    malformed_curve = json.loads(raw_export)
    malformed_curve["result"]["checkpoint"]["curve"] = [50.0, "90"]
    null_tree_item = json.loads(raw_export)
    null_tree_item["result"]["checkpoint"]["tree"] = [None]
    null_provenance_item = json.loads(raw_export)
    null_provenance_item["result"]["checkpoint"]["provenance"] = [None]
    malformed_report = json.loads(raw_llm_export)
    malformed_report["project"]["evaluation"]["examinerReport"] = {}
    missing_holdout_score = json.loads(raw_llm_export)
    missing_holdout_score["result"]["holdout"]["baseline"]["evaluation"].pop("score")
    null_holdout_case = json.loads(raw_llm_export)
    null_holdout_case["result"]["holdout"]["baseline"]["evaluation"]["perCase"] = [None]
    malformed_holdout_ids = json.loads(raw_llm_export)
    malformed_holdout_ids["project"]["evaluation"]["pack"]["holdoutPolicy"][
        "holdoutCaseIds"
    ] = [None]
    unknown_root_field = json.loads(raw_export)
    unknown_root_field["unexpected"] = True
    split_without_measurement = json.loads(raw_export)
    split_without_measurement["project"]["evaluation"]["pack"]["holdoutPolicy"] = {
        "mode": "seeded_split",
        "note": "시드 분할",
        "guardCaseIds": ["case-0"],
        "holdoutCaseIds": ["case-1"],
        "guardTolerance": 4.2,
    }

    invalid_exports = [
        b'{"kind":"harnest.project-export","kind":"harnest.project-export","envelopeVersion":3}',
        raw_export.replace(b'"envelopeVersion": 3', b'"envelopeVersion": 1', 1),
        export_bytes(missing_exported_at),
        export_bytes(wrong_digest_shape),
        export_bytes(wrong_interview_schema),
        export_bytes(mismatched_template),
        export_bytes(wrong_pack_version),
        export_bytes(wrong_examiner_shape),
        export_bytes(case_answering_without_evidence),
        raw_export.replace(
            f'"packDigest": "{definition_digest}"'.encode("utf-8"),
            f'"packDigest": "{"c" * 64}"'.encode("utf-8"),
            1,
        ),
        export_bytes(wrong_approval_digest),
        export_bytes(running_checkpoint),
        export_bytes(missing_holdout),
        export_bytes(wrong_checkpoint_shape),
        export_bytes(null_criterion),
        export_bytes(malformed_curve),
        export_bytes(null_tree_item),
        export_bytes(null_provenance_item),
        export_bytes(malformed_report),
        export_bytes(missing_holdout_score),
        export_bytes(null_holdout_case),
        export_bytes(malformed_holdout_ids),
        export_bytes(unknown_root_field),
        raw_export.replace(
            '"runId": "run-한글-1"'.encode("utf-8"),
            b'"runId": "\\ud800"',
            1,
        ),
        raw_export.replace(
            '"artifact": "인수인계 초안"'.encode("utf-8"),
            b'"artifact": "\\udc00"',
            1,
        ),
        export_bytes(split_without_measurement),
    ]
    for invalid_export in invalid_exports:
        r = client.post(
            "/exports",
            content=invalid_export,
            headers={"Content-Type": "application/json"},
        )
        assert r.status_code == 422, r.text

    # 브라우저의 명시적 JSON 기록 경계를 우회하는 단순 교차 출처 쓰기와 과대 본문을 막는다.
    r = client.post(
        "/exports",
        content=raw_export,
        headers={"Content-Type": "text/plain", "Origin": "https://evil.example"},
    )
    assert r.status_code == 403, r.text
    r = client.post(
        "/exports",
        content=raw_export,
        headers={"Content-Type": "text/plain", "Origin": "http://localhost:5173"},
    )
    assert r.status_code == 415, r.text
    r = client.post(
        "/exports",
        content=b" " * (MAX_EXPORT_BYTES + 1),
        headers={"Content-Type": "application/json", "Origin": "http://localhost:5173"},
    )
    assert r.status_code == 413, r.text

    with sqlite3.connect(_tmp.name) as conn:
        assert (
            conn.execute("SELECT COUNT(*) FROM project_exports").fetchone()[0]
            == export_count_before
        )

    # 404 검증
    r = client.get("/projects/no-such-id")
    assert r.status_code == 404, r.text
    r = client.post("/projects/no-such-id/results", json={"checkpoint": checkpoint})
    assert r.status_code == 404, r.text
    r = client.get("/exports/no-such-id")
    assert r.status_code == 404, r.text

    # 공유 키를 설정하지 않은 기본 상태 — /config는 둘 다 false, /proxy/*는 404
    r = client.get("/config")
    assert r.status_code == 200, r.text
    assert r.json() == {"sharedProviders": {"openai": False, "gemini": False}}

    r = client.post("/proxy/openai", json={"model": "x", "input": "hi"})
    assert r.status_code == 404, r.text

    r = client.post("/proxy/gemini/gemini-3.8-flash", json={"contents": []})
    assert r.status_code == 404, r.text

    run_ratelimit_and_model_validation()

    print("모든 테스트 통과")


def run_ratelimit_and_model_validation() -> None:
    """네트워크 호출 없이 확인 가능한 순수 로직 — 레이트리밋 카운터와 모델명 검증."""
    from ratelimit import InMemoryRateLimiter

    limiter = InMemoryRateLimiter()
    for _ in range(3):
        assert limiter.check("1.2.3.4", 3) is True
    assert limiter.check("1.2.3.4", 3) is False, "한도를 넘으면 False여야 한다"
    assert limiter.check("5.6.7.8", 3) is True, "다른 키는 별도 카운터를 써야 한다"

    from main import _MODEL_NAME_RE

    assert _MODEL_NAME_RE.match("gemini-3.8-flash")
    assert not _MODEL_NAME_RE.match("../etc/passwd")
    assert not _MODEL_NAME_RE.match("model?x=1")


if __name__ == "__main__":
    try:
        run()
    finally:
        try:
            os.unlink(_tmp.name)
        except PermissionError:
            pass
    sys.exit(0)
