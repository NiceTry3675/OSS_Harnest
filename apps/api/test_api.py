"""API 왕복 테스트 — python3 test_api.py 로 실행, 실패 시 비정상 종료.

main 임포트 전에 HARNEST_DB를 임시 파일로 지정해 실 DB를 건드리지 않는다.
"""

import os
import sys
import tempfile

_tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_tmp.close()
os.environ["HARNEST_DB"] = _tmp.name

from fastapi.testclient import TestClient  # noqa: E402

from main import app  # noqa: E402


def run() -> None:
    client = TestClient(app)

    # health
    r = client.get("/health")
    assert r.status_code == 200, r.text
    assert r.json() == {"status": "ok"}

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

    # 404 검증
    r = client.get("/projects/no-such-id")
    assert r.status_code == 404, r.text
    r = client.post("/projects/no-such-id/results", json={"checkpoint": checkpoint})
    assert r.status_code == 404, r.text

    print("모든 테스트 통과")


if __name__ == "__main__":
    try:
        run()
    finally:
        os.unlink(_tmp.name)
    sys.exit(0)
