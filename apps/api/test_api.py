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
# 기본값 단언이 셸 환경에 좌우되지 않도록, 서버 설정 환경변수는 임포트 전에 모두 비운다.
for _name in (
    "HARNEST_CORS_ORIGINS",
    "HARNEST_TRUSTED_IP_HEADER",
    "HARNEST_PROXY_TIMEOUT",
    "HARNEST_PROXY_MAX_TIMEOUT",
    "HARNEST_PROXY_RATE_LIMIT",
    "HARNEST_EXPORT_RATE_LIMIT",
    "HARNEST_DB_MAX_BYTES",
    "SHARED_OPENAI_API_KEY",
    "SHARED_GEMINI_API_KEY",
    "SHARED_OPENAI_MODELS",
    "SHARED_GEMINI_MODELS",
):
    os.environ.pop(_name, None)

from fastapi.testclient import TestClient  # noqa: E402

from main import MAX_EXPORT_BYTES, app, init_db  # noqa: E402


def run() -> None:
    client = TestClient(app)

    # health
    r = client.get("/health")
    assert r.status_code == 200, r.text
    assert r.json() == {"status": "ok"}

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
            (_legacy_id,),
        ).fetchone()
        legacy_results_before = conn.execute(
            "SELECT checkpoint, created_at FROM results WHERE project_id = ? ORDER BY seq",
            (_legacy_id,),
        ).fetchall()

    # 마이그레이션 재실행은 멱등이고 레거시 행을 바꾸지 않는다.
    init_db()
    with sqlite3.connect(_tmp.name) as conn:
        assert conn.execute(
            "SELECT interview, pack, loop_spec, created_at FROM projects WHERE id = ?",
            (_legacy_id,),
        ).fetchone() == legacy_project_before
        assert conn.execute(
            "SELECT checkpoint, created_at FROM results WHERE project_id = ? ORDER BY seq",
            (_legacy_id,),
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

    # 인수인계 템플릿이 실제로 내보내는 형태 — seeded_split·examinerReport에 더해 loopSpec.feedbackMode,
    # tree 레코드의 strategy, 척도 상한 도달(ceiling) 종료까지 계약(packages/contracts/src/loop.ts)대로 저장한다.
    handover_export = json.loads(raw_llm_export)
    handover_export["project"]["loopSpec"]["feedbackMode"] = "recent_public_experiments_v1"
    handover_checkpoint = handover_export["result"]["checkpoint"]
    handover_checkpoint.update(
        {
            "runId": "run-handover-ceiling",
            "doneReason": "ceiling",
            "championScore": 100.0,
            "curve": [50.0, 100.0],
            "tree": [
                {
                    **handover_checkpoint["tree"][0],
                    "candidateScore": 100.0,
                    "championScore": 100.0,
                    "strategy": {
                        "key": "tighten-structure_v1",
                        "summary": "인수인계 문서의 절 구조를 질문 순서에 맞춰 재배열한다.",
                        "label": "구조 다듬기",
                    },
                }
            ],
            "provenance": [
                {"at": "2026-08-24T00:05:00.000Z", "type": "run_started", "detail": "시작"},
                {"at": "2026-08-24T00:05:30.000Z", "type": "adopted", "detail": "1라운드 채택"},
                {"at": "2026-08-24T00:05:31.000Z", "type": "ceiling_stop", "detail": "척도 상한 100점 도달"},
            ],
        }
    )
    handover_export["result"]["holdout"]["final"] = {
        "status": "scored",
        "evaluation": {
            "gateRejected": False,
            "score": 100.0,
            "perCase": [
                {
                    "caseId": "case-4",
                    "question": "숨김 질문",
                    "score": 1.0,
                    "why": "정답",
                    "caseType": "new",
                }
            ],
            "violations": [],
        },
    }
    raw_handover_export = (
        json.dumps(handover_export, ensure_ascii=False, indent=2) + "\n"
    ).encode("utf-8")
    r = client.post(
        "/exports", content=raw_handover_export, headers={"Content-Type": "application/json"}
    )
    assert r.status_code == 201, r.text
    r = client.get(f"/exports/{r.json()['id']}")
    assert r.status_code == 200, r.text
    assert r.content == raw_handover_export

    # label 없는 strategy, 다른 feedbackMode·doneReason 조합도 허용 목록 안이면 저장한다.
    variant = json.loads(raw_handover_export)
    variant["project"]["loopSpec"]["feedbackMode"] = "champion_only"
    variant["result"]["checkpoint"]["runId"] = "run-handover-plateau"
    variant["result"]["checkpoint"]["doneReason"] = "plateau"
    variant["result"]["checkpoint"]["championScore"] = 90.0
    variant["result"]["checkpoint"]["curve"] = [50.0, 90.0]
    variant["result"]["checkpoint"]["tree"][0]["strategy"] = {"key": "a", "summary": "짧은 설명"}
    r = client.post(
        "/exports",
        content=json.dumps(variant, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    assert r.status_code == 201, r.text

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
    unknown_feedback_mode = json.loads(raw_handover_export)
    unknown_feedback_mode["project"]["loopSpec"]["feedbackMode"] = "everything"
    unknown_done_reason = json.loads(raw_export)
    unknown_done_reason["result"]["checkpoint"]["doneReason"] = "unknown"
    ceiling_below_ceiling = json.loads(raw_handover_export)
    ceiling_below_ceiling["result"]["checkpoint"]["championScore"] = 90.0
    strategy_not_object = json.loads(raw_handover_export)
    strategy_not_object["result"]["checkpoint"]["tree"][0]["strategy"] = "tighten"
    strategy_bad_key = json.loads(raw_handover_export)
    strategy_bad_key["result"]["checkpoint"]["tree"][0]["strategy"]["key"] = "Tighten Structure"
    strategy_blank_summary = json.loads(raw_handover_export)
    strategy_blank_summary["result"]["checkpoint"]["tree"][0]["strategy"]["summary"] = "   "
    strategy_long_summary = json.loads(raw_handover_export)
    strategy_long_summary["result"]["checkpoint"]["tree"][0]["strategy"]["summary"] = "가" * 501
    strategy_missing_summary = json.loads(raw_handover_export)
    strategy_missing_summary["result"]["checkpoint"]["tree"][0]["strategy"].pop("summary")
    strategy_bad_label = json.loads(raw_handover_export)
    strategy_bad_label["result"]["checkpoint"]["tree"][0]["strategy"]["label"] = 7
    strategy_unknown_member = json.loads(raw_handover_export)
    strategy_unknown_member["result"]["checkpoint"]["tree"][0]["strategy"]["score"] = 1

    # 허용 목록 밖 값은 실제 값을 담은 정확한 사유로 거부한다 — 클라이언트가 그대로 사용자에게 보여 준다.
    r = client.post(
        "/exports",
        content=export_bytes(unknown_done_reason),
        headers={"Content-Type": "application/json"},
    )
    assert r.status_code == 422, r.text
    assert r.json()["detail"] == "doneReason 값이 허용 목록 밖입니다: unknown", r.text
    r = client.post(
        "/exports",
        content=export_bytes(unknown_feedback_mode),
        headers={"Content-Type": "application/json"},
    )
    assert r.status_code == 422, r.text
    assert r.json()["detail"] == "project.loopSpec.feedbackMode 값이 허용 목록 밖입니다: everything", r.text
    r = client.post(
        "/exports",
        content=export_bytes(ceiling_below_ceiling),
        headers={"Content-Type": "application/json"},
    )
    assert r.status_code == 422, r.text
    assert "ceiling" in r.json()["detail"] and "100" in r.json()["detail"], r.text

    invalid_exports = [
        export_bytes(unknown_feedback_mode),
        export_bytes(unknown_done_reason),
        export_bytes(ceiling_below_ceiling),
        export_bytes(strategy_not_object),
        export_bytes(strategy_bad_key),
        export_bytes(strategy_blank_summary),
        export_bytes(strategy_long_summary),
        export_bytes(strategy_missing_summary),
        export_bytes(strategy_bad_label),
        export_bytes(strategy_unknown_member),
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

    # 404 검증 — 구 /projects 경로는 제거됐고, 레거시 행은 DB에만 남는다
    r = client.get("/projects/no-such-id")
    assert r.status_code == 404, r.text
    r = client.get("/exports/no-such-id")
    assert r.status_code == 404, r.text

    # 공유 키를 설정하지 않은 기본 상태 — /config는 둘 다 false·허용 모델 목록은 빈 배열, /proxy/*는 404
    r = client.get("/config")
    assert r.status_code == 200, r.text
    assert r.json() == {
        "sharedProviders": {"openai": False, "gemini": False},
        "sharedModels": {"openai": [], "gemini": []},
    }

    # CORS 기본값은 README대로 로컬 웹 앱 하나뿐이다 — 배포 출처는 배포 설정(fly.toml [env])이 넣는다.
    import main

    assert main.ALLOWED_ORIGINS == {"http://localhost:5173"}, main.ALLOWED_ORIGINS

    r = client.post("/proxy/openai", json={"model": "x", "input": "hi"})
    assert r.status_code == 404, r.text

    r = client.post("/proxy/gemini/gemini-3.8-flash", json={"contents": []})
    assert r.status_code == 404, r.text

    run_ratelimit_and_model_validation()
    run_proxy_guards(client)
    run_export_limits(client, raw_export)
    run_event_loop_not_blocked()

    print("모든 테스트 통과")


def run_ratelimit_and_model_validation() -> None:
    """네트워크 호출 없이 확인 가능한 순수 로직 — 레이트리밋 카운터와 모델명 검증."""
    from ratelimit import InMemoryRateLimiter

    limiter = InMemoryRateLimiter()
    for _ in range(3):
        assert limiter.check("1.2.3.4", 3) is True
    assert limiter.check("1.2.3.4", 3) is False, "한도를 넘으면 False여야 한다"
    assert limiter.check("5.6.7.8", 3) is True, "다른 키는 별도 카운터를 써야 한다"

    from main import _MODEL_NAME_RE, _client_ip

    assert _MODEL_NAME_RE.match("gemini-3.8-flash")
    assert not _MODEL_NAME_RE.match("../etc/passwd")
    assert not _MODEL_NAME_RE.match("model?x=1")

    # 신뢰 헤더 변수가 없으면 Fly-Client-IP·X-Forwarded-For를 무시한다 — 프록시 없는 배포에서 헤더를
    # 믿으면 요청마다 IP를 꾸며 한도를 무한히 우회할 수 있다.
    import main
    from types import SimpleNamespace

    def fake_request(headers: dict, host: str = "10.0.0.1"):
        return SimpleNamespace(headers=headers, client=SimpleNamespace(host=host))

    assert main.TRUSTED_IP_HEADER == ""
    assert _client_ip(fake_request({"fly-client-ip": "203.0.113.9", "x-forwarded-for": "1.1.1.1"})) == "10.0.0.1"
    assert _client_ip(fake_request({"x-forwarded-for": "1.1.1.1, 203.0.113.9"})) == "10.0.0.1"
    assert _client_ip(fake_request({})) == "10.0.0.1"

    original_header = main.TRUSTED_IP_HEADER
    try:
        # Fly: 단일 값 헤더. 다른 헤더는 여전히 무시하고, 값이 비어 있으면 소켓 IP로 돌아간다.
        main.TRUSTED_IP_HEADER = "fly-client-ip"
        assert _client_ip(fake_request({"fly-client-ip": "203.0.113.9", "x-forwarded-for": "1.1.1.1"})) == "203.0.113.9"
        assert _client_ip(fake_request({"x-forwarded-for": "1.1.1.1"})) == "10.0.0.1"
        assert _client_ip(fake_request({"fly-client-ip": "   "})) == "10.0.0.1"
        # X-Forwarded-For: 방문자가 앞에 덧붙인 값이 아니라 프록시가 마지막에 붙인 값을 쓴다.
        main.TRUSTED_IP_HEADER = "x-forwarded-for"
        assert _client_ip(fake_request({"x-forwarded-for": "1.1.1.1, 203.0.113.9"})) == "203.0.113.9"
        assert _client_ip(fake_request({"x-forwarded-for": "203.0.113.9"})) == "203.0.113.9"
        assert _client_ip(fake_request({"fly-client-ip": "203.0.113.9"})) == "10.0.0.1"
    finally:
        main.TRUSTED_IP_HEADER = original_header


class FakeUpstream:
    status_code = 200
    content = b'{"ok": true}'


class FakeUpstreamClient:
    """main._upstream_client()가 돌려주는 AsyncClient 대역 — post 코루틴만 흉내 낸다."""

    def __init__(self, sent: list, fail_with: Exception | None = None):
        self.sent = sent
        self.fail_with = fail_with
        # 요청마다 넘어온 httpx.Timeout — 읽기 한도가 출력 토큰 상한에 비례하는지 확인한다
        self.timeouts: list = []

    async def post(self, url, json=None, headers=None, timeout=None):
        self.timeouts.append(timeout)
        if self.fail_with is not None:
            raise self.fail_with
        self.sent.append((url, json))
        return FakeUpstream()


def run_proxy_guards(client: TestClient) -> None:
    """공유 키 프록시의 비용 방어 — 벤더 호출은 가짜로 바꿔 네트워크 없이 확인한다."""
    import main

    sent = []
    fake_client = FakeUpstreamClient(sent)

    original_key, original_client = main.SHARED_OPENAI_API_KEY, main._upstream_client
    original_gemini_key = main.SHARED_GEMINI_API_KEY
    main.SHARED_OPENAI_API_KEY = "test-shared-key"
    main.SHARED_GEMINI_API_KEY = "test-shared-gemini"
    main._upstream_client = lambda: fake_client
    try:
        ok_headers = {"Origin": "http://localhost:5173", "Content-Type": "application/json"}

        # 키가 있으면 /config는 그 키로 쓸 수 있는 허용 모델 목록도 내려준다(키 자체는 없다)
        r = client.get("/config")
        assert r.status_code == 200, r.text
        assert r.json() == {
            "sharedProviders": {"openai": True, "gemini": True},
            "sharedModels": {
                "openai": sorted(main.SHARED_OPENAI_MODELS),
                "gemini": sorted(main.SHARED_GEMINI_MODELS),
            },
        }, r.text
        assert "test-shared" not in r.text

        # 허용하지 않는 Origin은 키가 있어도 거부
        r = client.post(
            "/proxy/openai",
            content=json.dumps({"model": "gpt-5.6-sol", "input": "hi"}),
            headers={"Origin": "https://evil.example", "Content-Type": "application/json"},
        )
        assert r.status_code == 403, r.text

        # 허용 목록 밖 모델은 거부 — 방문자가 비싼 모델을 고르지 못한다
        r = client.post(
            "/proxy/openai", content=json.dumps({"model": "gpt-99-max", "input": "hi"}), headers=ok_headers
        )
        assert r.status_code == 400, r.text

        # 허용 모델은 전달하되 stream을 떼고 출력 토큰을 상한으로 자른다
        r = client.post(
            "/proxy/openai",
            content=json.dumps({"model": "gpt-5.6-sol", "input": "hi", "stream": True, "max_output_tokens": 10_000_000}),
            headers=ok_headers,
        )
        assert r.status_code == 200, r.text
        url, forwarded = sent[-1]
        assert url == "https://api.openai.com/v1/responses"
        assert "stream" not in forwarded
        assert forwarded["max_output_tokens"] == main.PROXY_MAX_OUTPUT_TOKENS

        # 본문 크기 상한
        r = client.post(
            "/proxy/openai",
            content=b'{"model": "gpt-5.6-sol", "input": "' + b"x" * (main.PROXY_MAX_BODY_BYTES + 1) + b'"}',
            headers=ok_headers,
        )
        assert r.status_code == 413, r.text

        # Gemini: 경로의 모델도 허용 목록을 따르고 maxOutputTokens를 자른다
        r = client.post("/proxy/gemini/gemini-99-ultra", content=json.dumps({"contents": []}), headers=ok_headers)
        assert r.status_code == 400, r.text
        r = client.post(
            "/proxy/gemini/gemini-3.8-flash",
            content=json.dumps({"contents": [], "generationConfig": {"maxOutputTokens": 10_000_000}}),
            headers=ok_headers,
        )
        assert r.status_code == 200, r.text
        _, forwarded = sent[-1]
        assert forwarded["generationConfig"]["maxOutputTokens"] == main.PROXY_MAX_OUTPUT_TOKENS

        # 상류 읽기 한도는 요청의 출력 토큰 상한에 비례한다(토큰당 30ms, 바닥 300초) — 브라우저 클라이언트가
        # 한 번에 받는 호출에 기다리는 산식과 같아서 긴 생성을 서버가 먼저 끊지 않는다. 다만 edge 유휴 한도
        # (Fly 최댓값 900초) 아래에 머물도록 780초에서 멈춘다 — 브라우저 여유 60초를 더해도 840초다
        assert main.PROXY_UPSTREAM_TIMEOUT_SECONDS == 300.0
        assert main.PROXY_UPSTREAM_TIMEOUT_CEILING_SECONDS == 780.0
        assert main.PROXY_SECONDS_PER_OUTPUT_TOKEN == 0.03
        r = client.post(
            "/proxy/openai",
            content=json.dumps({"model": "gpt-5.6-sol", "input": "hi", "max_output_tokens": 1_000}),
            headers=ok_headers,
        )
        assert r.status_code == 200, r.text
        assert fake_client.timeouts[-1].read == 300.0
        assert fake_client.timeouts[-1].connect == 10.0
        r = client.post(
            "/proxy/openai",
            content=json.dumps({"model": "gpt-5.6-sol", "input": "hi", "max_output_tokens": 20_000}),
            headers=ok_headers,
        )
        assert r.status_code == 200, r.text
        assert fake_client.timeouts[-1].read == 600.0
        # 상한으로 잘린 요청은 잘린 값 기준 — 잘라 놓고 원래 값만큼 기다리지 않는다. 그 값(65,536토큰 →
        # 약 1,966초)도 edge 한도를 넘으므로 읽기 한도 상한(780초)에서 멈춘다
        r = client.post(
            "/proxy/gemini/gemini-3.8-flash",
            content=json.dumps({"contents": [], "generationConfig": {"maxOutputTokens": 10_000_000}}),
            headers=ok_headers,
        )
        assert r.status_code == 200, r.text
        assert main.PROXY_MAX_OUTPUT_TOKENS * 0.03 > main.PROXY_UPSTREAM_TIMEOUT_CEILING_SECONDS
        assert fake_client.timeouts[-1].read == main.PROXY_UPSTREAM_TIMEOUT_CEILING_SECONDS
        # 상한 안쪽(40,000토큰 → 1,200초)도 상한에서 멈춘다 — 잘리지 않은 요청이라도 edge보다 늦게 끊을 수는 없다
        r = client.post(
            "/proxy/openai",
            content=json.dumps({"model": "gpt-5.6-sol", "input": "hi", "max_output_tokens": 40_000}),
            headers=ok_headers,
        )
        assert r.status_code == 200, r.text
        assert fake_client.timeouts[-1].read == 780.0

        # 상류 시간 초과는 504 — 끊긴 생성도 벤더 쪽에서는 과금되므로 클라이언트가 재시도하지 않도록 502와 구분한다
        import httpx

        main._upstream_client = lambda: FakeUpstreamClient(sent, httpx.ReadTimeout("read timed out"))
        r = client.post(
            "/proxy/openai", content=json.dumps({"model": "gpt-5.6-sol", "input": "hi"}), headers=ok_headers
        )
        assert r.status_code == 504, r.text
        assert "재시도하지" in r.json()["detail"], r.text
        r = client.post("/proxy/gemini/gemini-3.8-flash", content=json.dumps({"contents": []}), headers=ok_headers)
        assert r.status_code == 504, r.text

        # 그 외 연결 실패는 여전히 502
        main._upstream_client = lambda: FakeUpstreamClient(sent, httpx.ConnectError("connection refused"))
        r = client.post(
            "/proxy/openai", content=json.dumps({"model": "gpt-5.6-sol", "input": "hi"}), headers=ok_headers
        )
        assert r.status_code == 502, r.text
        # 응답을 읽는 도중 끊긴 것도 벤더는 처리 중이므로 504 — 재시도 금지
        main._upstream_client = lambda: FakeUpstreamClient(sent, httpx.ReadError("connection reset"))
        r = client.post(
            "/proxy/openai", content=json.dumps({"model": "gpt-5.6-sol", "input": "hi"}), headers=ok_headers
        )
        assert r.status_code == 504, r.text
        assert "재시도하지" in r.json()["detail"], r.text
        # 연결 시간 초과는 벤더에 요청이 닿지 않은 것이라 504가 아니라 502 — 클라이언트가 안전하게 재시도한다
        main._upstream_client = lambda: FakeUpstreamClient(sent, httpx.ConnectTimeout("connect timed out"))
        r = client.post(
            "/proxy/openai", content=json.dumps({"model": "gpt-5.6-sol", "input": "hi"}), headers=ok_headers
        )
        assert r.status_code == 502, r.text
        assert "재시도하지" not in r.json()["detail"], r.text
    finally:
        main.SHARED_OPENAI_API_KEY = original_key
        main.SHARED_GEMINI_API_KEY = original_gemini_key
        main._upstream_client = original_client


def run_export_limits(client: TestClient, raw_export: bytes) -> None:
    """POST /exports의 남용 방어 — IP별 저장 횟수 제한(프록시와 별도 버킷)과 DB 총량 상한."""
    import main
    from ratelimit import InMemoryRateLimiter

    ok_headers = {"Origin": "http://localhost:5173", "Content-Type": "application/json"}
    envelope = json.loads(raw_export)

    def stamped(run_id: str, padding: int = 0) -> bytes:
        value = json.loads(json.dumps(envelope, ensure_ascii=False))
        value["result"]["checkpoint"]["runId"] = run_id
        if padding:
            value["project"]["interview"]["answers"]["padding"] = "x" * padding
        return json.dumps(value, ensure_ascii=False).encode("utf-8")

    assert main.EXPORT_RATE_LIMIT_PER_HOUR == 30
    original_limiter, original_limit = main.rate_limiter, main.EXPORT_RATE_LIMIT_PER_HOUR
    original_key, original_client = main.SHARED_OPENAI_API_KEY, main._upstream_client
    original_db_max = main.DB_MAX_BYTES
    main.rate_limiter = InMemoryRateLimiter()
    main.EXPORT_RATE_LIMIT_PER_HOUR = 2
    main.SHARED_OPENAI_API_KEY = "test-shared-key"
    main._upstream_client = lambda: FakeUpstreamClient([])
    try:
        # 프록시 호출은 저장 버킷을 소모하지 않는다
        r = client.post(
            "/proxy/openai", content=json.dumps({"model": "gpt-5.6-sol", "input": "hi"}), headers=ok_headers
        )
        assert r.status_code == 200, r.text
        # 형식 오류(422)도 저장 횟수를 깎지 않는다
        r = client.post("/exports", content=b'{"kind": "nope"}', headers=ok_headers)
        assert r.status_code == 422, r.text
        for index in range(2):
            r = client.post("/exports", content=stamped(f"run-limit-{index}"), headers=ok_headers)
            assert r.status_code == 201, r.text
        r = client.post("/exports", content=stamped("run-limit-over"), headers=ok_headers)
        assert r.status_code == 429, r.text
        assert "시간당 2회" in r.json()["detail"], r.text
        # 저장 한도에 걸려도 프록시 버킷은 따로 센다
        r = client.post(
            "/proxy/openai", content=json.dumps({"model": "gpt-5.6-sol", "input": "hi"}), headers=ok_headers
        )
        assert r.status_code == 200, r.text

        # DB 총량 상한 — 현재 크기로 고정되면 새 페이지가 필요한 저장은 500이 아니라 507로 거부한다
        main.rate_limiter = InMemoryRateLimiter()
        assert main.DB_MAX_BYTES == 800 * 1024 * 1024
        main.DB_MAX_BYTES = 1
        with sqlite3.connect(_tmp.name) as conn:
            count_before = conn.execute("SELECT COUNT(*) FROM project_exports").fetchone()[0]
        big_export = stamped("run-too-big", padding=200_000)
        r = client.post("/exports", content=big_export, headers=ok_headers)
        assert r.status_code == 507, r.text
        assert "저장 공간" in r.json()["detail"], r.text
        with sqlite3.connect(_tmp.name) as conn:
            assert conn.execute("SELECT COUNT(*) FROM project_exports").fetchone()[0] == count_before
        # 상한을 되돌리면 같은 봉투가 저장된다 — 거부 사유가 상한이었음을 확인
        main.DB_MAX_BYTES = original_db_max
        r = client.post("/exports", content=big_export, headers=ok_headers)
        assert r.status_code == 201, r.text
        r = client.get(f"/exports/{r.json()['id']}")
        assert r.status_code == 200 and r.content == big_export
    finally:
        main.rate_limiter = original_limiter
        main.EXPORT_RATE_LIMIT_PER_HOUR = original_limit
        main.SHARED_OPENAI_API_KEY = original_key
        main._upstream_client = original_client
        main.DB_MAX_BYTES = original_db_max


def run_event_loop_not_blocked() -> None:
    """벤더 응답을 기다리는 동안 이벤트 루프가 멈추지 않는다 — 다른 사용자의 /health·/exports가 함께 대기하지 않는다."""
    import asyncio
    import threading
    import time

    import main

    class SlowUpstreamClient:
        async def post(self, url, json=None, headers=None, timeout=None):
            await asyncio.sleep(1.5)
            return FakeUpstream()

    original_key, original_client = main.SHARED_OPENAI_API_KEY, main._upstream_client
    main.SHARED_OPENAI_API_KEY = "test-shared-key"
    main._upstream_client = lambda: SlowUpstreamClient()
    ok_headers = {"Origin": "http://localhost:5173", "Content-Type": "application/json"}
    try:
        # 컨텍스트 매니저로 열어야 요청들이 하나의 이벤트 루프를 공유한다(아니면 요청마다 새 루프).
        with TestClient(app) as shared:
            outcome = {}

            def slow_proxy():
                outcome["status"] = shared.post(
                    "/proxy/openai",
                    content=json.dumps({"model": "gpt-5.6-sol", "input": "hi"}),
                    headers=ok_headers,
                ).status_code

            worker = threading.Thread(target=slow_proxy)
            worker.start()
            time.sleep(0.3)  # 프록시 핸들러가 상류 대기에 들어갈 시간
            started = time.monotonic()
            r = shared.get("/health")
            elapsed = time.monotonic() - started
            worker.join()
            assert r.status_code == 200, r.text
            assert elapsed < 1.0, f"프록시 대기 중 /health가 {elapsed:.2f}초 걸렸다 — 이벤트 루프가 막혔다"
            assert outcome["status"] == 200, outcome
    finally:
        main.SHARED_OPENAI_API_KEY = original_key
        main._upstream_client = original_client


if __name__ == "__main__":
    try:
        run()
    finally:
        try:
            os.unlink(_tmp.name)
        except PermissionError:
            pass
    sys.exit(0)
