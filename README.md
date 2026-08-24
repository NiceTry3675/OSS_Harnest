# Harnest

> 당신이 승인한 평가 절차로, 정해진 범위 안에서 개선을 측정하는 AI.

Harnest는 사용자가 채점 절차를 검증하고 승인한 뒤, 그 절차를 바꾸지 않은 채 산출물을 반복 개선하는 브라우저 기반 관제실입니다.

## 현재 기능

- **인수인계 문서**: 실제 질문·답 기록으로 가시 케이스와 숨김 홀드아웃을 만들고, 시험관 검증과 블라인드 캘리브레이션을 거쳐 문서를 개선합니다.
- **판정 절차 동결**: 기준·게이트·채점 모델·홀드아웃 정책을 다이제스트에 결속하며, 다른 절차의 체크포인트는 재개하지 않습니다.
- **브라우저 실행**: 컴파일, 승인, 반복 개선, 일시정지·재개가 선택형 백엔드 없이 동작합니다.
- **결정적 테스트 템플릿**: 시간표 템플릿으로 모델 호출 없이 엔진과 체크포인트를 점검할 수 있습니다.

## 모델 경로

| 경로 | 현재 상태 | 데이터 경로 |
|---|---|---|
| 모의 모델 | 무료 데모와 결정적 회귀 테스트 | 브라우저 안에서만 실행 |
| OpenAI · `gpt-5.6-sol` | Responses API BYO 지원. 2026-08-24 CORS와 1라운드 스모크 실측 | 키는 `localStorage`에 저장되고 모델 요청은 브라우저에서 OpenAI로 직행 |
| Gemini · `gemini-3.7-flash` | Gemini BYO 지원 | 키는 `localStorage`에 저장되고 모델 요청은 브라우저에서 Gemini로 직행 |

OpenAI CORS의 정상·401 경로와 스모크 테스트 관측값은 [OpenAI BYO 실측 결과](experiments/byo-cors-openai/RESULT.md)에 있습니다.

API 키와 벤더 모델 호출은 Harnest 서버를 거치지 않습니다. 다만 사용자가 결과 화면에서 **서버에 기록**을 선택하면 질문·답과 결과가 선택형 로컬 API에 전송됩니다.

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
