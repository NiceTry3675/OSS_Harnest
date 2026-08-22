"""Vertex AI 서비스 계정 토큰 헬퍼 — 키 파일은 GOOGLE_APPLICATION_CREDENTIALS 경로에서
google-auth가 직접 읽는다(키 내용을 로그·stdout에 출력하지 않는다)."""

import os
import time

_cache = {"token": None, "exp": 0.0}


def get_token():
    if _cache["token"] and time.time() < _cache["exp"]:
        return _cache["token"]
    from google.oauth2 import service_account
    from google.auth.transport.requests import Request
    creds = service_account.Credentials.from_service_account_file(
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"],
        scopes=["https://www.googleapis.com/auth/cloud-platform"],
    )
    creds.refresh(Request())
    _cache["token"] = creds.token
    _cache["exp"] = time.time() + 50 * 60
    return creds.token
