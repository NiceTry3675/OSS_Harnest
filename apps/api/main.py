"""Harnest 선택형 저장 API — CRUD 전용, 임의 코드 실행 없음 (SPEC §7).

저장은 받은 JSON을 문자열 그대로 보존한다: 서버는 판정 절차(pack)를
해석·변경하지 않고, 승인된 그대로 돌려주는 것이 계약이다.
"""

import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# 테스트가 임시 DB를 쓸 수 있도록 환경변수 우회 허용. 기본은 이 파일 옆 harnest.db
DB_PATH = os.environ.get(
    "HARNEST_DB", os.path.join(os.path.dirname(os.path.abspath(__file__)), "harnest.db")
)

app = FastAPI(title="Harnest API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH)
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with db() as conn:
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


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


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
