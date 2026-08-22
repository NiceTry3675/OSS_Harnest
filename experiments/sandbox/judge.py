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
    """산출물 하나를 문항 전체 한 번의 호출로 채점한다 (호출 수를 아끼기 위해 배치).

    문항마다 따로 부르던 이전 방식보다 API 호출을 N배 아낀다 — 대신 프롬프트가
    "문제끼리는 서로 독립적으로 채점하라"고 명시해서 서로 영향 안 주게 방어한다.
    """
    questions_block = "\n".join(
        f"{q['id']}. {q['prompt']}\n   정답 키: {q['answer_key']}" for q in questions
    )
    prompt = FROZEN_TEMPLATE.format(artifact=artifact, questions_block=questions_block)
    raw = call(client, model, prompt)
    parsed = _parse_batch(raw)

    detail = []
    total = 0.0
    for q in questions:
        verdict, reason = parsed.get(q["id"], ("오답", "채점 응답에서 이 문항을 못 찾았습니다 (파싱 실패)"))
        score = _VERDICT_SCORE.get(verdict, 0.0)
        total += score
        detail.append(
            {"id": q["id"], "prompt": q["prompt"], "verdict": verdict, "reason": reason, "score": score}
        )

    max_total = len(questions) or 1
    percent = round((total / max_total) * 100)
    return {"percent": percent, "raw_total": total, "max_total": len(questions), "detail": detail}


def _parse_batch(raw: str) -> dict[str, tuple[str, str]]:
    """`Q1: 판정=정답 | 이유=...` 형식의 줄들을 {id: (verdict, reason)}으로 파싱."""
    results: dict[str, tuple[str, str]] = {}
    for line in raw.splitlines():
        line = line.strip()
        if not line or ":" not in line:
            continue
        qid, _, rest = line.partition(":")
        qid = qid.strip()
        verdict = "오답"
        reason = rest.strip()
        for part in rest.split("|"):
            part = part.strip()
            if part.startswith("판정"):
                value = part.split("=", 1)[-1].strip()
                for candidate in ("정답", "부분", "오답"):
                    if candidate in value:
                        verdict = candidate
                        break
            elif part.startswith("이유"):
                reason = part.split("=", 1)[-1].strip()
        results[qid] = (verdict, reason)
    return results
