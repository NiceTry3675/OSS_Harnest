"""진입점. config를 읽고, 루프를 돌리고, 결과를 저장한다.

사용법:
    cd experiments/sandbox
    pip install -r requirements.txt
    cp .env.example .env   # GEMINI_API_KEY 채워넣기
    python run.py                              # config/task.example.json 사용
    python run.py config/다른설정.json           # 다른 설정 파일 사용
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path

# Windows 콘솔이 cp949일 때 한글/특수문자 print가 깨지는 것 방지 + 파일로 리다이렉트해도
# 즉시 flush되게 (버퍼링 때문에 진행 로그가 끝날 때까지 안 보이는 것 방지)
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", line_buffering=True)

SANDBOX_DIR = Path(__file__).parent
sys.path.insert(0, str(SANDBOX_DIR))

import generator  # noqa: E402  (미사용 경고 무시 — loop.py가 내부에서 씀)
import judge  # noqa: E402,F401
import loop  # noqa: E402
import report  # noqa: E402
from gemini_client import make_client  # noqa: E402


def load_env() -> None:
    env_path = SANDBOX_DIR / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


def main() -> None:
    load_env()

    config_path = Path(sys.argv[1]) if len(sys.argv) > 1 else SANDBOX_DIR / "config" / "task.example.json"
    config = json.loads(config_path.read_text(encoding="utf-8"))

    client = make_client()

    print(f"[run] {config['domain']}")
    print("[run] 라운드 0 — 원샷 베이스라인 생성/채점 중...")
    result = loop.run_loop(client, config)

    runs_dir = SANDBOX_DIR / "runs"
    runs_dir.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")

    (runs_dir / f"{stamp}.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    markdown = report.render_markdown(result)
    (runs_dir / f"{stamp}.md").write_text(markdown, encoding="utf-8")

    delta = result["final_score"] - result["start_score"]
    print(f"[run] 완료 — 원샷 {result['start_score']}점 → 최종 {result['final_score']}점 (델타 {delta:+d})")
    print(f"[run] 리포트: experiments/sandbox/runs/{stamp}.md")


if __name__ == "__main__":
    main()
