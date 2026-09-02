# Harnest

**[▶ 브라우저에서 바로 실행](https://harnest.p-e.kr)**

AI에게 일을 맡기면 결과물은 한 번에 나옵니다. 문제는 그게 잘된 건지 아무도 채점하지 않는다는 것입니다. 확인하려면 기준이 있어야 하는데, 기준마저 AI가 정하면 점수는 의미가 없습니다.

**Harnest는 순서를 뒤집습니다.** 사용자가 채점 기준을 먼저 정하고 승인하면 그 기준이 잠기고, AI는 바뀌지 않는 기준 위에서 결과물을 반복해 고쳐 씁니다. 설치도 가입도 없이 브라우저에서 돌아가며, 모의 모델을 고르면 API 키 없이도 전체 흐름을 볼 수 있습니다.

## 핵심 기능

| 기능 | 설명 |
|---|---|
| **템&#8288;플&#8288;릿&nbsp;생&#8288;성** | 목표를 한 문장 적으면 무엇을 만들지, 어떤 평가 기준으로 볼지, 어떤 순서로 진행할지가 만들어집니다. 만든 템플릿은 브라우저에 보관되고 이름 변경·삭제·재사용이 됩니다 |
| **기&#8288;준&nbsp;잠&#8288;금** | AI가 결과물을 만들고 평가하는 동안 승인한 평가 구성은 바뀌지 않습니다. 평가 기준·필수 조건·사용할 AI 모델을 바꾸려면 다시 승인해야 하고, 이전 점검 결과는 그 자리에서 무효가 됩니다 |
| **채&#8288;택&nbsp;조&#8288;건** | 개선안은 필수 조건과 중간 점검을 통과하고, 종합 점수가 현재 결과보다 높아야 채택됩니다. 같으면 지금 것을 유지하므로 점수가 내려가지 않습니다 |
| **질&#8288;문&nbsp;구&#8288;분** | 넣은 질문을 개선용·중간 점검용·최종 확인용으로 나눕니다. 중간 점검의 판정 내용은 결과물을 고치는 쪽에 전달되지 않고, 최종 확인 질문은 시작과 끝에만 채점해 개선 판단에 쓰지 않습니다 |
| **사&#8288;전&nbsp;점&#8288;검** | 채점을 맡을 AI를 승인 전에 점검합니다. 재채점 결과가 안정적인지, 꾸며낸 답을 가려내는지 통과하지 못하면 승인 자체가 막힙니다 |
| **추&#8288;론&nbsp;실&#8288;황** | AI가 결과물을 만들고 채점하는 과정이 실시간으로 흐릅니다. 완성된 결과가 아니라 판단이 만들어지는 과정이 보입니다 |
| **정&#8288;지&#8288;·&#8288;재&#8288;개** | 실행을 멈췄다가 이어서 돌릴 수 있습니다. 브라우저를 닫아도 진행 상황이 남고, 평가 구성이 다른 실행은 이어받지 않습니다 |
| **내&#8288;보&#8288;내&#8288;기** | 입력 내용, 평가 구성, 실행 결과와 최종 확인 점수를 검사한 JSON 파일로 내려받거나 서버에 기록합니다 |
| **템&#8288;플&#8288;릿&nbsp;교&#8288;체** | 어떤 일을 어떻게 채점할지는 템플릿이 소유합니다. 화면과 실행 엔진에는 템플릿별 분기가 없어, 새 템플릿을 붙여도 코어를 건드리지 않습니다 |

기본 제공 템플릿은 **인수인계·온보딩 문서**(글로 된 결과물, 질문·답으로 채점)와 **근무표 짜기**(표로 된 결과물, 규칙 위반으로 채점) 둘입니다. 결과물이 문서든 배정표든 같은 흐름이 돕니다.

> 예시 실행 — 인수인계 템플릿, 질문 15개, `gpt-5.6-sol`: 처음 75점 → 고친 뒤 **93점**, 원자료 44,669자에서 2,818자 결과물, 중간 점검에서 기각 2회.

## 시작하기

**웹에서**: [harnest.p-e.kr](https://harnest.p-e.kr) → `템플릿 만들기` 또는 제공된 템플릿 선택 → 질문·답 입력 → 기준 승인 → 실행

**로컬에서** (Node 22+):

```bash
git clone https://github.com/NiceTry3675/OSS_Harnest.git
cd OSS_Harnest
npm install
npm run dev            # http://localhost:5173
```

웹 앱은 백엔드 없이 완결됩니다. 결과 저장 API가 필요할 때만 별도로 실행합니다.

```bash
cd apps/api
pip3 install -r requirements.txt
python3 -m uvicorn main:app --port 8000
```

## 기술 스택

| 영역 | 사용 기술 |
|---|---|
| 프론트엔드 | React 18 · TypeScript 5.7 · Vite 6 · React Router 7 |
| 상태·저장 | React Context · `useSyncExternalStore` · IndexedDB(체크포인트) · `localStorage`(키·템플릿 보관) |
| 무결성 | Web Crypto `crypto.subtle` SHA-256 다이제스트 |
| 문서 파싱 | `pdfjs-dist` · `mammoth` (브라우저에서 PDF·DOCX 추출) |
| 모델 연동 | 벤더 6종 SSE·NDJSON 스트리밍 직접 파싱 (SDK 미사용) |
| 백엔드(선택) | FastAPI · Uvicorn · SQLite |
| 테스트 | Vitest — 281개 (`fake-indexeddb`로 체크포인트 포함) |
| 배포 | GitHub Pages(웹) · Fly.io(API) — `main` push 시 자동 |

npm workspaces 모노레포이며, 외부 상태 관리 라이브러리나 UI 프레임워크를 쓰지 않습니다.

## 프로젝트 구조

```
packages/contracts    평가 팩·시험관·체크포인트·기록 계약과 다이제스트
packages/loop-engine  체크포인트와 재개를 지원하는 브라우저 개선 루프
templates/handover    인수인계 템플릿 — 질문·컴파일·채점·생성
templates/timetable   개발·테스트용 결정적 템플릿(모델 호출 없음)
apps/web              React SPA · 벤더 6종 클라이언트
apps/api              선택형 FastAPI + SQLite 저장 API
experiments           동결된 프로토콜·측정 코드·결과
```

의존 방향은 `contracts` ← `loop-engine` / `templates/*` ← `apps/web` 입니다. 템플릿별 동작은 `TemplateEntry` 경계에서만 합성되고, 페이지나 엔진에는 템플릿 분기가 없습니다.

## 모델 지원

**BYO API 키와 모델 호출은 Harnest 서버를 거치지 않습니다.** 키는 브라우저 `localStorage`에만 저장되고, 요청 본문은 브라우저에서 벤더로 직행합니다.

| 경로 | 지원 |
|---|---|
| 모의 모델 | 키 없이 전체 흐름 실행 · 결정적 회귀 테스트 |
| OpenAI | `gpt-5.6-sol` 등 — Responses API, 스트리밍 |
| Gemini · Vertex AI | `gemini-3.8-flash` — Vertex는 서비스 계정 JSON, `global` 고정 |
| Anthropic · OpenRouter · Ollama | 스트리밍 생성·채점 |

Vertex 경로에서는 private key로 브라우저 안에서 JWT를 서명하고, 서명된 assertion만 Google OAuth에 보내 단기 access token을 받습니다. CORS 정상·401 경로와 스모크 테스트 관측값은 [OpenAI BYO 실측 결과](experiments/byo-cors-openai/RESULT.md)에 있습니다.

서버로 데이터가 가는 경우는 하나뿐입니다 — 결과 화면에서 **서버에 기록**을 직접 누를 때. 같은 형식을 서버 없이 파일로 내보낼 수도 있습니다. 관리자가 `SHARED_OPENAI_API_KEY` / `SHARED_GEMINI_API_KEY`를 설정하면 사용자가 키 없이 쓸 수 있는 공유 키 경로가 열리며, 이 키는 서버의 비밀 환경변수에만 저장합니다.

## 개발

```bash
npm run typecheck                              # 전 워크스페이스 타입 검사
npm test                                       # Vitest 281개
npm run build                                  # 프로덕션 웹 빌드
npx vitest run packages/loop-engine/src/engine.test.ts
```

API를 변경했다면 `apps/api`에서 `python3 test_api.py`도 실행합니다. 린터는 없으며, 검증 범위는 변경 범위에 맞춥니다.

## 배포

| 대상 | 주소 | 방식 |
|---|---|---|
| 웹 | https://harnest.p-e.kr | `main` push → GitHub Pages 자동 배포 |
| 저장 API | https://api.harnest.p-e.kr | `main` push → Fly.io 자동 배포 |

다른 API 주소를 쓰려면 저장소 변수 `VITE_API_BASE`에 넣고 Pages 배포를 다시 실행하세요. API를 직접 호스팅하려면 `fly.toml`과 `Deploy API to Fly` 워크플로우를 사용하고, GitHub Secret `FLY_API_TOKEN`을 등록하세요. SQLite 파일은 `/data/harnest.db`를 쓰므로 `/data`에 영구 볼륨을 연결해야 합니다.

## 문서

| 질문 | 정본 |
|---|---|
| 지금 무엇이 동작하는가 | 이 `README.md` |
| 반드시 지켜야 할 제품 규칙은 무엇인가 | [SPEC.md](SPEC.md) |
| 왜 그런 규칙을 택했는가 | [PHILOSOPHY.md](PHILOSOPHY.md) |
| 아직 구현하지 않았거나 보류한 것은 무엇인가 | [ROADMAP.md](ROADMAP.md) |
| 정확한 필드와 실행 계약은 무엇인가 | [`packages/contracts`](packages/contracts)와 테스트 |
| 실제로 측정했는가 | [`experiments`](experiments) |
| 저장소에서 어떻게 작업하는가 | [AGENTS.md](AGENTS.md) |

## 기여

이슈, 문서 개선, 새 템플릿 등 모든 형태의 기여를 환영합니다. 새 템플릿은 `TemplateEntry` 인터페이스만 구현하면 페이지나 엔진을 건드리지 않고 추가됩니다. 시작은 [CONTRIBUTING.md](CONTRIBUTING.md)를 참고하세요.

## 라이선스

[MIT](LICENSE)
