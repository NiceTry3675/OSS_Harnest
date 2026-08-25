# 실험 기록

이 디렉터리는 제품 명세가 아니라 실측 증거와 재현 원장을 보관한다. 제품의 규범 정의는
[`SPEC.md`](../SPEC.md), 미구현·보류 항목은 [`ROADMAP.md`](../ROADMAP.md)를 따른다.

## 현재 요약

- [`delta-01/RESULT.md`](delta-01/RESULT.md) — 원샷 델타 실험의 현재 권위 있는 최종 요약.
  캐시 결함으로 폐기된 해석과 델타 05의 최종 관측을 구분한다.
- [`byo-cors-openai/RESULT.md`](byo-cors-openai/RESULT.md) — OpenAI Responses API의 브라우저
  CORS 정상·401 경로와 OpenAI 프리셋 1라운드 스모크 테스트 결과.
- [`multihop-01/RESULT.md`](multihop-01/RESULT.md) — AI 케이스 초안의 멀티홉 요구가 무문서
  정답률을 낮추는지 실측. 소박한 멀티홉 프롬프트는 복합 질문 실패 모드로 역효과, 단일 답
  강제를 더하면 효과(0.43→0.30).

## 원장 읽기

- `PROTOCOL.md`는 채점 전에 동결한 판정 절차와 날짜별 개정 기록이다. 현재 상태에 맞추려고
  원문을 다시 쓰지 않는다.
- `CURATION*.md`는 keep/drop 전건의 provenance이며 케이스 빌더가 직접 읽는 입력이다.
- `report.md`와 `report2.md`는 실험이 진행되던 시점의 상세 보고서다. 후속 정정 전 해석도
  남아 있으므로 최종 결론은 각 실험의 `RESULT.md`에서 먼저 확인한다.
- 원시 응답, 케이스, 실행 JSON은 수치를 재현하기 위한 증거다. 제품 문서로 승격하지 않는다.
