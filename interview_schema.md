# Harnest 인터뷰 JSON 스키마 v0.3

> 프론트(인터뷰 위저드) ↔ 생성 엔진 사이의 **입력 계약**.
> 생성물(Evaluation Pack·루프 스펙, zip 구조)은 별도 문서(출력 명세)로 다룬다 — 이 문서와 섞지 않는다.
> 규범 정의의 단일 원본은 SPEC.md §3 — 이 문서는 인용하되 재서술하지 않는다. 근거 원칙은 PHILOSOPHY.md 참조.

## v0.2 → v0.3 변경 요약 (2026-08-21)

1. `evaluation.gates` 신설 — 가중치로 상쇄 불가한 hard gate(실격/점수 상한). 날조·절대 분량 초과가 문체 점수로 만회되지 않게 (SPEC §3 원칙 4).
2. `evaluation.judge` 확장 — 판정 절차 동결의 실체화: `model`·`promptProfile`(버전)·`decoding` 신설, 스칼라 집계(`panel.aggregation`: median/mean)와 pairwise 투표 집계(`pairwise.voteAggregation`: majority) 분리, `verbosityPenalty` 불리언 폐기 → 결정적 `lengthCorrection` 규칙.
3. `examinerReport.definitionDigest` 신설 — 리포트가 criteria만이 아니라 **판정 절차 전체**(criteria + gates + judge + holdout)에 결속. 절차의 어느 부분을 고쳐도 리포트 무효.
4. 캘리브레이션 요건 — llm_judge 포함 evaluation은 캘리브레이션(사용자 A/B 판정) 통과가 승인의 전제. 결과 기록은 리포트 본문(응답 스키마) 소관.
5. 결정적 전용 면제 — llm_judge가 없는 evaluation은 examinerReport·캘리브레이션 면제(`examinerReport: null` 허용). pairwise 금지는 유지 (SPEC §10 스켈레톤 특례).
6. 홀드아웃 쓰기 = 재승인 — 재분할/배지 반납 문구 폐기.
7. `caseList` 확장 — `expectedAnswer`·`evidenceRefs`·`tags` 선택 필드 (시험관 증거 품질 상승).
8. 소수정 — weight 합 허용 오차(±0.001), `status` 값 정의, 인용 정리.
9. `case_answering` kind + `judge.responder` 신설 (2026-08-22) — 가족 2(문서×질문)의 본체 채점: responder가 **산출물만 보고** 케이스를 실제로 풀고, grader가 정답과 대조. 판정식상 "llm_judge 포함"으로 편입(리포트·캘리브레이션 필수), panel은 미적용.

## v0.1 → v0.2 변경 요약

1. `evaluation.examinerReport` 신설 — 시험관 검증 리포트의 참조(id + hash). 승인은 "채점표 텍스트 읽기"가 아니라 "검증 리포트를 보고 채용"(SPEC §4.1).
2. `evaluation.judge` 신설 — 패널 구성·집계 규칙·pairwise 설정. 동결 단위는 인원수가 아니라 **판정 절차 전체**(SPEC §3 원칙 4)이므로, 이 구성은 `loop`가 아니라 승인 시 동결되는 `evaluation`에 속한다.
3. 사용자 지정 홀드아웃 입력 경로 — `role: "cases"`, `caseList` 답변 타입, `evaluation.holdout` (SPEC §3 원칙 7).
4. 홀드아웃 은닉 문구를 재정의된 위협 모델로 수정 — 은닉의 경계는 사용자가 아니라 루프.

---

## 1. 설계 원칙

1. **템플릿 추가 = 스키마 무변경.** 질문 목록은 템플릿 정의 파일이 선언하고, 답변은 `answers: {질문ID: 값}` 맵으로만 전달. 커뮤니티가 템플릿을 기여해도 이 계약은 그대로.
2. **평가 기준 승인(HITL 1지점)의 결과가 스키마의 심장.** `evaluation` 블록 = **동결되는 판정 절차 전체** — 기준·루브릭만이 아니라 hard gate·패널 구성·집계 규칙·pairwise 설정·홀드아웃 정책, 그리고 v0.3부터 저지 모델·프롬프트 버전·디코딩 파라미터까지 (SPEC §3 원칙 4가 v1.2에서 같은 범위로 확장됨 — 정합). "승인 후 불변"의 적용 범위가 곧 이 블록의 경계다.
3. **2단계 제출, 1개 스키마.** 같은 스키마를 두 번 보낸다:
   - 1차 제출: `evaluation: null` → 엔진이 평가 기준 후보 + **시험관 검증 리포트** + **캘리브레이션 예시**(A/B 쌍, 꼼수 예시 포함)를 제안 (응답 스키마는 별도 — §8)
   - 최종 제출: 캘리브레이션을 통과하고 사용자가 승인한 `evaluation` 포함 → 엔진이 Evaluation Pack·루프 스펙 생성
