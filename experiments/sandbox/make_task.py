"""생성 엔진 실행 — 자료 하나로 task 설정(채점 기준 포함)을 만든다.

사용법:
    py make_task.py materials/os-chapter.txt 900 8

인자: 자료파일, 요약본 분량 제한(자), 문항 수
결과: config/task.generated-{자료명}-{제한}.json

사람이 쓰는 것: 자료, 목표, 분량 제한 (= 인터뷰에서 받는 것)
agent가 만드는 것: 평가 문항 + 정답 키 (= 채점 기준)
"""

import json
import sys
from pathlib import Path

SANDBOX_DIR = Path(__file__).parent
sys.path.insert(0, str(SANDBOX_DIR))

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", line_buffering=True)

import rubric_maker  # noqa: E402
from gemini_client import make_client  # noqa: E402
from run import load_env  # noqa: E402

GOAL = "이 자료를 시험 문제를 풀 수 있는 요약본으로 압축한다"
MODEL = "gemini-3.5-flash"


def main() -> None:
    load_env()

    material_path = Path(sys.argv[1]) if len(sys.argv) > 1 else SANDBOX_DIR / "materials" / "os-chapter.txt"
    length_limit = int(sys.argv[2]) if len(sys.argv) > 2 else 900
    question_count = int(sys.argv[3]) if len(sys.argv) > 3 else 8

    source_material = material_path.read_text(encoding="utf-8").strip()
    ratio = len(source_material) / length_limit

    print(f"[생성엔진] 자료: {material_path.name} ({len(source_material)}자)")
    print(f"[생성엔진] 분량 제한: {length_limit}자 → {ratio:.1f}배 압축 필요")
    print(f"[생성엔진] 문항 {question_count}개 생성 중... (모델: {MODEL})")
    print()

    client = make_client()
    questions = rubric_maker.make_rubric(
        client, MODEL, GOAL, source_material, length_limit, question_count
    )

    for q in questions:
        print(f"  [{q['kind']}] {q['id']}: {q['prompt']}")
        print(f"       정답키: {q['answer_key']}")

    kinds: dict[str, int] = {}
    for q in questions:
        kinds[q["kind"]] = kinds.get(q["kind"], 0) + 1
    print()
    print(f"[생성엔진] 문항 유형 분포: {kinds}")

    config = {
        "domain": f"{material_path.stem} (생성 엔진 제작, 제한 {length_limit}자 / {ratio:.1f}배 압축)",
        "goal": GOAL,
        "length_limit_chars": length_limit,
        "source_material": source_material,
        "rubric": {"questions": questions},
        "loop": {"max_rounds": 5, "plateau_rounds": 2},
        "model": {"generator": "gemini-3.5-flash", "judge": "gemini-3.5-flash"},
    }

    out_path = SANDBOX_DIR / "config" / f"task.generated-{material_path.stem}-{length_limit}.json"
    out_path.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[생성엔진] 저장: config/{out_path.name}")
    print(f"[생성엔진] 실행하려면: py run.py config/{out_path.name}")


if __name__ == "__main__":
    main()
