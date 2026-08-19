# Harnest 인터뷰 JSON 스키마 v0.2

> 프론트(인터뷰 위저드) ↔ 생성 엔진 사이의 **입력 계약**.
> 생성물(루프 스펙, zip 구조)은 별도 문서(출력 명세)로 다룬다 — 이 문서와 섞지 않는다.
> 근거 원칙은 PHILOSOPHY.md, 제품 맥락은 SPEC.md 참조.

## v0.1 → v0.2 변경 요약

1. `evaluation.examinerReport` 신설 — 시험관 검증 리포트의 참조(id + hash). 승인은 "채점표 텍스트 읽기"가 아니라 "검증 리포트를 보고 채용"(SPEC §4.1).
2. `evaluation.judge` 신설 — 패널 구성·집계 규칙·pairwise 설정. 동결 단위는 인원수가 아니라 **판정 절차 전체**(SPEC §3 원칙 4)이므로, 이 구성은 `loop`가 아니라 승인 시 동결되는 `evaluation`에 속한다.
3. 사용자 지정 홀드아웃 입력 경로 — `role: "cases"`, `caseList` 답변 타입, `evaluation.holdout` (SPEC §3 원칙 7).
4. 홀드아웃 은닉 문구를 재정의된 위협 모델로 수정 — 은닉의 경계는 사용자가 아니라 루프.

---

## 1. 설계 원칙

1. **템플릿 추가 = 스키마 무변경.** 질문 목록은 템플릿 정의 파일이 선언하고, 답변은 `answers: {질문ID: 값}` 맵으로만 전달. 커뮤니티가 템플릿을 기여해도 이 계약은 그대로.
2. **평가 기준 승인(HITL 1지점)의 결과가 스키마의 심장.** v0.2부터 `evaluation` 블록 = **동결되는 판정 절차 전체** — 기준·루브릭만이 아니라 패널 구성·집계 규칙·pairwise 설정·홀드아웃 정책까지. "승인 후 불변"의 적용 범위가 곧 이 블록의 경계다.
3. **2단계 제출, 1개 스키마.** 같은 스키마를 두 번 보낸다:
   - 1차 제출: `evaluation: null` → 엔진이 평가 기준 후보 + **시험관 검증 리포트**를 제안 (응답 스키마는 별도 — §8)
   - 최종 제출: 사용자가 승인한 `evaluation` 포함 → 엔진이 루프 스펙 생성
4. **비개발자 퍼스트 타입 제약.** Lite에서 답변 타입은 `text / paste / choice / multiChoice / number / file / caseList`만. `code / regex / command`는 고급 모드 전용.
5. **버전 명시.** `schemaVersion`(semver) + 템플릿 버전 고정으로 저장된 프로젝트 호환성 보장.
6. **읽기는 자유, 쓰기는 기록.** 사용자의 쓰기(기준 수정, 홀드아웃 지정 등)만 provenance로 남는다. 열람은 기록 대상이 아니므로 이 스키마에 열람 관련 필드는 존재하지 않는다 (SPEC §3 원칙 7).

---

## 2. 최상위 구조

