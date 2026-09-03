# Harnest API

버전형 프로젝트 내보내기 봉투와 레거시 프로젝트·결과를 보관하는 저장·조회 서버입니다.
서버는 임의 코드를 실행하지 않으며, 받은 UTF-8 JSON 바이트를 그대로 보존해 돌려줍니다.

## 준비

```sh
pip3 install --user -r requirements.txt
```

## 실행

`apps/api` 디렉터리에서:

```sh
python3 -m uvicorn main:app --port 8000
```

데이터는 같은 디렉터리의 `harnest.db`(SQLite)에 저장됩니다 (git 추적 제외). 시작할 때
비파괴 마이그레이션을 실행하며, 기존 `projects`·`results` 행은 변경하지 않습니다.

## 가벼운 운영 배포

Docker를 지원하는 작은 호스팅(Render, Fly.io, Railway 등)에 `apps/api`를 서비스로 올립니다.
컨테이너는 `apps/api/Dockerfile`을 사용하며, 실행 포트는 플랫폼이 제공하는 `PORT`를 따릅니다.

이 저장소에는 Fly.io 기준 설정도 들어 있습니다. `fly.toml`은 도쿄 리전(`nrt`)의 작은 shared CPU
머신과 1GB SQLite 볼륨을 전제로 합니다. Fly.io는 앱 설정을 `fly.toml`로 관리하고, 비밀 값은
`fly secrets`로 넣는 방식을 권장합니다.

```sh
fly apps create harnest-api-nicetry3675
fly volumes create harnest_data --size 1 --region nrt --app harnest-api-nicetry3675
fly secrets set SHARED_OPENAI_API_KEY=... --app harnest-api-nicetry3675
fly deploy --remote-only --app harnest-api-nicetry3675
```

GitHub Actions 자동 배포를 쓰려면 Fly.io에서 deploy token을 만들고 GitHub 저장소 Secret
`FLY_API_TOKEN`에 저장하세요. 이후 `apps/api/**`나 `fly.toml`이 `main`에 push될 때 `test_api.py`를
먼저 돌리고, 통과했을 때만 API를 배포합니다. `requirements.txt`는 테스트를 통과한 버전에 고정되어
있으므로, 의존성을 올릴 때는 버전을 바꾸고 테스트를 다시 확인하세요. `fly.toml`의 `/health`
헬스체크는 프로세스는 떠 있지만 요청 경로가 깨진 배포를 걸러 냅니다.

`fly.toml`의 `http_service.http_options.idle_timeout`(2,100초)은 공유 키 프록시 때문에 필요합니다.
프록시는 벤더 응답을 다 받은 뒤에야 첫 바이트를 보내므로, Fly edge의 기본 유휴 한도(60초)가 서버의
상류 읽기 한도(출력 토큰 상한 × 30ms, 기본 65,536토큰이면 약 1,966초)보다 짧으면 edge가 먼저
연결을 끊습니다. 벤더 쪽 생성·과금은 완주하는데 사용자는 산출물을 잃고, 브라우저는 그 실패를 서버의
504와 구분할 수 없습니다. `HARNEST_PROXY_MAX_OUTPUT_TOKENS`나 `HARNEST_PROXY_TIMEOUT`을 올리면
`idle_timeout`도 브라우저 대기 시간(읽기 한도 + 60초)보다 크게 함께 올리세요. 다른 호스팅에서도
같은 이유로 edge·리버스 프록시의 유휴 한도를 맞춰야 합니다.

권장 도메인:

```text
api.harnest.p-e.kr -> 배포 플랫폼이 안내하는 API 서비스 주소
```

SQLite 파일은 컨테이너 재시작 때 사라지지 않도록 영구 디스크에 둡니다. 기본 컨테이너 설정은
`HARNEST_DB=/data/harnest.db`를 사용하므로, 배포 플랫폼에서 `/data`를 persistent disk/volume으로
연결하세요. 영구 디스크를 붙이지 않으면 서버는 동작하지만 저장 기록은 재배포나 재시작 때 사라질 수
있습니다.

