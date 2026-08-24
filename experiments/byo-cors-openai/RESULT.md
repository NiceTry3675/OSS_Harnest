# OpenAI BYO 브라우저 CORS 실측 결과

> 실측일: 2026-08-24
> 판정: **성공 경로 go / 401 경로 partial**

## 1. 실행 환경

- 브라우저: 호스트 Chrome
- 실제 Origin: `http://127.0.0.1:5173`
- 엔드포인트: `https://api.openai.com/v1/responses`
- 모델: `gpt-5.6-sol`
- 인증: 저장소 `.env`의 `OPENAI_API_KEY`를 브라우저 요청의 Bearer 헤더에만 주입
- CORS 최소 프로브 요청 수: 성공한 유료 요청 1회 + 고정 가짜 키 인증 실패 요청 1회

프로토콜은 Origin을 `http://localhost:5173`으로 고정했지만, 인앱 브라우저가 호스트의
`localhost` 개발 서버에 접근하지 못해 호스트 Chrome과 숫자형 루프백 주소로 실행했다.
이 편차는 결과에 명시하며 프로토콜 원문은 실측 후 수정하지 않는다.

## 2. 관측 결과

### 2.1 정상 인증 경로

| 단계 | 결과 |
|---|---|
| 사전 요청 | `OPTIONS 200` |
| 실제 요청 | `POST 200` |
| 응답 종류 | 브라우저 `cors` 응답 |
| 페이지의 본문 읽기 | 성공 |
| 모델 출력 추출 | `OK` |
| `x-request-id` 읽기 | 성공 |
| 왕복 시간 | 2,997ms |

사전 요청 응답의 관련 헤더는 다음과 같았다.

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Headers: authorization,content-type`
- `Access-Control-Allow-Methods: DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT`
- `Access-Control-Expose-Headers: X-Request-ID, CF-Ray, CF-Ray`

실제 POST 응답에서도 `Access-Control-Allow-Origin: *`와
`Access-Control-Expose-Headers: X-Request-ID, CF-Ray, CF-Ray`를 확인했다.

### 2.2 401 인증 실패 경로

실제 키를 읽지 않고 고정된 가짜 Bearer 키로 같은 Origin·엔드포인트·모델에 요청했다.
앞선 정상 요청의 사전 요청 결과가 브라우저에 캐시된 상태여서 별도 OPTIONS는 관측되지 않았고,
POST는 OpenAI까지 도달했다.

| 관측 계층 | 결과 |
|---|---|
| 네트워크 응답 | `401`, `Content-Type: text/plain` |
| `Access-Control-Allow-Origin` | 없음 |
| `Access-Control-Expose-Headers` | `X-Request-ID, CF-Ray, CF-Ray` |
| Chrome CORS 판정 | `MissingAllowOriginHeader` |
| 페이지 `fetch` | `TypeError: Failed to fetch`로 reject |
| 페이지의 상태·본문 읽기 | 불가 |
| 왕복 시간 | 734ms |

`Access-Control-Expose-Headers`가 있더라도 `Access-Control-Allow-Origin`이 없으므로 페이지에는
응답 객체가 전달되지 않았다. 저수준 브라우저 네트워크 계층에서는 401을 확인할 수 있지만,
제품 JavaScript는 이 상태를 일반 네트워크 오류나 preflight CORS 실패와 구분할 수 없다.

### 2.3 OpenAI 프리셋 1라운드 스모크 테스트

2026-08-24에 같은 `http://127.0.0.1:5173` Origin과 저장소 `.env`의 키를 사용해
Harnest 인수인계 템플릿의 승인 전 검증부터 라운드 1 체크포인트까지 실제
`gpt-5.6-sol`로 실행했다. 키 값은 화면 출력·문서·저장소에 기록하지 않았다.
이 스모크 테스트의 추가 모델 호출은 위 CORS 최소 프로브 요청 수에 포함하지 않는다.

| 단계 | 결과 |
|---|---|
| 승인 전 1콜 연결 테스트 | 성공, 승인 화면 진입 |
| 판정 절차 결속 | `OpenAI · gpt-5.6-sol` 확인 |
| 시험관 배터리 | 종합 `주의` — 순서·변별력·안정성 통과, 꼼수 내성 주의 |
| 캘리브레이션 | `3/3` 일치, 통과 |
| 승인·동결 | 성공, 다이제스트 `13165c043c0eaaa7e21bdbdc18885d479be6d2ed8c2b9d35c82115d5a5f12edd` |
| 라운드 0 | 가시 기준선 `83.3점`, 숨김 시작 `0점` |
| 라운드 1 | 후보 `100점` 채택, 챔피언 `100점`, 라운드 1 체크포인트에서 정상 일시정지 |

실측 입력은 질문·답 4쌍(가시 3·숨김 1), 분량 상한 2,000자였다. 꼼수 내성 `주의`는
기록 전체가 분량 상한 안에 들어가 베끼기 방어가 약하다는 경고이며 승인 차단은 아니다.
숨김 종료 점수는 루프가 `done`일 때만 채점한다는 불변식 때문에 1라운드 일시정지 범위에서는
생성되지 않았다.

## 3. CORS 판정

Chrome의 로컬 Harnest Origin에서 OpenAI Responses API로 직접 호출할 때,
정상 Bearer 인증을 포함한 사전 요청과 POST가 모두 통과했고 페이지 JavaScript가 응답 JSON을
읽었다. 따라서 정상 경로의 OpenAI BYO 브라우저 직행 CORS는 프로토콜 §4에 따라 **go**다.

반면 401 응답은 POST가 도달했지만 CORS 허용 Origin이 없어 페이지 JavaScript가 응답을 읽지
못했으므로 **partial**이다. OpenAI 연결 테스트는 정상 키의 성공을 확인할 수 있지만, 실패 시
`CORS 또는 인증/네트워크 오류`로 묶어 안내해야 하며 401이라고 단정할 수 없다.

이 CORS 판정은 2026-08-24의 관측 결과이며 장기 호환성을 보장하지 않는다.

## 4. 판정 범위

이 실험은 `http://127.0.0.1:5173`에서 OpenAI Responses API의 CORS 정상·401 경로와,
OpenAI 프리셋의 승인 전 연결부터 라운드 1 체크포인트까지를 다룬다.