4. **비개발자 퍼스트 타입 제약.** Lite에서 답변 타입은 `text / paste / choice / multiChoice / number / file / caseList`만. `code / regex / command`는 고급 모드 전용.
5. **버전 명시.** `schemaVersion`(semver) + 템플릿 버전 고정으로 저장된 프로젝트 호환성 보장.
6. **읽기는 자유, 쓰기는 기록.** 사용자의 쓰기(기준 수정, 홀드아웃 지정 등)만 provenance로 남는다. 열람은 기록 대상이 아니므로 이 스키마에 열람 관련 필드는 존재하지 않는다 (SPEC §3 원칙 7).

---

## 2. 최상위 구조

```json
{
  "schemaVersion": "0.3.0",
  "projectId": null,
  "template": { "id": "resume-match", "version": "1.0.0" },
  "mode": "lite",
  "goal": "카카오 서버 개발자 공고에 맞게 내 자소서를 개선하고 싶다",
  "artifact": { },
  "answers": { },
  "evaluation": null,
  "loop": { },
  "client": { "locale": "ko", "submittedAt": "2026-08-20T14:20:00+09:00" }
}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `schemaVersion` | string (semver) | 이 문서의 스키마 버전 |
| `projectId` | string \| null | 서버 발급 UUID. 신규 생성 시 null |
| `template.id` | string | 템플릿 폴더명과 동일 (kebab-case) |
| `template.version` | string | 인터뷰 시점의 템플릿 버전 고정 |
| `mode` | `"lite"` \| `"advanced"` | 실행 모드. 답변 타입 제약에 영향 |
| `goal` | string | 사용자의 자연어 목표 (생성 엔진 프롬프트 재료) |
| `artifact` | object | 최적화 대상 초기 산출물 (3절) |
| `answers` | object | 템플릿 질문 답변 맵 (4절) |
| `evaluation` | object \| null | 평가 기준 승인 결과 = 동결되는 판정 절차 (5절). 1차 제출 시 null |
| `loop` | object | 루프 실행 설정 (6절) |
| `client` | object | 로케일, 제출 시각 등 메타 |

---

## 3. `artifact` — 최적화 대상

```json
{
  "type": "text",
  "label": "자기소개서",
  "content": "저는 다양한 프로젝트를 경험했습니다. ...",
  "origin": "user"
}
```

- `type`: `"text"` (Lite는 text만) / 고급 모드: `"files"` (zip 생성 대상 파일 목록)
- `origin`: `"user"`(직접 입력) / `"generated"`(초안이 없어 엔진이 시드 생성 — 그린필드 경로)
- 그린필드일 때 `content`는 빈 문자열, 엔진이 1차 시드를 만들고 루프가 이를 개선.

### 재료 기반 생성 (초안 없이 스펙만 입력하는 경우)
- 예: 자소서 초안 없이 자격증·대외활동·경력만 넣고 생성 시작.
- 재료는 artifact가 아니라 **answers에 담는다.** 템플릿 정의에서 해당 질문에 `role: "material"`을 선언 → 엔진이 그 답변들을 시드 생성 재료로 사용. 스키마 무변경 원칙 유지.
- 위저드 UX: "초안이 있나요?" 분기 — 있으면 artifact에 붙여넣기(`origin: "user"`), 없으면 material 질문들로 진행(`origin: "generated"`).
- **grounding 의무 제안**: `origin: "generated"`인 프로젝트는 루프가 점수를 올리려고 재료에 없는 사실을 지어낼 위험이 있음 → 엔진은 "재료(material 답변)에 없는 경험·수치를 주장하지 않는가"를 검사하는 llm_judge **게이트**(§5 `gates`)를 기본 포함해 제안해야 한다 — v0.2의 가중 기준 권고에서 격상: 날조는 가중치로 상쇄될 수 없다 (방어 세트의 조건부 기본 — SPEC §3 원칙 4·5).

---

## 4. `answers` — 템플릿 질문 답변 맵

템플릿 정의 파일(템플릿 팩 소관)이 질문을 선언:

```json
{
  "id": "job_posting",
  "type": "paste",
  "label": "지원할 채용공고를 붙여넣어 주세요",
  "required": true,
  "modes": ["lite", "advanced"],
  "role": "context"
}
```

- `role`:
  - `"context"` (기본) — 생성·채점 참고 정보
  - `"material"` — 산출물의 원재료 (시드 생성 + grounding 기준의 대조 근거)
  - `"cases"` (v0.2 신설) — 평가 케이스의 원천 (기출문제, 질문 로그 등). 홀드아웃 분할의 대상이며, 답변 타입은 반드시 `caseList`

프론트는 답변을 질문 ID로 키잉해서 전달:

```json
"answers": {
  "job_posting":  { "type": "paste",  "value": "카카오 서버 개발자 채용 ..." },
  "tone":         { "type": "choice", "value": "정중하고 간결하게" },
  "must_include": { "type": "text",   "value": "Spring, MSA 경험" },
  "length_limit": { "type": "number", "value": 1700 }
}
```

### 답변 타입 (Lite 허용)
| 타입 | value | 용도 |
|---|---|---|
| `text` | string | 짧은 자유 입력 |
| `paste` | string | 긴 원문 붙여넣기 (채용공고 등) |
| `choice` | string | 단일 선택 |
| `multiChoice` | string[] | 복수 선택 |
| `number` | number | 글자수 제한, 인원수 등 |
| `file` | { name, mime, contentBase64 } | 근무표 엑셀 등 (크기 상한 프론트 검증) |
| `caseList` (v0.2) | { id, label?, content, expectedAnswer?, evidenceRefs?, tags? }[] | 평가 케이스 목록 (기출문제 등). `role: "cases"` 질문 전용 |

고급 모드 전용: `code`, `regex`, `command`.

### `caseList` 상세
- `id`: 케이스 식별자. 프론트가 추가 순으로 발급(`"case-1"`, `"case-2"`, …)하며 **한 프로젝트 안에서 재사용·재부여하지 않는다** (홀드아웃 지정이 id를 참조하므로).
- 홀드아웃 지정 플래그는 여기 없다 — 지정은 `evaluation.holdout.cases`가 정본(5절). caseList는 케이스 본문만 나른다.
- `expectedAnswer` · `evidenceRefs` · `tags` (v0.3, 선택): 기출의 정답, 출처 참조(예: `"source:chapter-7:para-18"`), 분류 태그. 있으면 시험관의 증거 품질이 오른다 — 케이스 채점이 "저지의 감"이 아니라 정답 대조에 가까워진다. 없어도 유효.
- 위저드 UX: 케이스를 목록으로 추가·편집, 승인 화면에서 홀드아웃 지정 토글(템플릿이 사용자 지정을 지원할 때만 노출).

### 검증 규칙
- 템플릿에 없는 질문 ID → 엔진이 거부 (400)
- `required` 누락 → 프론트 1차 차단 + 엔진 재검증
- `modes`에 현재 mode 미포함 질문의 답변 → 거부
- `role: "cases"` 질문의 답변이 `caseList`가 아니면 거부. caseList의 id 중복 → 거부

---

## 5. `evaluation` — 승인된 판정 절차 (HITL 1지점, 승인 후 불변)

1차 제출에 대한 엔진 응답으로 **기준 후보 + 시험관 검증 리포트 + 캘리브레이션 예시**가 오고, 사용자가 캘리브레이션을 통과시키고 리포트를 확인·수정한 결과를 최종 제출에 담는다.

```json
"evaluation": {
  "status": "approved",
  "approvedAt": "2026-08-20T14:25:11+09:00",
  "examinerReport": { "id": "rep_9f2c81", "definitionDigest": "sha256:77b0...", "hash": "sha256:3aa1..." },
  "judge": {
    "model": "provider/judge-model-id",
    "promptProfile": { "id": "judge-default", "version": "1.0.0" },
    "decoding": { "temperature": 0.2 },
    "panel": { "size": 3, "aggregation": "median" },
    "pairwise": { "enabled": true, "positionSwap": true, "voteAggregation": "majority",
                  "lengthCorrection": { "scorer": "length_correction", "params": { "per": 100, "penalty": 1 } } }
  },
  "holdout": { "policy": "auto" },
  "gates": [
    { "id": "hard-length", "kind": "deterministic", "scorer": "length_within",
      "params": { "max": 2200 }, "onFail": "reject", "provenance": "suggested" }
  ],
  "criteria": [
    {
      "id": "keyword-coverage",
      "kind": "deterministic",
      "scorer": "keyword_coverage",
      "params": { "sourceAnswer": "job_posting", "minLength": 2 },
      "weight": 0.4,
      "provenance": "suggested"
    },
    {
      "id": "jd-fit-rubric",
      "kind": "llm_judge",
      "rubric": [
        { "item": "공고의 핵심 요구역량이 구체적 경험으로 뒷받침되는가", "scale": [1, 5] },
        { "item": "직무와 무관한 일반론적 서술이 없는가", "scale": [1, 5] }
      ],
      "weight": 0.5,
      "provenance": "modified"
    },
    {
      "id": "length-limit",
      "kind": "deterministic",
      "scorer": "length_within",
      "params": { "max": 1700 },
      "weight": 0.1,
      "provenance": "added"
    }
  ]
}
```

### "llm_judge 포함"의 판정식 — 단일 정의 (v0.3)
- **criteria ∪ gates에 kind가 `"llm_judge"` 또는 `"case_answering"`인 항목이 하나라도 있으면 "llm_judge 포함"**(= LLM 판정이 존재), 하나도 없으면 "결정적 전용". examinerReport·캘리브레이션 요건, pairwise 허용 여부, 채택 규칙(SPEC §5.1.1)이 전부 이 판정식 하나를 따른다 — 조항마다 따로 세지 않는다. (2026-08-22 단서: 채택 규칙에는 판정식과 별개의 예외가 하나 생겼다 — **케이스 실측 중심 루프의 제3 채택 모드**(pairwise 부적용, SPEC §5.1.1). 발동 조건은 SPEC 미결 4에서 확정 예정이며, 확정 시 `pairwise.enabled` 검증 규칙과 함께 v0.4에 반영한다. 이 판정식 자체 — llm_judge 포함/결정적 전용 — 는 변하지 않는다.)
- 유일한 예외는 `panel`: 판정식과 별개로 **kind `"llm_judge"`인 항목이 있을 때만** 필수다. case_answering의 grader는 단일 check 판정(정답 대조 — 결정적에 가깝게 신뢰됨, PHILOSOPHY §4 가족 2)이라 패널을 적용하지 않는다.
- gates에만 llm_judge가 있는 경우(예: §3의 grounding 게이트)도 "llm_judge 포함"이다: panel 필수, 리포트·캘리브레이션 필요, pairwise 허용.

### `examinerReport` — 시험관 검증 리포트 참조 (v0.2 신설, v0.3 확장)
- 1차 제출 응답으로 받은 검증 리포트(순서·변별력·안정성·꼼수 내성, 항목별 통과/주의/실패 — SPEC §4.1)의 참조. **본문은 응답 스키마 소관**(§8), 요청에는 참조만.
- `definitionDigest` (v0.3): 리포트가 검증한 **판정 절차 전체**(criteria + gates + judge + holdout)의 정규화 다이제스트. 엔진은 최종 제출의 절차에서 같은 다이제스트를 재계산해 일치를 검증한다 — criteria는 그대로 두고 `panel.size`만 바꿔 옛 리포트를 유효한 척 재사용하는 우회를 차단. 불일치 → 거부, 재검증 요구. 산출 규칙(정규화 방식)은 응답 스키마에서 정의(§8 미결 4).
- llm_judge 포함(위 판정식) evaluation에서 **리포트 참조 없는 승인은 불가**, 그리고 **캘리브레이션 통과가 승인의 전제** — 사용자가 A/B 산출물 쌍(꼼수 라이브러리 예시 1개 이상 포함)을 직접 판정하고 시험관 판정과의 일치를 확인한다. 판정 내역·일치율은 리포트 본문에 기록하고, **통과 기준(판정 쌍 수, 일치 기준, 불일치 시 분기 — 기준 수정 유도)은 응답 스키마에서 정의**(§8 미결 4). "리포트를 보고, 캘리브레이션을 통과시키고 채용"이 승인의 정의다.
- **결정적 전용 면제** (v0.3): 결정적 전용(위 판정식)이면 `examinerReport: null` 허용, 캘리브레이션도 면제 — 캘리브레이션할 저지가 없고, 결정적 채점기의 올바름은 저지 검증이 아니라 코드·파라미터 검토의 문제다 (SPEC §10 스켈레톤 특례).

### `judge` — 판정 절차 구성 (v0.2 신설, v0.3 확장)
- `model` (v0.3): 판정에 사용할 모델 ID — 동결 대상. 허용값의 검증 규칙은 v0.4 백로그(§8-8), 티어별 허용 모델 프로파일 자체는 출력 명세 소관.
- `promptProfile` (v0.3): 저지 프롬프트 템플릿의 id + version — 프롬프트 문안 변경도 판정 절차 변경이다.
- `decoding` (v0.3): temperature 등 디코딩 파라미터 — 동결 대상.
- `responder` (v0.3): case_answering용 답변자 설정 `{ model, promptProfile, decoding }` — case_answering 기준이 있을 때만 필수, 없으면 금지. responder도 판정 절차의 일부이므로 동결·definitionDigest 결속 대상(responder 모델이 바뀌면 점수가 흔들린다). **불변식: responder는 산출물과 해당 케이스 질문만 본다** — 원문 자료도, 다른 케이스도, `expectedAnswer`도 컨텍스트에 없다. "요약본만으로 푼다"의 문자 그대로의 구현이며, 루프 엔진이 오픈소스이므로 코드로 감사 가능하다.
- `panel`: llm_judge 포함(위 판정식)이면 필수. `size` 1~5, `aggregation`: `"median"` / `"mean"` — **스칼라 점수 집계**. (v0.2의 `"majority"`는 스칼라 집계로는 모호해 제거 — 다수결은 pairwise 투표의 집계다.) 패널은 동결된 판정 절차의 내부 구성 — 여럿이어도 되지만 루프 중에 변할 수 없다 (SPEC §3 원칙 4). **퇴화 거부 규칙**: `size` > 1이면 `decoding.temperature` > 0이어야 한다 — 동일 결정적 호출의 N회 반복은 median의 의미가 없다. 패널원별 모델·프롬프트 변형(이질 패널 — PHILOSOPHY §2 "관점이 다른 judge 패널"의 온전한 표현)은 v0.4 백로그(§8-8).
- `pairwise`: 채택/롤백 판정 설정 (SPEC §5.1.1 "채택은 pairwise, 서사는 스칼라"). `enabled`는 **llm_judge 포함(위 판정식)일 때만 true 허용** — 결정적 전용에서 true → 거부 (SPEC §3 원칙 5 단서). `positionSwap` 기본 true — 채택은 양방향 모두 승리일 때만(채택 규칙 3종은 SPEC §5.1.1, 명세는 Evaluation Pack 문서). `voteAggregation` (v0.3): `"majority"` — pairwise 투표 집계(스칼라 집계와 별개 필드). `lengthCorrection` (v0.3): 장황함 보정은 저지 프롬프트에 숨은 플래그가 아니라 **결정적 규칙**(scorer 참조 + params — scorer 레지스트리 §8 미결 2와 공유). v0.2의 `verbosityPenalty` 불리언 폐기.

### `gates` — hard gate (v0.3 신설)
- 가중 합산으로 상쇄될 수 없는 규칙. `onFail`: `"reject"`(후보 실격 — 채택 불가) / `"cap"`(점수 상한 — `capScore` 필수).
- `capScore`: number — `onFail: "cap"`일 때 필수, `"reject"`일 때 금지. 스케일은 합성 점수와 동일(0~100). 예:
  ```json
  { "id": "no-fabrication", "kind": "llm_judge",
    "check": "재료(material 답변)에 없는 경험·수치를 주장하지 않는가",
    "onFail": "cap", "capScore": 40, "provenance": "suggested" }
  ```
- `kind`: `"deterministic"` / `"llm_judge"` — gates에 `case_answering`은 불가(공통 규칙 참조). deterministic이면 `scorer` + `params`, llm_judge면 `check`(단일 검사 문항 — 루브릭 배열이 아니라 통과/실패 판정). **weight가 없다** — 게이트는 저울이 아니라 문이다. `provenance`는 criteria와 동일하게 필수.
- 용도: 날조(grounding — §3), 절대 분량 초과, 필수 제약 위반. "날조를 문체 점수로 만회"를 구조로 차단한다 (SPEC §3 원칙 4).
- soft 기준과의 관계 예: 분량은 criteria의 `length_within`(목표치, 가중)과 gates의 `length_within`(절대 상한, 실격)을 함께 쓸 수 있다.
- 게이트 평가와 채택(pairwise)의 실행 순서, cap 후보의 채택 시 의미는 출력 명세 소관 (SPEC §12 미결 4).

### `holdout` — 홀드아웃 정책 (v0.2 신설)
- `policy`: `"auto"`(기본 — 승인 후 엔진이 분할·생성) / `"user"`(사용자 지정 — 템플릿이 지원 선언한 경우만, SPEC §6 템플릿 규격).
- `policy: "user"`일 때 `cases: ["case-3", "case-7"]` — `role: "cases"` 답변의 케이스 id 참조. 존재하지 않는 id → 거부. 이 정책 값이 결과 카드의 홀드아웃 provenance(자동 분할 vs 사용자 지정) 표기의 원천.
- **홀드아웃 케이스 본문의 위치**: `auto`면 이 스키마에 없다(승인 이후 엔진이 생성하는 출력). `user`면 caseList 안에 본문이 있고 여기서는 참조만 한다.
- **은닉의 경계는 사용자가 아니라 루프다** (SPEC §3 원칙 7). 불변식은 둘 — "홀드아웃은 Generator/Critic 컨텍스트에 절대 포함되지 않는다" + "홀드아웃 점수에서 파생된 신호가 생성·채택·중단에 유입되지 않는다"(채점은 라운드 0·종료 시에만) — 이며 이는 출력(Evaluation Pack·루프 스펙) 소관. 사용자 열람은 자유·비기록 — 기본 UI가 실행 전에 표시하지 않는 것은 연출이지 보안 경계가 아니다.
- **홀드아웃 케이스의 수정·가시 세트 이동 = evaluation 블록의 변경 = 재승인** (새 `approvedAt` + 새 examinerReport). 종전의 재분할/배지 반납 방식은 폐기(2026-08-21) — 승인을 유지한 채 장부를 맞추는 경로를 두지 않는다.
- **auto 생성 케이스의 해시 결속은 출력 소관**: `policy: "auto"`의 케이스는 승인 후 생성되므로 definitionDigest에는 정책 값만 들어간다 — 생성된 케이스 해시는 팩 컴파일 시점의 **팩 다이제스트**가 잠근다(체리피킹 감사 가능성 + auto 케이스 재승인 트리거의 기계적 정의 — SPEC §12 미결 4).

### `case_answering` — 케이스 실측 채점 (v0.3 신설, 가족 2의 본체)

```json
{ "id": "exam-answerability", "kind": "case_answering",
  "casesFrom": "past_exams", "weight": 0.7, "provenance": "suggested" }