## 환경변수

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `HARNEST_DB` | `./harnest.db` | SQLite 파일 경로 |
| `HARNEST_DB_MAX_BYTES` | `838860800` (800 MiB) | DB 파일 총량 상한. SQLite `max_page_count`로 강제하며, 가득 차면 `POST /exports`가 507로 거부합니다 (볼륨 크기보다 작게) |
| `HARNEST_CORS_ORIGINS` | `http://localhost:5173` | 쉼표로 구분한 허용 오리진. 자체 호스팅이라면 반드시 자기 웹 도메인으로 바꾸세요 |
| `HARNEST_TRUSTED_IP_HEADER` | — | 방문자 IP를 읽을 헤더 이름. Fly는 `fly-client-ip`, Render·Railway 등 X-Forwarded-For만 붙이는 플랫폼은 `x-forwarded-for`(마지막 항목 사용). 미설정 시 접속 소켓 IP만 사용 — 리버스 프록시 뒤에서는 모든 방문자가 한 버킷을 공유하니 반드시 설정 |
| `HARNEST_EXPORT_RATE_LIMIT` | `30` | `POST /exports`의 IP당 시간당 저장 상한 (프록시와 별도 버킷, 프로세스 메모리 카운터) |
| `SHARED_OPENAI_API_KEY` | — | 설정하면 `/proxy/openai`가 열려, 방문자가 자기 키 없이 OpenAI를 쓸 수 있습니다 |
| `SHARED_GEMINI_API_KEY` | — | 설정하면 `/proxy/gemini/{model}`이 열려, 방문자가 자기 키 없이 Gemini를 쓸 수 있습니다 |
| `HARNEST_PROXY_RATE_LIMIT` | `20` | `/proxy/*`의 IP당 시간당 요청 상한 (프로세스 메모리 카운터 — 재시작·scale-to-zero 시 초기화) |
| `HARNEST_PROXY_TIMEOUT` | `300` | 프록시가 벤더 응답을 기다리는 초의 바닥. 실제 한도는 요청의 출력 토큰 상한 × 30ms가 더 크면 그만큼(브라우저 클라이언트와 같은 산식 — 40,000토큰이면 1,200초). 넘기면 504 |
| `SHARED_OPENAI_MODELS` | `gpt-5.6-sol` | `/proxy/openai`가 허용하는 모델 (쉼표 구분) |
| `SHARED_GEMINI_MODELS` | `gemini-3.8-flash` | `/proxy/gemini/{model}`이 허용하는 모델 (쉼표 구분) |
| `HARNEST_PROXY_MAX_OUTPUT_TOKENS` | `65536` | 프록시 요청 하나의 출력 토큰 상한 (요청값이 더 크면 잘라서 전달) |

## 공유 키 프록시 (선택)

기본은 BYO(bring your own key)입니다 — 브라우저가 벤더로 직접 요청을 보내고, 키는
localStorage에만 저장됩니다(SPEC §3 원칙 1). `SHARED_OPENAI_API_KEY` /
`SHARED_GEMINI_API_KEY`를 설정하면, 사용자가 자기 키를 넣지 않아도 그 벤더를 쓸 수
있는 예외 경로(SPEC §7.1)가 열립니다. 이 경우 요청은 브라우저 → 이 서버 → 벤더로 흐르고, 비용은
관리자(키 소유자) 계정에서 나갑니다.

**공유 키를 켤 때 반드시 할 일:**
- 벤더 콘솔(OpenAI, Google Cloud)에 월 지출 한도를 걸어 두세요. `HARNEST_PROXY_RATE_LIMIT`는
  최악의 시나리오를 줄일 뿐, 막아 주지 않습니다.
