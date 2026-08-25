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
`FLY_API_TOKEN`에 저장하세요. 이후 `apps/api/**`나 `fly.toml`이 `main`에 push될 때 API도 자동
배포됩니다.

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
| `HARNEST_CORS_ORIGINS` | `http://localhost:5173` | 쉼표로 구분한 허용 오리진 |
| `SHARED_OPENAI_API_KEY` | — | 설정하면 `/proxy/openai`가 열려, 방문자가 자기 키 없이 OpenAI를 쓸 수 있습니다 |
| `SHARED_GEMINI_API_KEY` | — | 설정하면 `/proxy/gemini/{model}`이 열려, 방문자가 자기 키 없이 Gemini를 쓸 수 있습니다 |
| `HARNEST_PROXY_RATE_LIMIT` | `20` | `/proxy/*`의 IP당 시간당 요청 상한 |

## 공유 키 프록시 (선택)

기본은 BYO(bring your own key)입니다 — 브라우저가 벤더로 직접 요청을 보내고, 키는
localStorage에만 저장됩니다(SPEC §3 원칙 1). `SHARED_OPENAI_API_KEY` /
`SHARED_GEMINI_API_KEY`를 설정하면, 사용자가 자기 키를 넣지 않아도 그 벤더를 쓸 수
있는 예외 경로가 열립니다. 이 경우 요청은 브라우저 → 이 서버 → 벤더로 흐르고, 비용은
관리자(키 소유자) 계정에서 나갑니다.

**공유 키를 켤 때 반드시 할 일:**
- 벤더 콘솔(OpenAI, Google Cloud)에 월 지출 한도를 걸어 두세요. `HARNEST_PROXY_RATE_LIMIT`는
  최악의 시나리오를 줄일 뿐, 막아 주지 않습니다.
- `/config`는 어떤 벤더가 공유 키를 갖고 있는지(불리언만) 공개합니다. 키 자체는 절대
  응답에 담기지 않습니다.

## 엔드포인트

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/health` | 상태 확인 → `{"status":"ok"}` |
| POST | `/exports` | 버전형 봉투 원문 저장 → `201 {id, storedAt, contentSha256}` |
| GET | `/exports/{id}` | 저장한 봉투의 정확한 JSON 바이트 반환 (없으면 404) |
| POST | `/projects` | 본문 `{interview, pack, loopSpec}` 저장 → `{"id": uuid}` |
| GET | `/projects/{id}` | 저장된 프로젝트를 그대로 반환 (없으면 404) |
| POST | `/projects/{id}/results` | 본문 `{checkpoint}` 저장 → `{"ok": true}` (프로젝트 없으면 404) |
| GET | `/config` | 공유 키 보유 여부 → `{"sharedProviders": {"openai": bool, "gemini": bool}}` |
| POST | `/proxy/openai` | 본문을 그대로 OpenAI Responses API에 전달 (공유 키 미설정 시 404) |
| POST | `/proxy/gemini/{model}` | 본문을 그대로 Gemini generateContent에 전달 (공유 키 미설정 시 404) |

`POST /exports`는 `kind: "harnest.project-export"`, `envelopeVersion: 3`, `exportedAt`와
`project.interview`·`project.evaluation`·`project.loopSpec`, `result.checkpoint`·`result.holdout`의
완전한 v3 봉투 골격을 요구합니다. 인터뷰·Pack은 `skeleton-1`이고 같은 비어 있지 않은
`templateId`를 가져야 하며, judge 절차에 맞는 null 또는 객체형 승인 증거를 요구합니다. Pack의
`templateId`, `packVersion`, 소문자 SHA-256 `definitionDigest`를 색인하고, approval·examiner report·
checkpoint의 귀속 식별자가 현재 Pack에 결속되는지 확인합니다. checkpoint는
`status: "done"` 및 `doneReason`을 가져야 하고, 검증 가드 필드
(`championGuardScore`·`guardCurve`, tree의 `candidateGuardScore`·`guardSafe`)를 null 허용
숫자·불리언으로 요구합니다. `holdoutPolicy.mode`가 `none`이면 결과도 `none`,
`seeded_split`(가드·홀드아웃 caseId와 `guardTolerance` 포함)이면 baseline/final의 scored 또는
failed 기록을 가진 `measured`여야 합니다. 고정 계층의 알 수 없는 필드, 배열 안의 잘못된 원소 타입,
중복 JSON 키와 잘못된 Unicode surrogate는 거부합니다.

이는 저장소의 구조·귀속 검사일 뿐입니다. Pack 다이제스트 재계산, examiner 판정,
체크포인트 곡선과 홀드아웃 점수의 의미 검증은 브라우저의 `packages/contracts` 생산자 계약이
권위이며 서버가 중복해서 판정하지 않습니다. 응답의 `Location`은 저장된 봉투 경로이고, GET
응답의 `X-Content-SHA256`은 원문 바이트의 SHA-256입니다.

쓰기 요청은 `application/json`, 최대 1 MiB이며 브라우저 `Origin`은 `http://localhost:5173`만
허용합니다. 이 제한은 다른 웹페이지가 로컬 API에 단순 요청으로 데이터를 밀어 넣는 경로를 막습니다.

새 봉투는 `project_exports`에 단일 레코드로 원자적으로 저장합니다. `definitionDigest`, `templateId`,
`runId`에는 인덱스가 있으며, 원문은 exact round-trip을 위해 BLOB으로 보존합니다. 레거시
`/projects` 경로는 기존 클라이언트 호환용입니다.

CORS는 `HARNEST_CORS_ORIGINS`로 정합니다. 기본은 `http://localhost:5173`(웹 앱)만 허용합니다.

## 테스트

```sh
python3 test_api.py
```

임시 DB로 레거시 호환, 완전한 봉투의 exact-byte 왕복, 메타데이터·해시·인덱스, 구조·귀속 오류,
origin/content-type/크기 제한과 마이그레이션 멱등성을 검증하며, 실패 시 비정상 종료합니다.
