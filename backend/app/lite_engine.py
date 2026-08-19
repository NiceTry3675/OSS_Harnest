import re
from hashlib import sha1

from .schemas import Criteria, EvaluationSuggestion, InterviewPayload, LoopSpec, RunResult

TOKEN_PATTERN = re.compile(r"[A-Za-z][A-Za-z0-9+#.\-]{1,}|[가-힣]{2,}")

STOPWORDS = {
    "공고",
    "관련",
    "내용",
    "내용을",
    "대한",
    "붙여넣습니다",
    "사용",
    "서버",
    "업무",
    "여기에",
    "역량",
    "위해",
    "있는",
    "경험",
    "개발",
    "기반",
    "문제",
    "자기소개서",
    "채용",
    "지원",
    "프로젝트",
    "합니다",
}


def create_project_id(payload: InterviewPayload) -> str:
    seed = f"{payload.goal}:{payload.artifact.get('content', '')}"
    return f"project-{sha1(seed.encode('utf-8')).hexdigest()[:10]}"


def create_run_id(project_id: str) -> str:
    return f"run-{project_id.replace('project-', '')[:8]}"


def create_evaluation_suggestion(payload: InterviewPayload) -> EvaluationSuggestion:
    project_id = payload.projectId or create_project_id(payload)
    keywords = extract_keywords(answer_text(payload, "job_posting"))
    keyword_count = len(keywords)

    return EvaluationSuggestion(
        projectId=project_id,
        criteria=[
            Criteria(
                id="keyword-coverage",
                title="공고 핵심어 반영",
                kind="deterministic",
                weight=0.4,
                description=f"채용공고에서 추출한 핵심어 {keyword_count}개가 산출물에 얼마나 반영되는지 계산합니다.",
                locked=False,
            ),
            Criteria(
                id="must-include-fit",
                title="필수 맥락 반영",
                kind="deterministic",
                weight=0.4,
                description="사용자가 반드시 포함하라고 입력한 경험과 기술이 산출물에 반영되는지 계산합니다.",
                locked=False,
            ),
            Criteria(
                id="length-limit",
                title="글자 수 제한",
                kind="deterministic",
                weight=0.2,
                description="사용자가 입력한 제한을 넘지 않는지 실제 글자 수로 검사합니다.",
                locked=False,
            ),
        ],
    )


def create_loop_spec(payload: InterviewPayload) -> LoopSpec:
    if payload.evaluation is None:
        raise ValueError("evaluation must be approved before creating a loop spec")

    project_id = payload.projectId or create_project_id(payload)
    stop = payload.loop.get("stop", {})
    llm_route = payload.loop.get("llmRoute", "trial")

    if llm_route not in {"trial", "byok"}:
        llm_route = "trial"

    return LoopSpec(
        projectId=project_id,
        runId=create_run_id(project_id),
        criteriaLocked=True,
        maxIterations=int(payload.loop.get("maxIterations", 30)),
        stop={
            "targetScore": stop.get("targetScore", 80),
            "plateauRounds": stop.get("plateauRounds", 8),
        },
        llmRoute=llm_route,
    )


def run_lite_loop(loop_spec: LoopSpec, payload: InterviewPayload) -> RunResult:
    current_artifact = normalize_text(payload.artifact.get("content", ""))

    if not current_artifact:
        current_artifact = create_seed_artifact(payload)

    initial_score = score_artifact(current_artifact, payload)
    current_score = initial_score
    best_artifact = current_artifact
    nodes = [
        {
            "id": "seed",
            "round": 0,
            "title": "초기 산출물 채점",
            "score": initial_score,
            "status": "accepted",
            "note": "사용자 입력을 기준선으로 저장했습니다.",
        }
    ]

    max_rounds = min(loop_spec.maxIterations, 6)

    for round_index in range(1, max_rounds + 1):
        candidates = generate_candidates(best_artifact, payload, round_index)
        best_candidate = max(candidates, key=lambda candidate: candidate["score"])

        if best_candidate["score"] > current_score:
            best_artifact = best_candidate["content"]
            current_score = best_candidate["score"]
            nodes.append(
                {
                    "id": f"r{round_index}-accepted",
                    "round": round_index,
                    "title": best_candidate["title"],
                    "score": current_score,
                    "status": "accepted",
                    "note": best_candidate["note"],
                }
            )
        else:
            nodes.append(
                {
                    "id": f"r{round_index}-rejected",
                    "round": round_index,
                    "title": best_candidate["title"],
                    "score": best_candidate["score"],
                    "status": "rejected",
                    "note": "승인된 채점표 기준으로 기존 산출물보다 점수가 오르지 않아 폐기했습니다.",
                }
            )

        target_score = loop_spec.stop.targetScore
        if target_score is not None and current_score >= target_score:
            break

    return RunResult(
        runId=loop_spec.runId,
        startScore=initial_score,
        finalScore=current_score,
        nodes=nodes,
        diff={"before": current_artifact, "after": best_artifact},
        finalArtifact=best_artifact,
    )