- `HARNEST_TRUSTED_IP_HEADER`를 배포 플랫폼에 맞게 설정하세요. 서버는 이 변수가 가리키는 헤더만
  믿고, 없으면 접속 소켓 IP만 씁니다(`fly.toml`은 `fly-client-ip`로 설정돼 있습니다). 프록시 없는
  배포에서 헤더를 믿으면 방문자가 요청마다 IP를 꾸며 한도를 무한히 우회할 수 있고, 반대로 리버스
  프록시 뒤에서 설정하지 않으면 모든 방문자가 프록시 IP 하나로 묶여 한도를 함께 씁니다.
- 프록시는 허용 목록의 모델만 받고, 출력 토큰을 상한으로 자르며, 스트리밍 요청은 한 번에 받는
  요청으로 바꿔 전달합니다. 벤더 호출은 비동기로 기다리므로 한 사용자의 긴 생성이 다른 사용자의
  저장·조회를 막지 않습니다.
- 벤더 응답이 읽기 한도 안에 오지 않으면 504를 돌려주고 서버 로그에 남깁니다. 읽기 한도는
  `HARNEST_PROXY_TIMEOUT`을 바닥으로 요청의 출력 토큰 상한(잘린 값)에 비례해 늘어나며, 브라우저
  클라이언트가 한 번에 받는 호출에 기다리는 시간과 같은 산식(토큰당 30ms, 최소 5분)이라 서버가 먼저
  끊지 않습니다. 끊긴 생성도 벤더 쪽에서는 완주·과금되므로 클라이언트는 504를 재시도하지 않습니다
  (연결 실패 502와 구분). 브라우저 쪽의 시간 초과와 네트워크 단절도 마찬가지로 재시도하지 않습니다 —
  서버가 이미 받아 벤더에 쓴 뒤 끊긴 경우와 구분할 수 없기 때문입니다. 504가 잦으면 관리자 비용이
  새고 있다는 뜻이니 로그를 확인하세요.
- `/config`는 어떤 벤더가 공유 키를 갖고 있는지(불리언)와 그 키로 쓸 수 있는 모델 목록만
  공개합니다. 키 자체는 절대 응답에 담기지 않습니다.

