"""Gemini API 호출을 감싸는 아주 얇은 래퍼.

generator.py와 judge.py가 이 모듈을 통해서만 API를 부른다.
"""

import os
import time

from google import genai
from google.genai import errors as genai_errors

_MAX_ATTEMPTS = 4
_BASE_DELAY_SECONDS = 5


def make_client() -> genai.Client:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY가 설정되지 않았습니다. "
            "experiments/sandbox/.env 파일에 GEMINI_API_KEY=발급받은키 형식으로 넣어주세요."
        )
    return genai.Client(api_key=api_key)


def call(client: genai.Client, model: str, prompt: str) -> str:
    last_error: Exception | None = None

    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            response = client.models.generate_content(model=model, contents=prompt)
            text = getattr(response, "text", None)
            if not text:
                raise RuntimeError(f"Gemini 응답에서 텍스트를 못 읽었습니다: {response!r}")
            return text.strip()
        except genai_errors.ServerError as error:
            last_error = error
            if attempt == _MAX_ATTEMPTS:
                break
            delay = _BASE_DELAY_SECONDS * attempt
            print(f"[gemini] 서버 일시 오류({error}) — {delay}초 후 재시도 ({attempt}/{_MAX_ATTEMPTS})")
            time.sleep(delay)

    raise RuntimeError(f"Gemini 호출이 {_MAX_ATTEMPTS}번 모두 실패했습니다: {last_error}")
