import type {
  BlueprintItem,
  Criteria,
  ExperimentNode,
  TemplateDefinition,
} from "./types";

export const templates: TemplateDefinition[] = [
  {
    id: "resume-match",
    name: "자기소개서 매칭",
    status: "active",
    description: "채용공고와 자기소개서를 비교해 직무 적합도가 올라가도록 개선합니다.",
    evaluation: "키워드 커버리지 + 고정 루브릭 + 글자 수 제한",
  },
  {
    id: "schedule-builder",
    name: "시간표/근무표 짜기",
    status: "soon",
    description: "제약 위반 개수를 줄이며 가능한 배치를 찾습니다.",
    evaluation: "제약 위반 수 기반 결정적 채점",
  },
  {
    id: "prompt-tuning",
    name: "프롬프트 최적화",
    status: "soon",
    description: "개발자 고급 모드용 프롬프트 개선 루프입니다.",
    evaluation: "테스트 케이스 기반 점수 비교",
  },
];

export const blueprintItems: BlueprintItem[] = [
  {
    label: "목표",
    value: "카카오 서버 개발자 공고에 맞게 자기소개서를 개선",
    state: "ready",
  },
  {
    label: "수정 대상",
    value: "자기소개서 초안 1개",
    state: "draft",
  },
  {
    label: "평가 울타리",
    value: "승인 전",
    state: "empty",
  },
  {
    label: "반복 설정",
    value: "최대 30회, 무료 체험 경로",
    state: "ready",
  },
];

export const criteria: Criteria[] = [
  {
    id: "keyword-coverage",
    title: "공고 핵심어 반영",
    kind: "deterministic",
    weight: 0.4,
    description: "채용공고의 핵심 요구사항이 산출물에 충분히 반영되는지 확인합니다.",
    locked: true,
  },
  {
    id: "jd-fit-rubric",
    title: "직무 적합도 루브릭",
    kind: "llm_judge",
    weight: 0.5,
    description: "경험이 직무 요구사항과 구체적으로 연결되는지 고정 기준으로 판단합니다.",
    locked: true,
  },
  {
    id: "length-limit",
    title: "글자 수 제한",
    kind: "deterministic",
    weight: 0.1,
    description: "사용자가 입력한 제한을 넘지 않는지 확인합니다.",
    locked: true,
  },
];

export const experimentNodes: ExperimentNode[] = [
  {
    id: "seed",
    round: 0,
    title: "초기 초안",
    score: 62,
    status: "accepted",
    note: "기준선으로 저장됨",
  },
  {
    id: "r1-a",
    round: 1,
    title: "직무 키워드 보강",
    score: 71,
    status: "accepted",
    note: "Spring, MSA 경험을 공고 문맥에 맞춰 재배치",
  },
  {
    id: "r2-a",
    round: 2,
    title: "일반론 제거",
    score: 78,
    status: "accepted",
    note: "추상적인 문장을 프로젝트 성과 중심으로 교체",
  },
  {
    id: "r2-b",
    round: 2,
    title: "톤 확장 후보",
    score: 70,
    status: "rejected",
    note: "글자 수 제한과 간결성 기준에서 감점",
  },
];
