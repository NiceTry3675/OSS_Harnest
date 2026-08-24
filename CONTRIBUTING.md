# 기여 가이드

Harnest에 관심을 가져 주셔서 감사합니다. 이슈, 오타 수정, 문서 개선, 새 템플릿, 실측 기록 등
크기와 형식에 관계없이 모든 기여를 환영합니다. 완벽하지 않아도 괜찮습니다 — 초안 PR이나
"이게 맞는 방향인가요?" 수준의 이슈도 좋은 출발점입니다.

## 빠른 시작

Node 22 이상이 필요합니다.

```bash
npm install
npm run dev            # http://localhost:5173
```

개발 흐름과 저장소 구조는 [AGENTS.md](AGENTS.md)에, 실행 방법은 [README.md](README.md)에 있습니다.

## 변경을 보내기 전에

린터는 없습니다. 변경 범위에 맞는 확인만 통과하면 됩니다.

| 변경한 것 | 실행할 것 |
|---|---|
| TypeScript (contracts, engine, template, web) | `npm run typecheck` + 관련 테스트 |
| 웹 동작·빌드 설정 | 위에 더해 `npm run build` |
| API (`apps/api`) | `apps/api`에서 `python3 test_api.py` |
| 여러 계층에 걸친 변경 | 전체 스위트 (`npm run typecheck && npm test && npm run build`) |

커밋 메시지는 한국어를 기본으로 하지만, 영어로 쓰셔도 됩니다. 형식 규칙은 따로 없습니다 —
무엇을 왜 바꿨는지 알아볼 수 있으면 충분합니다.

## 단 하나의 단단한 규칙: 불변식

이 프로젝트에서 자유롭지 않은 영역은 하나뿐입니다. **승인된 판정 절차는 바뀌지 않는다**는
제품 불변식입니다.

- 불변식의 정본은 [SPEC.md](SPEC.md)와 `packages/contracts`의 테스트입니다.
- `definitionDigest` 범위, 홀드아웃 정책, 채택 규칙, 체크포인트 재개 조건 등을 건드리는
  변경은 먼저 이슈로 논의해 주세요. SPEC 수정과 계약 테스트 갱신이 함께 필요합니다.
- 그 밖의 모든 것 — UI, 문서, 템플릿, 실험, 리팩토링 — 은 자유롭게 제안하시면 됩니다.

BYO API 키는 브라우저 `localStorage`에만 저장하고, 모델 요청은 브라우저에서 벤더로 직행해야
합니다. 키나 자격 증명 파일을 커밋하지 마세요.

## 새 템플릿 만들기

템플릿은 Harnest를 확장하는 가장 좋은 방법입니다.

- 템플릿은 `templates/*` 아래 독립 패키지로 추가하고, `TemplateEntry` 인터페이스로 등록합니다.
  기존 예시는 [`templates/timetable`](templates/timetable)(결정적, 모델 호출 없음)과
  [`templates/handover`](templates/handover)(모델 기반)입니다.
- 페이지나 엔진에 템플릿 전용 분기를 넣지 않는 것이 유일한 구조 규칙입니다.
- 템플릿을 이 저장소에 넣을지, 본인 저장소에서 유지할지는 자유입니다. 저장소에 들어온
  템플릿은 만든 사람이 계속 주도권을 갖습니다. 원작자의 의도와 다른 방향의 큰 변경은
  원작자의 의견을 먼저 묻고, 응답이 없으면 메인테이너가 판단합니다.

## 패키지 경계

- `packages/contracts`와 `packages/loop-engine`이 안정 경계입니다. 의존 방향은
  `contracts` ← `loop-engine` / `templates/*` ← `apps/web`이며, 역방향 의존은 받지 않습니다.
- 현재는 npm에 배포하지 않는 private 모노레포입니다. 계약이 안정되면 `@harnest/contracts`와
  `@harnest/loop-engine`부터 배포를 검토합니다.

## 실험 기록

`experiments/`의 동결된 프로토콜과 원시 관측값은 수정하지 않습니다. 바로잡을 것이 있으면
사유와 절대 날짜를 붙인 정정 기록을 덧붙여 주세요. 새 실측 기여는 언제나 환영합니다.

## 라이선스

이 프로젝트는 [MIT 라이선스](LICENSE)를 따릅니다. 기여를 제출하면 그 기여도 MIT 라이선스로
배포되는 데 동의하는 것으로 봅니다. 별도의 CLA는 없습니다.
