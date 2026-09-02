# docs/

이 폴더는 코드와 정책을 **풀어 설명하는 문서**를 둔다. 정책과 불변식의 정본은
[`SPEC.md`](../SPEC.md), 필드와 실행 계약의 정본은 `packages/contracts`, 실측 근거는
[`experiments/`](../experiments/README.md)이며, 이 폴더의 문서는 그것을 대체하지 않는다.

| 문서 | 역할 | 갱신 시점 |
|---|---|---|
| [`current-loop-structure.md`](current-loop-structure.md) | 루프 엔진과 인수인계 템플릿의 실행 흐름, 채택 판단, 정보 경계, 체크포인트를 코드 기준으로 도식화 | 엔진·템플릿 동작이 바뀔 때 |
| [`user-scenario.md`](user-scenario.md) | 비개발자 관점의 전체 사용자 여정과 채택 기준 시퀀스 | 사용자 흐름이나 화면 단계가 바뀔 때 |
| [`terminology-inventory.md`](terminology-inventory.md) | 화면·문서 용어 점검 목록과 대표 용어 기준(§2) | 용어를 새로 정하거나 바꿀 때 |

`archive/`에는 구현되지 않은 과거 설계 초안과 완료된 작업의 진행 기록을 보관한다. 현재 계약이나
로드맵으로 읽지 않으며, 고쳐 쓰지 않는다.
