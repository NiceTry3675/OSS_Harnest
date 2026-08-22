"""Judge — 동결된 쪽.

채점 프롬프트는 이 파일 안에 없다. judge_prompt.frozen.txt에 있고,
그 파일의 sha256 해시가 judge_prompt.frozen.sha256에 잠겨있다.

judge_prompt.frozen.txt를 고치면, 아래 _load_frozen_prompt()가
해시 불일치를 감지해서 즉시 에러를 낸다 — "몰래 못 바꾸게" 만드는 최소한의 장치.
의도적으로 채점 기준을 바꾸고 싶으면, judge_prompt.frozen.sha256을 재계산해서
갱신해야 한다 (= interview_schema.md가 말하는 "재승인").
"""

import hashlib
from pathlib import Path

from gemini_client import call

_SANDBOX_DIR = Path(__file__).parent
_PROMPT_PATH = _SANDBOX_DIR / "judge_prompt.frozen.txt"
_HASH_PATH = _SANDBOX_DIR / "judge_prompt.frozen.sha256"

_VERDICT_SCORE = {"정답": 1.0, "부분": 0.5, "오답": 0.0}


def _load_frozen_prompt() -> str:
    text = _PROMPT_PATH.read_text(encoding="utf-8")
    actual_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
    expected_hash = _HASH_PATH.read_text(encoding="utf-8").strip()

    if actual_hash != expected_hash:
        raise RuntimeError(
            "동결 위반: judge_prompt.frozen.txt가 승인 시점 해시와 다릅니다.\n"
            f"  기대 해시: {expected_hash}\n"
            f"  실제 해시: {actual_hash}\n"
            "의도적인 수정이라면 judge_prompt.frozen.sha256을 재계산해서 갱신하세요 "
            "(sha256sum judge_prompt.frozen.txt)."
        )
    return text


# 모듈이 import되는 순간 검증한다 — 채점이 시작되기도 전에 걸러낸다.
FROZEN_TEMPLATE = _load_frozen_prompt()


def grade(client, model: str, artifact: str, questions: list[dict]) -> dict:
    """산출물 하나를 문항별로 채점한다. 문항마다 별도 호출 — 서로 영향 안 주게."""
    detail = []
    total = 0.0

    for q in questions:
        prompt = FROZEN_TEMPLATE.format(
            artifact=artifact, question=q["prompt"], answer_key=q["answer_key"]
        )
        raw = call(client, model, prompt)
        verdict, reason = _parse_verdict(raw)
        score = _VERDICT_SCORE.get(verdict, 0.0)
        total += score
        detail.append(
            {
                "id": q["id"],
                "prompt": q["prompt"],
                "verdict": verdict,
                "reason": reason,
                "score": score,
            }
        )

    max_total = len(questions) or 1
    percent = round((total / max_total) * 100)
    return {"percent": percent, "raw_total": total, "max_total": len(questions), "detail": detail}


def _parse_verdict(raw: str) -> tuple[str, str]:
    verdict = "오답"
    reason = raw.strip()

    for line in raw.splitlines():
        line = line.strip()
        if line.startswith("판정"):
            value = line.split(":", 1)[-1].strip()
            for candidate in ("정답", "부분", "오답"):
                if candidate in value:
                    verdict = candidate
                    break
        elif line.startswith("이유"):
            reason = line.split(":", 1)[-1].strip()

    return verdict, reason
