"""실행 기록(dict)을 사람이 읽는 마크다운으로 바꾼다. LLM 호출 없음."""

from datetime import datetime


def render_markdown(result: dict) -> str:
    delta = result["final_score"] - result["start_score"]
    lines = [
        f"# {result['domain']} — 자동화 루프 실행 리포트",
        "",
        f"생성 시각: {datetime.now().isoformat(timespec='seconds')}",
        "",
        f"**원샷 베이스라인 {result['start_score']}점 → 최종 {result['final_score']}점 "
        f"(델타 {delta:+d})**",
        "",
        "## 라운드별 기록",
        "",
        "| 라운드 | 상태 | 점수 |",
        "|---|---|---|",
    ]

    for rnd in result["rounds"]:
        lines.append(f"| {rnd['round']} ({rnd['title']}) | {rnd['status']} | {rnd['grade']['percent']} |")

    final_round = next(
        (r for r in reversed(result["rounds"]) if r["artifact"] == result["final_artifact"]),
        result["rounds"][-1],
    )

    lines += [
        "",
        "## 최종 요약본",
        "",
        "> " + result["final_artifact"].replace("\n", "\n> "),
        "",
        "## 문항별 최종 채점",
        "",
        "| 문제 | 판정 | 이유 |",
        "|---|---|---|",
    ]
    for item in final_round["grade"]["detail"]:
        lines.append(f"| {item['id']} {item['prompt']} | {item['verdict']} | {item['reason']} |")

    return "\n".join(lines) + "\n"
