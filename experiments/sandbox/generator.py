"""Generator — 자유롭게 굴러도 되는 쪽.

프롬프트를 여기서 얼마든지 고쳐도 된다. 이 파일에는 "동결"이 없다.
Judge(judge.py)와 대비시키기 위해 일부러 잠금 장치를 안 걸어놨다.
"""

from gemini_client import call

SEED_PROMPT = """다음 자료를 요약해줘.

목표: {goal}
분량 제한: {length_limit}자 이내

[원본 자료]
{source_material}

요약본 텍스트만 출력하세요. 설명이나 머리말 없이 요약본 자체만 주세요."""

REVISE_PROMPT = """다음 요약본을 아래 채점 피드백을 반영해서 개선해줘.

분량 제한: {length_limit}자 이내

[현재 요약본]
{current_artifact}

[채점 피드백 — 이 부분이 부족했습니다]
{feedback}

개선된 요약본 텍스트만 출력하세요. 설명이나 머리말 없이 요약본 자체만 주세요."""

# 형식 실험용 (experiments/one-shot-vs-loop-delta.md §7) — 구조화(목록/콜아웃)가
# 진짜 변수였는지 확인하기 위해 원샷에만 강제로 붙이는 제약. revise()에는 안 붙인다
# (반복 라운드는 원래대로 자유롭게 둬서, "원샷 한정" 효과만 분리해서 본다).
PROSE_STYLE_INSTRUCTION = (
    "\n\n형식 제약: 번호·글머리 기호·목록·콜아웃(예: '※', '핵심 포인트:') 없이, "
    "오직 흐르는 문단(prose) 형태로만 쓰세요. 항목을 나열하지 말고 문장으로 연결해서 서술하세요."
)


def generate_seed(
    client, model: str, goal: str, source_material: str, length_limit: int, style: str | None = None
) -> str:
    """라운드 0 — 원샷 베이스라인을 만든다. 피드백 없이 딱 한 번."""
    prompt = SEED_PROMPT.format(goal=goal, length_limit=length_limit, source_material=source_material)
    if style == "prose":
        prompt += PROSE_STYLE_INSTRUCTION
    return call(client, model, prompt)


def revise(client, model: str, current_artifact: str, feedback: str, length_limit: int) -> str:
    """이전 산출물 + 채점 피드백을 받아서 개선안을 만든다."""
    prompt = REVISE_PROMPT.format(
        current_artifact=current_artifact, feedback=feedback, length_limit=length_limit
    )
    return call(client, model, prompt)
