"""생성 엔진 (미니 버전) — 이 제품의 핵심 차별점.

PHILOSOPHY: "동결 메커니즘은 흔하다. 동결할 평가자를 5분 만에 뽑아주는 것은 흔하지 않다."

입력: 원본 자료 + 목표 + 분량 제한 (사용자가 인터뷰에서 주는 것)
출력: 채점 기준 = 평가 문항 + 정답 키 (= Evaluation Pack의 씨앗)

**여기가 하드코딩이 있으면 안 되는 자리다.** 문항과 정답 키는 사람이 쓰는 게 아니라
이 agent가 자료로부터 만들어야 한다. 그래야 도메인이 바뀌어도 코드 변경 없이 돌아간다.

각 문항에 `kind`를 붙인다("사실확인" / "비교판단") — 오늘 노이즈 측정에서
"비교판단형 문항이 채점 노이즈원"이라는 관찰(n=1)이 나왔으므로, 그게 재현되는지
측정할 수 있게 계측을 심어두는 것. 규칙으로 하드코딩하지 않고 관측 가능하게만 만든다.
(judge_noise-measurement.md §3, §6 참고)
"""

import json
import re

from gemini_client import call

RUBRIC_PROMPT = """당신은 시험 출제자입니다. 아래 [원본 자료]를 공부한 학생이 만든 **요약본**을 채점할 평가 문항을 만드세요.

목표: {goal}
요약본 분량 제한: {length_limit}자 (원본 {source_length}자를 약 {ratio:.1f}배로 압축해야 함)

출제 원칙:
- 요약본이 원본의 **중요한 내용을 보존했는지** 검증하는 문항이어야 합니다.
- 분량 제한 때문에 학생은 반드시 무언가를 버려야 합니다. 문항은 자료 전체에 고르게 분포시켜, 한쪽만 잘 요약하고 다른 쪽을 버리면 점수가 깎이게 만드세요.
- 단순 용어 정의만 묻지 말고, 조건·예외·비교·트레이드오프처럼 **자료가 실제로 다루는 중요한 내용**을 물으세요.
- 자료에 없는 내용은 절대 묻지 마세요.
- 각 문항에는 정답의 핵심 요소를 담은 정답 키를 함께 쓰세요.
- 각 문항을 다음 둘 중 하나로 분류하세요:
  - "사실확인": 자료에 적힌 사실·정의·목록을 그대로 확인하면 답할 수 있는 문항
  - "비교판단": 둘 이상을 비교하거나, 이유·트레이드오프를 판단해야 답할 수 있는 문항

[원본 자료]
{source_material}

정확히 {question_count}개의 문항을 만들고, 아래 JSON 형식으로만 출력하세요. 다른 텍스트는 절대 추가하지 마세요.

{{
  "questions": [
    {{"id": "Q1", "prompt": "문항 내용", "answer_key": "정답의 핵심 요소", "kind": "사실확인"}},
    {{"id": "Q2", "prompt": "문항 내용", "answer_key": "정답의 핵심 요소", "kind": "비교판단"}}
  ]
}}"""


def make_rubric(
    client,
    model: str,
    goal: str,
    source_material: str,
    length_limit: int,
    question_count: int = 8,
) -> list[dict]:
    """자료로부터 평가 문항 + 정답 키를 생성한다. 사람이 쓰지 않는다."""
    prompt = RUBRIC_PROMPT.format(
        goal=goal,
        length_limit=length_limit,
        source_length=len(source_material),
        ratio=len(source_material) / length_limit,
        source_material=source_material,
        question_count=question_count,
    )
    raw = call(client, model, prompt)
    return _parse_questions(raw)


def _parse_questions(raw: str) -> list[dict]:
    """모델이 코드펜스나 잡담을 붙여도 JSON만 뽑아낸다."""
    text = raw.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()

    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1:
        raise RuntimeError(f"생성 엔진 응답에서 JSON을 못 찾았습니다:\n{raw[:400]}")

    data = json.loads(text[start : end + 1])
    questions = data.get("questions", [])
    if not questions:
        raise RuntimeError(f"생성된 문항이 비어 있습니다:\n{raw[:400]}")

    normalized = []
    for i, q in enumerate(questions, start=1):
        normalized.append(
            {
                "id": q.get("id") or f"Q{i}",
                "prompt": q["prompt"],
                "answer_key": q["answer_key"],
                "kind": q.get("kind", "미분류"),
            }
        )
    return normalized