```

- 동작(**전부 고정 — 설정 없음**): 가시 케이스마다 ① `judge.responder`가 산출물 + 케이스 질문만 보고 답안 생성 → ② grader(`judge.model`)가 채점 — `expectedAnswer` 있으면 "정답의 핵심을 담는가" 단일 check로 0 / 0.5 / 1, 없으면 grader 단독 정오 판정(검증 리포트에 "주의" 표시 — expectedAnswer 입력을 유도) → ③ 가시 케이스 **평균** → 0~100.
- `casesFrom`: `role: "cases"` 질문 ID 참조. 존재하지 않거나 role이 다르면 거부. 홀드아웃 케이스는 자동 제외(가시 세트만 채점) — 홀드아웃 점수는 같은 절차를 홀드아웃 케이스에 라운드 0·종료 시에만 적용한다.
- "그럴듯해 보인다"는 저지의 추정이 아니라 **실제로 풀어본 결과**를 채점한다 — 원샷이 못 하는 "케이스 N개 동시 만족"의 실측이자, 가족 2(문서×질문) 도메인의 본체 채점.
- 비용 주의: 후보 1개 채점 = 가시 케이스 수 × 2콜(responder + grader) — 비용의 주범. 가시 케이스 상한은 출력 명세·정책 소관(SPEC §12 미결 2). **라운드별 케이스 샘플링은 금지** — 라운드끼리 다른 시험을 보면 점수 비교와 개선 곡선이 깨진다.
- 캘리브레이션과의 결합: case_answering 포함 시 캘리브레이션 예시는 "responder의 답안 vs 기출 정답 — 시험관의 판정에 동의하는가" 형태 — 사용자가 스스로 검증 가능한 신뢰 서사가 승인 화면에서부터 작동한다.

### 공통 규칙
- `kind`: `"deterministic"`(채점기 라이브러리의 scorer 호출) / `"llm_judge"`(고정 루브릭, 동결) / `"case_answering"`(케이스 실측 채점 — 위 정의, criteria 전용·gates에는 불가)
- `weight`: criteria 합계 1.0 (±0.001 허용 오차, 엔진 검증). gates는 무가중(§5 gates)
- `provenance`: `"suggested"`(제안 그대로) / `"modified"`(수정) / `"added"`(사용자 추가) — 대시보드·연구용 기록. criteria·gates 모두 **필수**
- `status`: 최종 제출에서 항상 `"approved"` — 다른 값은 이 스키마에 존재하지 않는다(1차 제출은 `evaluation: null`이므로 "초안" 상태가 필요 없다). 그 외 값 → 거부
- **승인 후 `evaluation` 블록 전체가 불변** (criteria·gates·judge·holdout 포함). 수정하려면 재승인 = 새 `approvedAt` + **새 examinerReport**(definitionDigest 재발급) — 절차가 바뀌면 시험관 검증도 다시 통과해야 한다. **결정적 전용**(`examinerReport: null`)은 새 `approvedAt`만으로 재승인 — 리포트·다이제스트 재발급 의무 없음. **재캘리브레이션 트리거(열거)**: `judge` 블록의 변경, 또는 `kind: "llm_judge"`인 criteria/gates의 추가·삭제·수정 — 그 외 변경(결정적 기준, 가중치 등)은 리포트 재발급만.

---

## 6. `loop` — 실행 설정

```json
"loop": {
  "maxIterations": 10,
  "llmRoute": "trial",
  "branching": { "width": 1 },
  "critic": false,
  "stop": { "targetScore": null, "plateauRounds": 3 }
}
```

- `llmRoute`: `"trial"`(무료 체험 — 서버 프록시, 쿼터·반복 상한은 서버가 강제) / `"byok"`(사용자 키, 브라우저 직행). 티어 차이는 모델·쿼터뿐, 하네스 차등 없음 (SPEC §12 미결 2 — 수치 결정됨: trial 10회·계정당 2~3회, 30회는 byok 옵트인).
- `maxIterations`: trial일 때 서버 상한(10) 이하로 클램프
- `branching.width`: 라운드당 병렬 변이 수 (Generator 에이전트 수). **v1은 전 티어 1** — 빔은 스트레치(SPEC §5.3). 필드는 예약: v1 엔진은 1 초과 값을 거부
- `critic`: **v1 미탑재**(스트레치 — SPEC §5.3). 필드는 예약: v1 엔진은 true를 거부. v1의 plateau 대응은 조기 종료뿐
- `stop.plateauRounds`: N회 연속 개선 없으면 조기 종료. `maxIterations` 안에서 발동 가능해야 한다 — trial 상한(10회)에서 8은 사실상 무력, **3 권장**(v1의 유일한 정체 대응이므로)
- 생략 시 기본값: `branching.width` 1, `critic` false, `stop.targetScore` null. `maxIterations`·`llmRoute`는 필수
- **여기 없는 것들**: 원샷 베이스라인(라운드 0)은 설정이 아니라 모든 루프의 상수라 필드가 없다 (SPEC §3 원칙 6). 패널·pairwise는 동결 대상이므로 `evaluation.judge` 소관 — loop에 두지 않는다.

---

## 7. 전체 예시

> 예시는 계약의 예시일 뿐 템플릿 라인업 상태(SPEC §6)와 무관 — resume-match는 보류 상태지만 필드 구조가 단순해 스키마 예시로 유지한다.

### 7.1 자소서 매칭 최종 제출 (holdout auto)

```json
{
  "schemaVersion": "0.3.0",
  "projectId": "3f9a2c10-8b7e-4d2a-9c1f-5e6a7b8c9d0e",
  "template": { "id": "resume-match", "version": "1.0.0" },
  "mode": "lite",
  "goal": "카카오 서버 개발자 공고에 맞게 내 자소서를 개선하고 싶다",
  "artifact": {
    "type": "text",
    "label": "자기소개서",
    "content": "저는 다양한 프로젝트를 경험했습니다. ...",
    "origin": "user"
  },
  "answers": {
    "job_posting":  { "type": "paste",  "value": "카카오 서버 개발자 채용 ..." },
    "tone":         { "type": "choice", "value": "정중하고 간결하게" },
    "must_include": { "type": "text",   "value": "Spring, MSA 경험" },
    "length_limit": { "type": "number", "value": 1700 }
  },
  "evaluation": {
    "status": "approved",
    "approvedAt": "2026-08-20T14:25:11+09:00",
    "examinerReport": { "id": "rep_9f2c81", "definitionDigest": "sha256:77b0...", "hash": "sha256:3aa1..." },
    "judge": {
      "model": "provider/judge-model-id",
      "promptProfile": { "id": "judge-default", "version": "1.0.0" },
      "decoding": { "temperature": 0.2 },
      "panel": { "size": 3, "aggregation": "median" },
      "pairwise": { "enabled": true, "positionSwap": true, "voteAggregation": "majority",
                    "lengthCorrection": { "scorer": "length_correction", "params": { "per": 100, "penalty": 1 } } }
    },
    "holdout": { "policy": "auto" },
    "gates": [
      { "id": "hard-length", "kind": "deterministic", "scorer": "length_within",
        "params": { "max": 2200 }, "onFail": "reject", "provenance": "suggested" }
    ],
    "criteria": [
      { "id": "keyword-coverage", "kind": "deterministic", "scorer": "keyword_coverage",
        "params": { "sourceAnswer": "job_posting", "minLength": 2 }, "weight": 0.4, "provenance": "suggested" },
      { "id": "jd-fit-rubric", "kind": "llm_judge",
        "rubric": [
          { "item": "공고의 핵심 요구역량이 구체적 경험으로 뒷받침되는가", "scale": [1, 5] },
          { "item": "직무와 무관한 일반론적 서술이 없는가", "scale": [1, 5] }
        ], "weight": 0.5, "provenance": "modified" },
      { "id": "length-limit", "kind": "deterministic", "scorer": "length_within",
        "params": { "max": 1700 }, "weight": 0.1, "provenance": "added" }
    ]
  },
  "loop": {
    "maxIterations": 10,
    "llmRoute": "trial",
    "stop": { "targetScore": null, "plateauRounds": 3 }
  },
  "client": { "locale": "ko", "submittedAt": "2026-08-20T14:26:02+09:00" }
}
```

### 7.2 시험 요약본 발췌 — caseList + 사용자 지정 홀드아웃

```json
"answers": {
  "source_text":  { "type": "paste", "value": "운영체제 7장 강의노트 전문 ..." },
  "page_limit":   { "type": "number", "value": 2 },
  "past_exams": {
    "type": "caseList",
    "value": [
      { "id": "case-1", "label": "2024 중간 3번", "content": "페이지 교체 알고리즘 LRU와 ...",
        "expectedAnswer": "LRU는 최근 사용 시점 기준으로 ...", "tags": ["virtual-memory"] },
      { "id": "case-2", "label": "2024 기말 1번", "content": "세마포어와 뮤텍스의 차이를 ..." },
      { "id": "case-3", "label": "2025 중간 2번", "content": "가상 메모리에서 TLB 미스가 ...",
        "expectedAnswer": "TLB 미스가 항상 페이지 폴트는 아니다 ...", "evidenceRefs": ["source:chapter-7:para-18"] }
    ]
  }
},
"evaluation": {
  "status": "approved",
  "approvedAt": "2026-08-22T10:00:00+09:00",
  "examinerReport": { "id": "rep_2c11a0", "definitionDigest": "sha256:c9e4...", "hash": "sha256:81f2..." },
  "judge": {
    "model": "provider/judge-model-id",
    "promptProfile": { "id": "judge-default", "version": "1.0.0" },
    "decoding": { "temperature": 0.2 },
    "responder": {
      "model": "provider/responder-model-id",
      "promptProfile": { "id": "responder-default", "version": "1.0.0" },
      "decoding": { "temperature": 0 }
    },
    "panel": { "size": 3, "aggregation": "median" },
    "pairwise": { "enabled": true, "positionSwap": true, "voteAggregation": "majority",
                  "lengthCorrection": { "scorer": "length_correction", "params": { "per": 100, "penalty": 1 } } }
  },
  "gates": [
    { "id": "hard-page-limit", "kind": "deterministic", "scorer": "page_count_within",
      "params": { "max": 2 }, "onFail": "reject", "provenance": "suggested" }
  ],
  "criteria": [
    { "id": "exam-answerability", "kind": "case_answering",
      "casesFrom": "past_exams", "weight": 0.7, "provenance": "suggested" },
    { "id": "readability", "kind": "llm_judge",
      "rubric": [ { "item": "개념 간 관계가 한눈에 들어오는 구조인가", "scale": [1, 5] } ],
      "weight": 0.3, "provenance": "modified" }
  ],
  "holdout": { "policy": "user", "cases": ["case-3"] }
}
```

(템플릿 정의에서 `past_exams`는 `role: "cases"`. case-1, case-2는 루프가 보는 가시 케이스, case-3은 홀드아웃 — 승인 시점에 동결되고 Generator/Critic 컨텍스트에서 배제된다. `exam-answerability`가 가족 2의 본체 채점: responder가 요약본만 보고 case-1·case-2를 실제로 풀고 grader가 `expectedAnswer`와 대조한다. `panel`은 `readability`(kind: llm_judge)가 있어서 필수 — case_answering만 있었다면 생략 가능.)

---

## 8. 미결 (팀 논의 필요)

1. `file`·`caseList` 답변의 크기 상한과 서버 저장 여부 (BYO 경로 프라이버시 원칙과 충돌 주의) — 크기 검증의 서버측 이중화 포함
2. 결정적 scorer 이름 레지스트리 (`keyword_coverage`, `length_within`, `page_count_within`, `length_correction`, `constraint_check` …) — 채점기 라이브러리 패키지와 이름 공유. **params 계약(각 scorer의 필드·단위)도 레지스트리 범위** — 같은 scorer가 예시마다 다른 params로 쓰이는 드리프트 방지
3. 고급 모드 `artifact.type: "files"`의 상세 구조 — Evaluation Pack·zip 출력 명세와 함께 확정
4. 1차 제출 → 응답의 스키마 (이 문서는 요청만 다룸) — 기준 후보 + **시험관 검증 리포트 본문**(검사 항목별 통과/주의/실패, 사용된 프로브의 출처, **캘리브레이션 예시와 사용자 판정 결과·일치율**) 포함. **캘리브레이션 통과 규칙**(판정 쌍 개수 범위, 일치 기준, 불일치 시 분기 — 기준 수정 유도 흐름)도 여기서 정의 — 승인 게이트의 판정 기준이므로 기록 스키마와 함께 확정. examinerReport hash·definitionDigest 산출 규칙(정규화 방식)도 여기서 정의
5. 재제출(기준 수정 → 재승인) 시 caseList 케이스 id의 안정성 규칙 — 케이스 편집이 id를 바꾸는가
6. ~~케이스 기반 채점 kind~~ — **해결(2026-08-22)**: `case_answering` kind + `judge.responder`로 §5에 정의. 동작 전부 고정(정답 대조 0/0.5/1, 가시 케이스 평균), responder는 산출물+케이스 질문만 보는 불변식 포함.
7. 정식 `interview.schema.json`(기계 검증용 JSON Schema) 발행 — 이 문서는 해설로 강등
8. v0.4 백로그: 빈 `cases`/전량 홀드아웃 금지 규칙과 최소·최대 케이스 수, `judge.model` 허용값 검증 규칙, **panel 패널원 배열**(이질 패널 — 패널원별 모델·프롬프트 변형, PHILOSOPHY §2 "관점이 다른 judge 패널"의 온전한 표현), case_answering 세분화(케이스별 가중치, 부분 점수 척도 확장, grader 패널 적용 여부 재검토), semver 호환성 정책·템플릿 버전 업그레이드 경로(예시-schemaVersion 동기화 규칙 포함), `origin: "generated"`에 `role: "material"` 답변 1개 이상 요구 규칙
9. v0.4 백로그 추가 (2026-08-22, 템플릿 재편 — SPEC v1.3 §12 미결 1): **`case_answering` → `case_execution`·`judge.responder` → `judge.executor` 개명** — 의미 일반화: "산출물을 규칙·참조로 사용해 케이스 하나를 처리한다". 요약본×기출, 인수인계 문서×질문 로그, 매뉴얼×문의가 같은 kind가 된다. §5의 동작·불변식(executor는 산출물 + 해당 케이스 입력만 본다)·판정식 편입은 이름만 바꿔 그대로 이식. **`expectedAnswer` 문자열 → 구조화 `expected`** — `mustMention`(필수 포함)·`mustNotClaim`(금지 주장) 등 필드화로 grader LLM 콜의 상당 부분을 결정적 검사로 대체(비용 구조는 SPEC §12 미결 2). **원시 로그 → 케이스 추출 플로우** — 사용자가 메신저·이슈 로그를 붙여넣으면 위저드가 질문·정답 쌍 후보를 추출하고 사용자가 확인·수정(caseList의 입력 UX — 캘리브레이션의 "사용자 판단 = ground truth 공급" 원칙과 결합). 케이스 실측 중심 루프의 제3 채택 모드는 이 스키마가 아니라 SPEC §5.1.1·미결 4 소관.
