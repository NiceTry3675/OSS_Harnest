# Harnest

> 당신이 승인한 평가 절차로, 정해진 범위 안에서 개선을 측정하는 AI.

Harnest는 사용자가 채점 절차를 검증하고 승인한 뒤, 그 절차를 바꾸지 않은 채 산출물을 반복 개선하는 브라우저 기반 관제실입니다.

## 현재 기능

- **인수인계 문서**: 실제 질문·답 기록으로 가시 케이스와 숨김 홀드아웃을 만들고, 시험관 검증과 블라인드 캘리브레이션을 거쳐 문서를 개선합니다.
- **판정 절차 동결**: 기준·게이트·채점 모델·홀드아웃 정책을 다이제스트에 결속하며, 다른 절차의 체크포인트는 재개하지 않습니다.
- **브라우저 실행**: 컴파일, 승인, 반복 개선, 일시정지·재개가 선택형 백엔드 없이 동작합니다.
- **결과 기록 내보내기**: 완료된 승인본·검증 근거·체크포인트·홀드아웃을 결속 검사한 버전형 JSON으로 내려받거나 선택형 서버에 기록합니다.
- **결정적 테스트 템플릿**: 시간표 템플릿으로 모델 호출 없이 엔진과 체크포인트를 점검할 수 있습니다.

## 모델 경로

| 경로 | 현재 상태 | 데이터 경로 |
|---|---|---|
| 모의 모델 | 무료 데모와 결정적 회귀 테스트 | 브라우저 안에서만 실행 |
| OpenAI · `gpt-5.6-sol` | Responses API BYO 지원. 2026-08-24 CORS와 1라운드 스모크 실측 | 키는 `localStorage`에 저장되고 모델 요청은 브라우저에서 OpenAI로 직행 |
| Gemini · `gemini-3.7-flash` | Gemini BYO 지원 | 키는 `localStorage`에 저장되고 모델 요청은 브라우저에서 Gemini로 직행 |
| Vertex AI · `gemini-3.7-flash` | 서비스 계정 JSON BYO 지원, `global` 고정 | 서비스 계정은 `localStorage`에 저장되고 브라우저가 Google OAuth 토큰을 발급받아 Vertex AI로 직행 |

OpenAI CORS의 정상·401 경로와 스모크 테스트 관측값은 [OpenAI BYO 실측 결과](experiments/byo-cors-openai/RESULT.md)에 있습니다.

BYO API 키·Vertex 서비스 계정과 벤더 모델 호출은 기본적으로 Harnest 서버를 거치지 않습니다.
Vertex 경로에서는 private key로 브라우저 안에서 JWT를 서명하고, 서명된 assertion만 Google OAuth에
보내 단기 access token을 받습니다. 다만 사용자가 결과 화면에서
**서버에 기록**을 선택하면 입력, 승인된 Pack·검증 근거, 실행 결과·홀드아웃의 JSON 기록이
FastAPI 저장 API에 전송됩니다. 서버 기록은 UTF-8 JSON 1 MiB까지이며, 같은 계약 형식은 서버
없이 파일로 내보낼 수 있습니다. 현재 봉투는 완료 결과의 감사·보관용이고 가져오기·진행 재개
형식은 아닙니다.

관리자가 서버에 `SHARED_OPENAI_API_KEY` 또는 `SHARED_GEMINI_API_KEY`를 설정하면, 사용자가
자기 키를 넣지 않아도 해당 모델을 쓸 수 있는 공유 키 경로가 열립니다. 이 키는 프런트엔드나
GitHub Pages에 넣지 않고 FastAPI 서버의 비밀 환경변수에만 저장합니다.

## 실행

Node 22 이상이 필요합니다.

```bash
npm install
npm run dev            # http://localhost:5173
```

웹 앱은 백엔드 없이 완결됩니다. 결과 저장 API가 필요할 때만 별도로 실행합니다.

```bash
cd apps/api
pip3 install -r requirements.txt
python3 -m uvicorn main:app --port 8000
```

운영 배포에서는 프런트엔드가 기본으로 `https://api.harnest.p-e.kr`을 API 서버로 사용합니다.
다른 API 주소를 쓰려면 GitHub 저장소 변수 `VITE_API_BASE`에 그 주소를 넣고 Pages 배포를 다시
실행하세요.

API 서버까지 켜려면 `apps/api`를 별도 호스팅에 배포해야 합니다. 이 저장소에는 Fly.io용
`fly.toml`과 `Deploy API to Fly` 워크플로우가 포함되어 있으며, GitHub Secret `FLY_API_TOKEN`을
등록하면 API 변경도 `main` push 때 자동 배포할 수 있습니다. SQLite 파일은 `/data/harnest.db`를
사용하므로 `/data`에 영구 볼륨을 연결하세요.

TypeScript와 웹 변경을 확인하려면 다음을 실행합니다.

```bash
npm run typecheck
npm test
npm run build
```

API를 변경했다면 `apps/api`에서 `python3 test_api.py`도 실행합니다.

## 문서 지도

| 질문 | 정본 |
|---|---|
| 지금 무엇이 동작하는가 | 이 `README.md` |
| 반드시 지켜야 할 제품 규칙은 무엇인가 | [SPEC.md](SPEC.md) |
| 왜 그런 규칙을 택했는가 | [PHILOSOPHY.md](PHILOSOPHY.md) |
| 아직 구현하지 않았거나 보류한 것은 무엇인가 | [ROADMAP.md](ROADMAP.md) |
| 정확한 필드와 실행 계약은 무엇인가 | [`packages/contracts`](packages/contracts)와 테스트 |
| 실제로 측정했는가 | [`experiments`](experiments) |
| 저장소에서 어떻게 작업하는가 | [AGENTS.md](AGENTS.md) |
| 어떻게 기여하는가 | [CONTRIBUTING.md](CONTRIBUTING.md) |

## 기여와 라이선스

이슈, 문서 개선, 새 템플릿 등 모든 형태의 기여를 환영합니다. 시작은
[CONTRIBUTING.md](CONTRIBUTING.md)를 참고하세요.

이 프로젝트는 [MIT 라이선스](LICENSE)로 배포됩니다.