def generate_candidates(content: str, payload: InterviewPayload, round_index: int) -> list[dict]:
    keywords = missing_keywords(content, payload)
    must_include = missing_must_include(content, payload)
    candidates = []

    if must_include:
        added = format_terms(must_include[:4])
        candidate = append_or_replace_generic(
            content,
            f"핵심 경험은 {added}이며, 이를 지원 직무에서 요구하는 문제 해결 역량과 연결해 설명했습니다.",
        )
        candidates.append(
            candidate_record(
                "필수 맥락 보강",
                candidate,
                payload,
                "사용자가 반드시 포함하라고 한 항목을 산출물의 핵심 문장으로 반영했습니다.",
            )
        )

    if keywords:
        added = format_terms(keywords[:5])
        candidate = append_sentence(
            content,
            f"채용공고에서 반복해서 요구한 {added} 항목을 기준으로 경험의 맥락을 재정리했습니다.",
        )
        candidates.append(
            candidate_record(
                "공고 핵심어 보강",
                candidate,
                payload,
                "채용공고에서 추출한 누락 핵심어를 산출물에 반영했습니다.",
            )
        )

    candidate = remove_generic_sentence(content)
    candidates.append(candidate_record("일반론 제거", candidate, payload, "점수에 기여하지 않는 일반적인 표현을 줄였습니다."))

    if round_index >= 3:
        candidate = trim_to_length(content, length_limit(payload))
        candidates.append(candidate_record("글자 수 제한 정리", candidate, payload, "제한 글자 수를 넘지 않도록 긴 문장을 줄였습니다."))

    return candidates


def candidate_record(title: str, content: str, payload: InterviewPayload, note: str) -> dict:
    return {
        "title": title,
        "content": content,
        "score": score_artifact(content, payload),
        "note": note,
    }


def score_artifact(content: str, payload: InterviewPayload) -> int:
    keyword_score = coverage_score(extract_keywords(answer_text(payload, "job_posting")), content)
    include_score = coverage_score(split_required_terms(answer_text(payload, "must_include")), content)
    length_score = length_constraint_score(content, length_limit(payload))
    return round(keyword_score * 0.4 + include_score * 0.4 + length_score * 0.2)


def coverage_score(terms: list[str], content: str) -> int:
    if not terms:
        return 100

    content_lower = content.lower()
    matched = sum(1 for term in terms if term.lower() in content_lower)
    return round((matched / len(terms)) * 100)


def length_constraint_score(content: str, limit: int) -> int:
    if limit <= 0:
        return 100

    length = len(content)
    if length <= limit:
        return 100

    over_ratio = (length - limit) / limit
    return max(0, round(100 - over_ratio * 100))


def extract_keywords(text: str) -> list[str]:
    tokens = TOKEN_PATTERN.findall(text)
    seen = set()
    keywords = []

    for token in tokens:
        normalized = token.strip().lower()
        if len(normalized) < 2 or normalized in STOPWORDS or normalized in seen:
            continue

        seen.add(normalized)
        keywords.append(token.strip())

    return keywords[:18]


def split_required_terms(text: str) -> list[str]:
    raw_terms = re.split(r"[,/·\n]| 및 |와 |과 ", text)
    terms = [clean_required_term(term) for term in raw_terms]
    terms = [term for term in terms if len(term) >= 2]
    return terms[:10]


def missing_keywords(content: str, payload: InterviewPayload) -> list[str]:
    return missing_terms(extract_keywords(answer_text(payload, "job_posting")), content)


def missing_must_include(content: str, payload: InterviewPayload) -> list[str]:
    return missing_terms(split_required_terms(answer_text(payload, "must_include")), content)


def missing_terms(terms: list[str], content: str) -> list[str]:
    content_lower = content.lower()
    return [term for term in terms if term.lower() not in content_lower]


def answer_text(payload: InterviewPayload, answer_id: str) -> str:
    answer = payload.answers.get(answer_id, {})
    value = answer.get("value", "")

    if isinstance(value, list):
        return ", ".join(str(item) for item in value)

    return str(value)


def length_limit(payload: InterviewPayload) -> int:
    answer = payload.answers.get("length_limit", {})
    value = answer.get("value", 1700)

    try:
        return int(value)
    except (TypeError, ValueError):
        return 1700


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def append_sentence(content: str, sentence: str) -> str:
    if sentence in content:
        return content

    separator = " " if content and not content.endswith((" ", "\n")) else ""
    return f"{content}{separator}{sentence}".strip()


def append_or_replace_generic(content: str, sentence: str) -> str:
    if is_generic_artifact(content):
        return sentence

    return append_sentence(content, sentence)


def is_generic_artifact(content: str) -> bool:
    normalized = normalize_text(content)
    generic_patterns = [
        "저는 다양한 프로젝트를 경험했습니다.",
        "다양한 프로젝트를 경험했습니다.",
    ]
    return normalized in generic_patterns


def remove_generic_sentence(content: str) -> str:
    generic_patterns = [
        "저는 다양한 프로젝트를 경험했습니다.",
        "다양한 프로젝트를 경험했습니다.",
        "열심히 하겠습니다.",
    ]
    revised = content

    for pattern in generic_patterns:
        revised = revised.replace(pattern, "")

    revised = normalize_text(revised)
    return revised or content


def trim_to_length(content: str, limit: int) -> str:
    if len(content) <= limit:
        return content

    return content[: max(0, limit - 1)].rstrip() + "…"


def create_seed_artifact(payload: InterviewPayload) -> str:
    goal = payload.goal
    must_include = format_terms(split_required_terms(answer_text(payload, "must_include")))
    return f"{goal} 목표에 맞춰 {must_include} 항목을 중심으로 초안을 구성합니다."


def clean_required_term(term: str) -> str:
    cleaned = normalize_text(term)
    cleaned = re.sub(r"\s*경험$", "", cleaned)
    return cleaned.strip(" ,.")


def format_terms(terms: list[str]) -> str:
    cleaned_terms = [term.strip() for term in terms if term.strip()]

    if not cleaned_terms:
        return "사용자가 입력한 핵심 조건"

    if len(cleaned_terms) == 1:
        return cleaned_terms[0]

    return ", ".join(cleaned_terms[:-1]) + f", {cleaned_terms[-1]}"
