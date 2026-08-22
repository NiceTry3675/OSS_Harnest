"""오케스트레이터 — 이 파일에는 LLM 호출이 없다.

Generator/Judge를 번갈아 부르고, 채택/폐기를 판정하고, 언제 멈출지 정하는
순수 제어 로직만 있다. 신뢰성이 실제로 사는 곳이 여기다 — 판정 재료(점수)는
LLM이 만들지만, 판정 자체(채택할지 말지, 언제 멈출지)는 코드가 정한다.

채택 규칙은 SPEC.md §5.1.1 / §10의 "결정적 채점 전용 루프 특례"를 그대로 따른다:
pairwise가 아니라 "스칼라가 엄격히 개선될 때만 채택, 동점은 챔피언 유지".
"""

import generator
import judge


def run_loop(client, config: dict) -> dict:
    goal = config["goal"]
    source_material = config["source_material"]
    length_limit = config["length_limit_chars"]
    questions = config["rubric"]["questions"]
    gen_model = config["model"]["generator"]
    judge_model = config["model"]["judge"]
    max_rounds = config["loop"]["max_rounds"]
    plateau_limit = config["loop"]["plateau_rounds"]

    rounds = []

    # 라운드 0 — 원샷 베이스라인. SPEC §3 원칙 6: 설정값이 아니라 모든 루프의 상수.
    seed_artifact = generator.generate_seed(client, gen_model, goal, source_material, length_limit)
    seed_grade = judge.grade(client, judge_model, seed_artifact, questions)
    rounds.append(
        {
            "round": 0,
            "title": "원샷 베이스라인",
            "artifact": seed_artifact,
            "grade": seed_grade,
            "status": "accepted",
        }
    )

    champion_artifact = seed_artifact
    champion_score = seed_grade["percent"]
    plateau_count = 0

    for round_index in range(1, max_rounds + 1):
        feedback = _format_feedback(rounds[-1]["grade"])
        candidate = generator.revise(client, gen_model, champion_artifact, feedback, length_limit)
        candidate_grade = judge.grade(client, judge_model, candidate, questions)

        if candidate_grade["percent"] > champion_score:
            champion_artifact = candidate
            champion_score = candidate_grade["percent"]
            status = "accepted"
            plateau_count = 0
        else:
            status = "rejected"
            plateau_count += 1

        rounds.append(
            {
                "round": round_index,
                "title": f"라운드 {round_index}",
                "artifact": candidate,
                "grade": candidate_grade,
                "status": status,
            }
        )

        if candidate_grade["percent"] >= 100:
            break
        if plateau_count >= plateau_limit:
            break

    return {
        "domain": config["domain"],
        "rounds": rounds,
        "start_score": seed_grade["percent"],
        "final_score": champion_score,
        "final_artifact": champion_artifact,
    }


def _format_feedback(grade_result: dict) -> str:
    lines = [
        f"- {item['id']} ({item['prompt']}): {item['verdict']} — {item['reason']}"
        for item in grade_result["detail"]
        if item["verdict"] != "정답"
    ]
    if not lines:
        return "모든 문제를 맞혔습니다. 더 다듬을 부분이 있다면 다듬어주세요."
    return "\n".join(lines)
