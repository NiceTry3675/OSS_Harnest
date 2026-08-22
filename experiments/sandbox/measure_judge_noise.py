"""저지 노이즈(σ) 측정 — 검증 배터리의 "안정성" 검사를 실제로 구현한 것.

목적: 제품에 띄울 숫자가 아니다. **템플릿 채택 심사(SPEC §3 원칙 6)를 하려면
"델타 +N점이 노이즈보다 큰가"를 판정해야 하는데, 그 기준선을 모르기 때문에
한 번 재는 것.**

방법: 산출물 하나를 고정해놓고 같은 저지로 N번 재채점한다.
지금까지 잰 83/92/100에는 생성 노이즈 + 채점 노이즈가 섞여 있었다.
산출물을 고정하면 순수한 채점 노이즈만 남는다.

사용법:
    py measure_judge_noise.py runs/20260822-194101.json gemini-3.5-flash-lite 5
"""

import json
import statistics
import sys
from pathlib import Path

SANDBOX_DIR = Path(__file__).parent
sys.path.insert(0, str(SANDBOX_DIR))

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", line_buffering=True)

import judge  # noqa: E402
from gemini_client import make_client  # noqa: E402
from run import load_env  # noqa: E402


def main() -> None:
    load_env()

    run_path = Path(sys.argv[1]) if len(sys.argv) > 1 else SANDBOX_DIR / "runs" / "20260822-194101.json"
    model = sys.argv[2] if len(sys.argv) > 2 else "gemini-3.5-flash-lite"
    trials = int(sys.argv[3]) if len(sys.argv) > 3 else 5

    record = json.loads(run_path.read_text(encoding="utf-8"))
    # 라운드 0(원샷) 산출물을 쓴다 — 만점짜리보다 애매한 판정이 섞여 있어야 노이즈가 드러난다.
    artifact = record["rounds"][0]["artifact"]
    config_path = SANDBOX_DIR / "config" / "task.example.json"
    questions = json.loads(config_path.read_text(encoding="utf-8"))["rubric"]["questions"]

    print(f"[noise] 산출물 출처: {run_path.name} (라운드 0, {len(artifact)}자)")
    print(f"[noise] 저지 모델: {model} · 재채점 {trials}회")
    print(f"[noise] 이 산출물의 원래 기록 점수: {record['rounds'][0]['grade']['percent']}")
    print()

    client = make_client()
    scores = []
    per_question: dict[str, list[str]] = {q["id"]: [] for q in questions}

    for i in range(1, trials + 1):
        result = judge.grade(client, model, artifact, questions)
        scores.append(result["percent"])
        for item in result["detail"]:
            per_question[item["id"]].append(item["verdict"])
        print(f"[noise] {i}회차: {result['percent']}점  ({', '.join(d['verdict'] for d in result['detail'])})")

    print()
    spread = max(scores) - min(scores)
    print(f"[결과] 점수: {scores}")
    print(f"[결과] 최소 {min(scores)} / 최대 {max(scores)} / 폭 {spread}점")
    if len(scores) > 1:
        print(f"[결과] 평균 {statistics.mean(scores):.1f} / 표준편차 σ = {statistics.stdev(scores):.2f}점")
    print()
    print("[문항별 판정 흔들림] (같은 산출물인데 판정이 갈리면 그 문항이 노이즈원)")
    for qid, verdicts in per_question.items():
        unique = set(verdicts)
        flag = "  <-- 흔들림" if len(unique) > 1 else ""
        print(f"  {qid}: {' '.join(verdicts)}{flag}")


if __name__ == "__main__":
    main()
