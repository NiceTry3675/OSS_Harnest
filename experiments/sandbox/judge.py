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


def check_gates(artifact: str, gates: list[dict] | None) -> list[dict]:
    """Hard gate 평가 — 가중치로 상쇄될 수 없는 규칙 (SPEC §3 원칙 4).

    **결정적으로만 검사한다.** 분량 같은 건 LLM 판단이 필요 없고, LLM에게 맡기면
    그 자체가 노이즈원이 된다. 저지 프롬프트에 문장으로 넣는 것으로는 못 막는다는 걸
    실측으로 확인했다 (generation-engine-and-verbosity-hack.md §4 — 장황함 인플레).

    onFail: "reject"(실격, 채택 불가) / "cap"(점수 상한, capScore 필수)
    """
    results = []
    for gate in gates or []:
        scorer = gate.get("scorer")
        params = gate.get("params", {})

        if scorer == "length_within":
            limit = params.get("max", 0)
            actual = len(artifact)
            passed = actual <= limit
            detail = f"{actual}자 / 제한 {limit}자"
        else:
            # 모르는 scorer는 통과시키지 않고 명시적으로 실패 처리한다 —
            # 조용히 통과시키면 게이트가 있다고 착각하게 된다.
            passed = False
            detail = f"알 수 없는 scorer: {scorer}"

        results.append(
            {
                "id": gate.get("id", scorer),
                "scorer": scorer,
                "onFail": gate.get("onFail", "reject"),
                "capScore": gate.get("capScore"),
                "passed": passed,
                "detail": detail,
            }
        )
    return results


def grade(client, model: str, artifact: str, questions: list[dict], gates: list[dict] | None = None) -> dict:
    """산출물 하나를 문항 전체 한 번의 호출로 채점한다 (호출 수를 아끼기 위해 배치).

    문항마다 따로 부르던 이전 방식보다 API 호출을 N배 아낀다 — 대신 프롬프트가
    "문제끼리는 서로 독립적으로 채점하라"고 명시해서 서로 영향 안 주게 방어한다.

    gates가 있으면 hard gate를 먼저 평가한다. reject 게이트를 어기면 LLM 채점을
    아예 하지 않는다 — 호출도 아끼고, "실격인데 점수는 높다"는 혼란도 없앤다.
    """
    gate_results = check_gates(artifact, gates)
    rejected = [g for g in gate_results if not g["passed"] and g["onFail"] == "reject"]

    if rejected:
        reason = "; ".join(f"{g['id']}({g['detail']})" for g in rejected)
        return {
            "percent": 0,
            "raw_total": 0.0,
            "max_total": len(questions),
            "detail": [
                {
                    "id": q["id"],
                    "prompt": q["prompt"],
                    "verdict": "실격",
                    "reason": f"hard gate 위반: {reason}",
                    "score": 0.0,
                }
                for q in questions
            ],
            "gates": gate_results,
            "disqualified": True,
        }

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

    # cap 게이트: 실격은 아니지만 점수 상한을 씌운다.
    capped_by = None
    for g in gate_results:
        if not g["passed"] and g["onFail"] == "cap" and g.get("capScore") is not None:
            if percent > g["capScore"]:
                percent = g["capScore"]
                capped_by = g["id"]

    return {
        "percent": percent,
        "raw_total": total,
        "max_total": len(questions),
        "detail": detail,
        "gates": gate_results,
        "disqualified": False,
        "cappedBy": capped_by,
    }


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
