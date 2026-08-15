# Harnest 인터뷰 JSON 스키마 v0.1 (초안)

> 프론트(인터뷰 위저드) ↔ 생성 엔진 사이의 **입력 계약**.
> 생성물(루프 스펙, zip 구조)은 별도 문서(출력 명세)로 다룬다 — 이 문서와 섞지 않는다.

---

## 1. 설계 원칙

1. **템플릿 추가 = 스키마 무변경.** 질문 목록은 템플릿 정의 파일이 선언하고, 답변은 `answers: {질문ID: 값}` 맵으로만 전달. 커뮤니티가 템플릿을 기여해도 이 계약은 그대로.
2. **평가 기준 승인(HITL 1지점)의 결과가 스키마의 심장.** `evaluation` 블록이 곧 "불가침 평가자"의 원본.
3. **2단계 제출, 1개 스키마.** 같은 스키마를 두 번 보낸다:
   - 1차 제출: `evaluation: null` → 엔진이 평가 기준 후보를 제안
   - 최종 제출: 사용자가 승인한 `evaluation` 포함 → 엔진이 루프 스펙 생성
4. **비개발자 퍼스트 타입 제약.** Lite에서 답변 타입은 `text / paste / choice / multiChoice / number / file`만. `code / regex / command`는 고급 모드 전용.
5. **버전 명시.** `schemaVersion`(semver) + 템플릿 버전 고정으로 저장된 프로젝트 호환성 보장.

---

## 2. 최상위 구조

```json
{
  "schemaVersion": "0.1.0",
  "projectId": null,
  "template": { "id": "resume-match", "version": "1.0.0" },
  "mode": "lite",
  "goal": "카카오 서버 개발자 공고에 맞게 내 자소서를 개선하고 싶다",
  "artifact": { },
  "answers": { },
  "evaluation": null,
  "loop": { },
  "client": { "locale": "ko", "submittedAt": "2026-08-13T14:20:00+09:00" }
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
| `evaluation` | object \| null | 평가 기준 승인 결과 (5절). 1차 제출 시 null |
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
- **grounding 기준 의무 제안**: `origin: "generated"`인 프로젝트는 루프가 점수를 올리려고 재료에 없는 사실을 지어낼 위험이 있음 → 엔진은 "재료(material 답변)에 없는 경험·수치를 주장하지 않는가"를 채점하는 llm_judge 기준을 기본 포함해 제안해야 한다 (reward hacking 방어의 일부).

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

- `role`: `"context"`(기본 — 생성·채점 참고 정보) / `"material"`(산출물의 원재료 — 시드 생성 + grounding 기준의 대조 근거로 사용)

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

고급 모드 전용: `code`, `regex`, `command`.

### 검증 규칙
- 템플릿에 없는 질문 ID → 엔진이 거부 (400)
- `required` 누락 → 프론트 1차 차단 + 엔진 재검증
- `modes`에 현재 mode 미포함 질문의 답변 → 거부

---

## 5. `evaluation` — 평가 기준 승인 결과 (HITL 1지점)

1차 제출에 대한 엔진 응답으로 기준 후보가 오고, 사용자가 승인·수정한 결과를 최종 제출에 담는다.

```json
"evaluation": {
  "status": "approved",
  "approvedAt": "2026-08-13T14:25:11+09:00",
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

- `kind`: `"deterministic"`(채점기 라이브러리의 scorer 호출) / `"llm_judge"`(고정 루브릭, 동결)
- `weight`: 합계 1.0 (엔진 검증)
- `provenance`: `"suggested"`(제안 그대로) / `"modified"`(수정) / `"added"`(사용자 추가) — 대시보드·연구용 기록
- **홀드아웃 케이스는 이 스키마에 없다.** 승인 이후 엔진이 생성하는 **출력**이며, 사용자에게 실행 전 노출되지 않는다 (judge hacking 방어). 출력 명세 문서 소관.
- 승인 후 `criteria`는 불변. 수정하려면 재승인 = 새 `approvedAt`.

---

## 6. `loop` — 실행 설정

```json
"loop": {
  "maxIterations": 30,
  "llmRoute": "trial",
  "stop": { "targetScore": null, "plateauRounds": 8 }
}
```

- `llmRoute`: `"trial"`(무료 체험 — 서버 프록시, 쿼터·반복 상한은 서버가 강제) / `"byok"`(사용자 키, 브라우저 직행)
- `maxIterations`: trial일 때 서버 상한 이하로 클램프 (정책 수치는 무료 티어 정책 문서에서 확정)
- `stop.plateauRounds`: N회 연속 개선 없으면 조기 종료

---

## 7. 전체 예시 — 자소서 매칭 최종 제출

```json
{
  "schemaVersion": "0.1.0",
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
    "approvedAt": "2026-08-13T14:25:11+09:00",
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
  "client": { "locale": "ko", "submittedAt": "2026-08-13T14:26:02+09:00" }
}
```

---

## 8. 미결 (팀 논의 필요)

1. `file` 답변의 크기 상한과 서버 저장 여부 (BYO 경로 프라이버시 원칙과 충돌 주의)
2. 결정적 scorer 이름 레지스트리 (`keyword_coverage`, `length_within`, `constraint_check` …) — 채점기 라이브러리 패키지와 이름 공유
3. 고급 모드 `artifact.type: "files"`의 상세 구조 — zip 출력 명세와 함께 확정
4. 1차 제출 → 기준 제안 응답의 스키마 (이 문서는 요청만 다룸; 응답 스키마 별도 정의 필요)