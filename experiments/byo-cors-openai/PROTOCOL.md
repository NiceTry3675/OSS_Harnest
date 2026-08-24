# OpenAI BYO 브라우저 CORS 실측 프로토콜

> 동결일: 2026-08-24
> 상태: 실측 전 동결

## 1. 목적

Harnest 웹 앱과 같은 로컬 브라우저 Origin에서 OpenAI Responses API로 직접 요청했을 때,
CORS 사전 요청과 실제 응답 읽기가 가능한지 확인한다. 이번 실험은 기술적 CORS 동작만 판정하며,
클라이언트 API 키 사용에 관한 벤더 보안 권고는 판정 범위에서 제외한다.

## 2. 고정 조건

- Origin: `http://localhost:5173`
- 엔드포인트: `https://api.openai.com/v1/responses`
- 모델: `gpt-5.6-sol`
- 인증: 실행 환경의 `OPENAI_API_KEY`를 `Authorization: Bearer` 헤더에만 주입
- 요청: 짧은 한국어 입력, `store: false`, `max_output_tokens: 32`
- 실행 표면: 실제 브라우저의 페이지 JavaScript `fetch`
- 제외: `curl`, Node.js HTTP 클라이언트, 서버 프록시의 성공 여부

## 3. 관측값

1. 브라우저가 사전 요청을 통과시키는가
2. 실제 POST가 OpenAI에 도달하는가
3. 페이지 JavaScript가 HTTP 상태와 응답 본문을 읽을 수 있는가
4. 성공 시 출력 텍스트를 추출할 수 있는가
5. 실패 시 CORS 차단과 API 오류를 구분할 수 있는가

## 4. 판정

- `go`: 브라우저 JavaScript가 2xx 상태와 응답 JSON을 읽고 텍스트를 추출한다.
- `partial`: POST는 도달하지만 브라우저 JavaScript가 응답을 읽지 못한다.
- `no-go`: 사전 요청 또는 CORS 정책으로 POST가 차단된다.
- `blocked`: 키·계정·모델 권한 등 CORS 외 요인 때문에 CORS 성공 여부를 판정하지 못한다.

## 5. 비밀정보 취급

- 키 원문과 `Authorization` 헤더를 파일, 터미널 출력, 브라우저 화면, 스크린샷, HAR에 남기지 않는다.
- 결과에는 키의 존재 여부만 기록한다.
- 응답 기록에서는 사용자 입력과 모델 출력의 짧은 고정 문구만 허용한다.

## 6. 실측 순서

1. 환경변수 존재 여부만 확인한다.
2. 개발 서버를 시작하고 브라우저에서 `http://localhost:5173`을 연다.
3. 페이지 컨텍스트에서 최소 요청 1회를 실행한다.
4. 판정과 비식별 관측값을 `RESULT.md`에 기록한다.
5. `go`일 때만 제품 OpenAI 어댑터 구현과 전체 Harnest 관통 실험으로 진행한다.