```json
{
  "schemaVersion": "0.2.0",
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
- **grounding 기준 의무 제안**: `origin: "generated"`인 프로젝트는 루프가 점수를 올리려고 재료에 없는 사실을 지어낼 위험이 있음 → 엔진은 "재료(material 답변)에 없는 경험·수치를 주장하지 않는가"를 채점하는 llm_judge 기준을 기본 포함해 제안해야 한다 (방어 세트의 조건부 기본 — SPEC §3 원칙 5).

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
| `caseList` (v0.2) | { id, label?, content }[] | 평가 케이스 목록 (기출문제 등). `role: "cases"` 질문 전용 |

고급 모드 전용: `code`, `regex`, `command`.

### `caseList` 상세
- `id`: 케이스 식별자. 프론트가 추가 순으로 발급(`"case-1"`, `"case-2"`, …)하며 **한 프로젝트 안에서 재사용·재부여하지 않는다** (홀드아웃 지정이 id를 참조하므로).
- 홀드아웃 지정 플래그는 여기 없다 — 지정은 `evaluation.holdout.cases`가 정본(5절). caseList는 케이스 본문만 나른다.
- 위저드 UX: 케이스를 목록으로 추가·편집, 승인 화면에서 홀드아웃 지정 토글(템플릿이 사용자 지정을 지원할 때만 노출).

### 검증 규칙
- 템플릿에 없는 질문 ID → 엔진이 거부 (400)
- `required` 누락 → 프론트 1차 차단 + 엔진 재검증
- `modes`에 현재 mode 미포함 질문의 답변 → 거부
- `role: "cases"` 질문의 답변이 `caseList`가 아니면 거부. caseList의 id 중복 → 거부

---

## 5. `evaluation` — 승인된 판정 절차 (HITL 1지점, 승인 후 불변)

1차 제출에 대한 엔진 응답으로 **기준 후보 + 시험관 검증 리포트**가 오고, 사용자가 리포트를 보고 승인·수정한 결과를 최종 제출에 담는다.

```json
"evaluation": {
  "status": "approved",
  "approvedAt": "2026-08-20T14:25:11+09:00",
  "examinerReport": { "id": "rep_9f2c81", "hash": "sha256:3aa1..." },
  "judge": {
    "panel": { "size": 3, "aggregation": "median" },
    "pairwise": { "enabled": true, "positionSwap": true, "verbosityPenalty": true }
  },
  "holdout": { "policy": "auto" },
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

### `examinerReport` — 시험관 검증 리포트 참조 (v0.2 신설)
- 1차 제출 응답으로 받은 검증 리포트(순서·변별력·안정성·꼼수 내성 — SPEC §4.1)의 참조. **본문은 응답 스키마 소관**(§8), 요청에는 `id` + `hash`만.
- 엔진은 hash가 이 criteria 세트에 대해 자신이 발급한 리포트와 일치하는지 검증. 불일치(기준을 고쳤는데 옛 리포트 참조) → 거부, 재검증 요구. **리포트 참조 없는 승인은 불가** — "리포트를 보고 채용"이 승인의 정의다.

### `judge` — 판정 절차 구성 (v0.2 신설)
- `panel`: llm_judge 기준이 하나라도 있으면 필수. `size` 1~5, `aggregation`: `"median"` / `"mean"` / `"majority"`. 패널은 동결된 판정 절차의 내부 구성 — 여럿이어도 되지만 루프 중에 변할 수 없다 (SPEC §3 원칙 4).
- `pairwise`: 채택/롤백 판정 설정 (SPEC §5.1.1 "채택은 pairwise, 서사는 스칼라"). `enabled`는 **llm_judge 포함일 때만 true 허용** — 결정적 채점기 전용 루프에서 true → 거부 (SPEC §3 원칙 5 단서). `positionSwap` 기본 true.

### `holdout` — 홀드아웃 정책 (v0.2 신설)
- `policy`: `"auto"`(기본 — 승인 후 엔진이 분할·생성) / `"user"`(사용자 지정 — 템플릿이 지원 선언한 경우만, SPEC §6 템플릿 규격).
- `policy: "user"`일 때 `cases: ["case-3", "case-7"]` — `role: "cases"` 답변의 케이스 id 참조. 존재하지 않는 id → 거부. 이 정책 값이 결과 카드의 홀드아웃 provenance(자동 분할 vs 사용자 지정) 표기의 원천.
- **홀드아웃 케이스 본문의 위치**: `auto`면 이 스키마에 없다(승인 이후 엔진이 생성하는 출력). `user`면 caseList 안에 본문이 있고 여기서는 참조만 한다.
- **은닉의 경계는 사용자가 아니라 루프다** (SPEC §3 원칙 7). 불변식은 "홀드아웃은 Generator/Critic 컨텍스트에 절대 포함되지 않는다"이며 이는 출력(루프 스펙) 소관. 사용자 열람은 자유·비기록 — 기본 UI가 실행 전에 표시하지 않는 것은 연출이지 보안 경계가 아니다. 홀드아웃 쓰기의 회계(케이스 수정·가시 세트 이동 시 재분할/배지 반납)도 루프 스펙 명세 소관.

### 공통 규칙
- `kind`: `"deterministic"`(채점기 라이브러리의 scorer 호출) / `"llm_judge"`(고정 루브릭, 동결)
- `weight`: 합계 1.0 (엔진 검증)
- `provenance`: `"suggested"`(제안 그대로) / `"modified"`(수정) / `"added"`(사용자 추가) — 대시보드·연구용 기록
- **승인 후 `evaluation` 블록 전체가 불변** (criteria만이 아니라 judge·holdout 포함). 수정하려면 재승인 = 새 `approvedAt` + **새 examinerReport** (기준이 바뀌면 시험관 검증도 다시 통과해야 한다).

---

## 6. `loop` — 실행 설정

```json
"loop": {
  "maxIterations": 30,
  "llmRoute": "trial",
  "branching": { "width": 1 },
  "critic": true,
  "stop": { "targetScore": null, "plateauRounds": 8 }
}
```

- `llmRoute`: `"trial"`(무료 체험 — 서버 프록시, 쿼터·반복 상한은 서버가 강제) / `"byok"`(사용자 키, 브라우저 직행). 티어 차이는 모델·쿼터뿐, 하네스 차등 없음 (SPEC §12 미결 2 원칙).
- `maxIterations`: trial일 때 서버 상한 이하로 클램프 (정책 수치는 무료 티어 정책 문서에서 확정)
- `branching.width`: 라운드당 병렬 변이 수 (Generator 에이전트 수). trial은 1로 서버 강제, byok는 1~4
- `critic`: plateau 시 Critic 에이전트(채점 내역 진단 → 변이 방향 제시) 활성화 여부
- `stop.plateauRounds`: N회 연속 개선 없으면 조기 종료
- **여기 없는 것들**: 원샷 베이스라인(라운드 0)은 설정이 아니라 모든 루프의 상수라 필드가 없다 (SPEC §3 원칙 6). 패널·pairwise는 동결 대상이므로 `evaluation.judge` 소관 — loop에 두지 않는다.

---

## 7. 전체 예시

### 7.1 자소서 매칭 최종 제출 (holdout auto)

```json
{
  "schemaVersion": "0.2.0",
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
    "examinerReport": { "id": "rep_9f2c81", "hash": "sha256:3aa1..." },
    "judge": {
      "panel": { "size": 3, "aggregation": "median" },
      "pairwise": { "enabled": true, "positionSwap": true, "verbosityPenalty": true }
    },
    "holdout": { "policy": "auto" },
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
    "maxIterations": 30,
    "llmRoute": "trial",
    "stop": { "targetScore": null, "plateauRounds": 8 }
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
      { "id": "case-1", "label": "2024 중간 3번", "content": "페이지 교체 알고리즘 LRU와 ..." },
      { "id": "case-2", "label": "2024 기말 1번", "content": "세마포어와 뮤텍스의 차이를 ..." },
      { "id": "case-3", "label": "2025 중간 2번", "content": "가상 메모리에서 TLB 미스가 ..." }
    ]
  }
},
"evaluation": {
  "...": "...",
  "holdout": { "policy": "user", "cases": ["case-3"] }
}
```

(템플릿 정의에서 `past_exams`는 `role: "cases"`. case-1, case-2는 루프가 보는 가시 케이스, case-3은 홀드아웃 — 승인 시점에 동결되고 Generator/Critic 컨텍스트에서 배제된다.)

---

## 8. 미결 (팀 논의 필요)

1. `file`·`caseList` 답변의 크기 상한과 서버 저장 여부 (BYO 경로 프라이버시 원칙과 충돌 주의)
2. 결정적 scorer 이름 레지스트리 (`keyword_coverage`, `length_within`, `constraint_check` …) — 채점기 라이브러리 패키지와 이름 공유
3. 고급 모드 `artifact.type: "files"`의 상세 구조 — zip 출력 명세와 함께 확정
4. 1차 제출 → 응답의 스키마 (이 문서는 요청만 다룸) — 기준 후보 + **시험관 검증 리포트 본문**(검사 항목별 결과, 사용된 프로브의 출처) 포함. examinerReport hash 산출 규칙도 여기서 정의
5. 재제출(기준 수정 → 재승인) 시 caseList 케이스 id의 안정성 규칙 — 케이스 편집이 id를 바꾸는가
