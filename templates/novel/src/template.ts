/** 노벨 인터뷰 답변 → 문제 + Evaluation Pack + 루프 사양 컴파일. */

import type {
  EvaluationPack,
  InterviewSubmission,
  JudgeProvider,
  LoopSpec,
  Question,
} from "@harnest/contracts";
import { digestScope, sha256Canonical } from "@harnest/contracts";
import { NOVEL_SOURCE_ACCEPT } from "./source";
import type { NovelCanon } from "./types";

export const TEMPLATE_ID = "novel";
export const TEMPLATE_NAME = "소설 창작";
export const NOVEL_RUBRIC_VERSION = "novel-rubric-v0";
export const TARGET_LENGTH_MIN = 3_000;
export const TARGET_LENGTH_MAX = 30_000;
export const TARGET_LENGTH_DEFAULT = 10_000;
export const MAX_CALLS_PER_RUN = 50;

export interface NovelProbe {
  id: string;
  question: string;
  expectedAnswer: string;
  claimId: string;
}

export interface NovelProblem {
  canon: NovelCanon;
  creativeDirection: string;
  targetLength: number;
  hardLengthCap: number;
  visibleProbes: NovelProbe[];
  guardProbes: NovelProbe[];
  holdoutProbes: NovelProbe[];
}

export interface NovelChapter {
  id: string;
  title: string;
  content: string;
}

export interface NovelArtifact {
  title: string;
  chapters: NovelChapter[];
  revisionSummary: string;
}

export interface CompiledNovel {
  problem: NovelProblem;
  pack: EvaluationPack;
  loopSpec: LoopSpec;
  notices: string[];
}

export const questions: Question[] = [
  {
    id: "sources",
    role: "material",
    type: "sourceDocuments",
    label: "작성해 둔 이야기 자료를 올려주세요.",
    shortLabel: "자료 첨부",
    help:
      "설정집, 시놉시스, 인물 노트나 기존 초고를 올리세요. 파일은 브라우저에서만 읽고, 분석을 시작할 때 선택한 AI 벤더로 원문 조각을 보냅니다.",
    nextLabel: "창작 방향 정하기",
    min: 1,
    max: 12,
    required: true,
    accept: NOVEL_SOURCE_ACCEPT,
  },
  {
    id: "creativeDirection",
    role: "constraints",
    type: "textarea",
    label: "이 작품에서 반드시 지키고 싶은 중심은 무엇인가요?",
    shortLabel: "창작 의도",
    help:
      "예: 서로 불신하던 두 인물이 생존을 위해 협력하면서도 쉽게 화해하지 않는 이야기. 결말은 희망적이되 모든 상처가 해결되지는 않아야 합니다.",
    nextLabel: "분량 정하기",
    placeholder: "작품의 중심 갈등, 인물 변화, 원하는 결말과 피하고 싶은 전개를 적어주세요.",
    maxChars: 6_000,
    required: true,
  },
  {
    id: "targetLength",
    role: "criteria",
    type: "number",
    label: "완성 원고의 목표 분량을 정해주세요.",
    shortLabel: "목표 분량",
    help: `첫 버전은 ${TARGET_LENGTH_MIN.toLocaleString()}~${TARGET_LENGTH_MAX.toLocaleString()}자를 지원합니다. 목표의 125%를 넘는 후보는 채택하지 않습니다.`,
    nextLabel: "분석·채점 모델 고르기",
    min: TARGET_LENGTH_MIN,
    max: TARGET_LENGTH_MAX,
    defaultValue: TARGET_LENGTH_DEFAULT,
  },
  {
    id: "judgeModel",
    role: "criteria",
    type: "judgeModel",
    label: "어떤 AI가 자료를 분석하고 소설을 만들까요?",
    shortLabel: "AI 모델",
    nextLabel: "자료 분석 시작",
    help: "자료 분석, 원고 생성과 채점을 같은 연결로 수행합니다. 승인 뒤 모델을 바꾸면 다시 승인해야 합니다.",
  },
];

function stableValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function claimProbe(claim: NovelCanon["claims"][number]): NovelProbe {
  return {
    id: `probe-${claim.id}`,
    claimId: claim.id,
    question:
      `원고는 '${claim.predicate}' 설정을 어떻게 드러내며, 다음 정본과 모순되는 대목이 있는가? ` +
      "근거가 되는 원고 대목을 짧게 인용해 답하라.",
    expectedAnswer: stableValue(claim.value),
  };
}

function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const target = Math.floor(next() * (index + 1));
    [out[index], out[target]] = [out[target], out[index]];
  }
  return out;
}