## 엔드포인트

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/health` | 상태 확인 → `{"status":"ok"}` |
| POST | `/exports` | 버전형 봉투 원문 저장 → `201 {id, storedAt, contentSha256}` (IP당 시간당 한도 초과 429, DB 총량 상한 도달 507) |
| GET | `/exports/{id}` | 저장한 봉투의 정확한 JSON 바이트 반환 (없으면 404) |
| GET | `/config` | 공유 키 보유 여부와 허용 모델 → `{"sharedProviders": {"openai": bool, "gemini": bool}, "sharedModels": {"openai": [...], "gemini": [...]}}` (키가 없는 벤더는 빈 배열) |
| POST | `/proxy/openai` | 본문을 OpenAI Responses API에 전달 (공유 키 미설정 시 404, 허용 목록 밖 모델은 400, 벤더 응답 읽기 시간 초과·읽는 도중 단절 504, 연결 시간 초과를 포함한 연결 단계 실패 502) |
| POST | `/proxy/gemini/{model}` | 본문을 Gemini generateContent에 전달 (공유 키 미설정 시 404, 허용 목록 밖 모델은 400, 벤더 응답 읽기 시간 초과·읽는 도중 단절 504, 연결 시간 초과를 포함한 연결 단계 실패 502) |

`POST /exports`는 `kind: "harnest.project-export"`, `envelopeVersion: 3`, `exportedAt`와
`project.interview`·`project.evaluation`·`project.loopSpec`, `result.checkpoint`·`result.holdout`의
완전한 v3 봉투 골격을 요구합니다. 인터뷰·Pack은 `skeleton-1`이고 같은 비어 있지 않은
`templateId`를 가져야 하며, judge 절차에 맞는 null 또는 객체형 승인 증거를 요구합니다. Pack의
`templateId`, `packVersion`, 소문자 SHA-256 `definitionDigest`를 색인하고, approval·examiner report·
checkpoint의 귀속 식별자가 현재 Pack에 결속되는지 확인합니다. checkpoint는
`status: "done"` 및 `doneReason`(`max_rounds`·`plateau`·`ceiling` — `ceiling`은 `championScore`가
100이어야 함)을 가져야 하고, 검증 가드 필드
(`championGuardScore`·`guardCurve`, tree의 `candidateGuardScore`·`guardSafe`)를 null 허용
숫자·불리언으로 요구합니다. `loopSpec.feedbackMode`와 tree 레코드의 `strategy{key, summary, label?}`는
선택 필드로, 값·형식은 `packages/contracts/src/loop.ts`·`storage.ts`와 같은 규칙으로 확인합니다.
`holdoutPolicy.mode`가 `none`이면 결과도 `none`,
`seeded_split`(가드·홀드아웃 caseId와 `guardTolerance` 포함)이면 baseline/final의 scored 또는
failed 기록을 가진 `measured`여야 합니다. 고정 계층의 알 수 없는 필드, 배열 안의 잘못된 원소 타입,
중복 JSON 키와 잘못된 Unicode surrogate는 거부합니다. 거부 사유는 응답 `detail`에 한국어로 담깁니다.

이는 저장소의 구조·귀속 검사일 뿐입니다. Pack 다이제스트 재계산, examiner 판정,
체크포인트 곡선과 홀드아웃 점수의 의미 검증은 브라우저의 `packages/contracts` 생산자 계약이
권위이며 서버가 중복해서 판정하지 않습니다. 응답의 `Location`은 저장된 봉투 경로이고, GET
응답의 `X-Content-SHA256`은 원문 바이트의 SHA-256입니다.

쓰기와 프록시 요청은 `application/json`, 최대 1 MiB이며 브라우저 `Origin`은 `HARNEST_CORS_ORIGINS`에
있는 값만 허용합니다. 이 제한은 다른 웹페이지가 API에 단순 요청으로 데이터를 밀어 넣거나 공유 키를
쓰는 경로를 막습니다. `Origin`이 없는 스크립트 요청까지 막지는 못하므로, 저장은 IP당 시간당
`HARNEST_EXPORT_RATE_LIMIT`회로 제한하고 DB 총량은 `HARNEST_DB_MAX_BYTES`로 막아 볼륨이 가득 차
모든 사용자의 저장이 500으로 실패하는 일을 피합니다(상한 도달 시 507).

새 봉투는 `project_exports`에 단일 레코드로 원자적으로 저장합니다. `definitionDigest`, `templateId`,
`runId`에는 인덱스가 있으며, 원문은 exact round-trip을 위해 BLOB으로 보존합니다. 구 `/projects`
경로는 제거됐고, 그 시절의 `projects`·`results` 행은 마이그레이션이 지우지 않고 DB에 그대로 둡니다.

CORS는 `HARNEST_CORS_ORIGINS`로 정합니다. 기본은 `http://localhost:5173`(웹 앱)만 허용합니다.
운영 출처는 코드가 아니라 배포 설정(`fly.toml`의 `[env]`)에서 넣으므로, 자체 호스팅할 때는 이 변수를
자기 웹 도메인으로 반드시 바꾸세요.

## 테스트

```sh
python3 test_api.py
```

임시 DB로 레거시 호환, 완전한 봉투(결정적·case_answering·인수인계형 ceiling 종료)의 exact-byte 왕복,
메타데이터·해시·인덱스, 구조·귀속 오류, origin/content-type/크기 제한, 저장 횟수·DB 총량 상한,
신뢰 IP 헤더, 프록시의 모델·토큰 방어와 504/502 구분, 벤더 대기 중 이벤트 루프 비차단, 마이그레이션
멱등성을 검증하며, 실패 시 비정상 종료합니다. 벤더 호출은 가짜로 바꿔 네트워크 없이 돌아갑니다.
