# 미니 검증 루프 (개인 실험실)

팀 제품 코드가 아니다. Generator/Judge 분리와 채점 신뢰성을 실제 LLM 호출로 검증하기 위한
개인 스크립트. 설계 배경은 [`../concepts-and-mini-loop-design.md`](../concepts-and-mini-loop-design.md) 참고.

## 구조

| 파일 | 역할 | LLM 호출 |
|---|---|---|
| `config/task.example.json` | 목표, 원본 자료, 고정 채점 기준(문제+정답 키) | 없음 |
| `generator.py` | 산출물 + 피드백 → 개선안. 프롬프트 자유롭게 수정 가능 (동결 없음) | O |
| `judge_prompt.frozen.txt` + `.sha256` | 채점 프롬프트. 해시로 잠김 — 수정하면 실행이 즉시 에러로 막힘 | — |
| `judge.py` | 문항별로 산출물을 채점. 시작 시 프롬프트 해시 검증 | O (문항당 1회) |
| `loop.py` | Generator↔Judge 오케스트레이션. 채택/폐기 판정, 종료 조건 | **없음** |
| `report.py` | 실행 기록 → 마크다운 리포트 | 없음 |
| `run.py` | 진입점 | — |

## 실행

```powershell
cd experiments/sandbox
py -m pip install -r requirements.txt
cp .env.example .env   # GEMINI_API_KEY 채워넣기
py run.py
```

> 이 저장소 환경에는 `python` 명령이 msys64 쪽 파이썬(pip 없음)으로 잡혀있다.
> 반드시 `py` (Windows py 런처)로 실행할 것 — `py -0p`로 어떤 인터프리터들이 잡히는지 확인 가능.

끝나면 `runs/{타임스탬프}.md`에 리포트가, `runs/{타임스탬프}.json`에 원본 기록이 남는다.

## 채점 기준을 고치고 싶다면 (= 재승인)

`judge_prompt.frozen.txt`를 고친 뒤 반드시:

```bash
sha256sum judge_prompt.frozen.txt
```

로 새 해시를 계산해서 `judge_prompt.frozen.sha256`에 덮어써야 한다. 안 그러면
`judge.py` import 시점에 "동결 위반" 에러가 난다 — 의도한 동작이다.

## 다음 단계 후보

- Judge만 다른 모델(Claude/GPT)로 바꿔서 같은 산출물의 점수가 흔들리는지 비교
- 홀드아웃 문제 추가 (`rubric.questions` 일부를 Generator 피드백에서 제외)
- 여러 도메인(config 파일 여러 개)으로 반복해 패턴 재현되는지 확인