export async function compile(
  submission: InterviewSubmission,
  options: { judgeProvider: JudgeProvider; judgeModel: string },
): Promise<CompiledNovel> {
  const canon = submission.answers.canon as NovelCanon | undefined;
  if (!canon || canon.schemaVersion !== "novel-canon-v0") {
    throw new Error("자료 분석과 설정 확인을 먼저 완료해 주세요.");
  }
  const creativeDirection = String(submission.answers.creativeDirection ?? "").trim();
  if (creativeDirection.length === 0) throw new Error("창작 의도를 입력해 주세요.");
  const targetLength = Number(submission.answers.targetLength ?? TARGET_LENGTH_DEFAULT);
  if (
    !Number.isInteger(targetLength) ||
    targetLength < TARGET_LENGTH_MIN ||
    targetLength > TARGET_LENGTH_MAX
  ) {
    throw new Error(
      `목표 분량은 ${TARGET_LENGTH_MIN.toLocaleString()}~${TARGET_LENGTH_MAX.toLocaleString()}자여야 합니다.`,
    );
  }
  const hardLengthCap = Math.floor(targetLength * 1.25);
  const usableClaims = canon.claims.filter(
    (claim) => claim.reviewState !== "rejected" && claim.truthScope !== "unresolved",
  );
  const seed = parseInt(canon.canonDigest.slice(0, 8), 16);
  const probes = seededShuffle(usableClaims.map(claimProbe), seed);
  let visibleProbes = probes;
  let guardProbes: NovelProbe[] = [];
  let holdoutProbes: NovelProbe[] = [];
  if (probes.length >= 5) {
    const holdoutCount = Math.max(1, Math.floor(probes.length * 0.2));
    const guardCount = Math.max(1, Math.floor(probes.length * 0.3));
    holdoutProbes = probes.slice(0, holdoutCount);
    guardProbes = probes.slice(holdoutCount, holdoutCount + guardCount);
    visibleProbes = probes.slice(holdoutCount + guardCount);
  }
  const guardTolerance = guardProbes.length === 0
    ? 0
    : Math.round((100 / (2 * guardProbes.length)) * 10) / 10;

  const problem: NovelProblem = {
    canon,
    creativeDirection,
    targetLength,
    hardLengthCap,
    visibleProbes,
    guardProbes,
    holdoutProbes,
  };
  const base: Omit<EvaluationPack, "definitionDigest"> = {
    packVersion: "skeleton-1",
    templateId: TEMPLATE_ID,
    criteria: [
      { id: "character_depth", kind: "case_answering", scorer: NOVEL_RUBRIC_VERSION, params: { canonDigest: canon.canonDigest }, weight: 0.25, label: "인물 입체성" },
      { id: "continuity", kind: "case_answering", scorer: NOVEL_RUBRIC_VERSION, params: { canonDigest: canon.canonDigest, visibleProbes: visibleProbes.length }, weight: 0.25, label: "설정·시간선 정합성" },
      { id: "causality", kind: "case_answering", scorer: NOVEL_RUBRIC_VERSION, params: { canonDigest: canon.canonDigest }, weight: 0.2, label: "사건 인과성" },
      { id: "scene_function", kind: "case_answering", scorer: NOVEL_RUBRIC_VERSION, params: { canonDigest: canon.canonDigest }, weight: 0.15, label: "장면 기능" },
      { id: "voice", kind: "case_answering", scorer: NOVEL_RUBRIC_VERSION, params: { canonDigest: canon.canonDigest }, weight: 0.15, label: "문체·시점 유지" },
    ],
    gates: [
      {
        id: "novel_structure_and_length",
        kind: "deterministic",
        scorer: "novel_structure_length_v0",
        params: { targetChars: targetLength, maxChars: hardLengthCap },
        effect: "reject",
        label: `장 누락·중복 없이 최대 ${hardLengthCap.toLocaleString()}자 이하`,
      },
    ],
    judgeProcedure: {
      kind: "case_answering",
      judge: { provider: options.judgeProvider, model: options.judgeModel },
      pairwiseNotice:
        "구조 조건과 중간 점검을 통과하고, 인물·정합성·인과성·장면·문체 종합 점수가 현재 원고보다 높아야 합니다.",
    },
    holdoutPolicy: guardProbes.length === 0
      ? {
          mode: "none",
          note: "확정된 정본 명제가 5개 미만이라 질문 분할을 적용하지 않습니다. 결과에서 이 한계를 표시합니다.",
        }
      : {
          mode: "seeded_split",
          note:
            "정본 명제를 개선용·중간 점검용·최종 확인용 질문으로 시드 고정 분할합니다. 비공개 질문의 세부 내용은 생성기에 전달하지 않습니다.",
          guardCaseIds: guardProbes.map((probe) => probe.id),
          holdoutCaseIds: holdoutProbes.map((probe) => probe.id),
          guardTolerance,
        },
  };
  const definitionDigest = await sha256Canonical(digestScope(base));
  const pack: EvaluationPack = { ...base, definitionDigest };
  const loopSpec: LoopSpec = {
    maxRounds: 4,
    plateauRounds: 2,
    adoptionRule: "scalar_strict",
    feedbackMode: "recent_public_experiments_v1",
    seed: parseInt(definitionDigest.slice(0, 8), 16),
  };
  const notices = [
    "첫 버전은 한 번에 한 장을 국소 수정합니다. 장편 전체의 문맥 한계를 완전히 해결했다고 보장하지 않습니다.",
    ...(guardProbes.length === 0
      ? ["확정된 정본 명제가 부족해 중간 점검과 최종 확인 질문을 분리하지 못했습니다."]
      : []),
  ];
  return { problem, pack, loopSpec, notices };
}
