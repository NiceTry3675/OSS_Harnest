/** 템플릿 등록소 — "폴더 하나 = 템플릿 하나"의 웹 어댑터.
 *  페이지는 이 인터페이스만 알고, 템플릿별 분기 코드를 갖지 않는다(SPEC §6 경계 원칙:
 *  템플릿마다 엔진에 분기가 생기면 경고). */

import type { ComponentType } from "react";
import type {
  ExaminerCheckResult,
  ExaminerReport,
  ExperimentStrategy,
  InterviewSubmission,
  JudgeProvider,
  Question,
  ScoreResult,
} from "@harnest/contracts";
import type { GeneratorFeedback } from "@harnest/loop-engine";
import * as timetable from "@harnest/template-timetable";
import * as handover from "@harnest/template-handover";
import type { CompiledGeneric, HoldoutEvaluation } from "./state";
import type { LlmClient } from "@harnest/template-handover";
import { DEV_SAMPLES } from "./lib/devSamples";
import type { PlanTemplateChoice } from "./lib/templatePlan";
import { buildFlowSteps, type TemplateFlow } from "./lib/flowStep";
import { TimetableGrid } from "./components/TimetableGrid";
import { HandoverDocView } from "./components/HandoverDocView";
import {
  createByoClient,
  createMockClient,
  createSharedGeminiClient,
  createSharedOpenAIClient,
  getByoCredential,
  hasSharedKey,
  PROVIDER_LABEL,
} from "./lib/llm";

export interface TemplateRuntime {
  scorer: (artifact: unknown) => ScoreResult | Promise<ScoreResult>;
  planStrategy?: (
    champion: unknown,
    rng: () => number,
    feedback: GeneratorFeedback,
  ) => ExperimentStrategy | Promise<ExperimentStrategy>;
  generate: (
    champion: unknown,
    rng: () => number,
    feedback: GeneratorFeedback,
    strategy?: ExperimentStrategy,
  ) => unknown | Promise<unknown>;
  initial: (rng: () => number) => unknown | Promise<unknown>;
  /** 라운드 0과 종료 시에만 호출할 것 — 결과는 루프 판단에 유입 금지(SPEC §3 원칙 7) */
  scoreHoldout: ((artifact: unknown) => Promise<HoldoutEvaluation>) | null;
  callsPerRound: number;
  /** 실행 1회의 모델 호출 예산 — 0이면 예산 없음(결정적 템플릿). 초과 시
   *  CallBudgetExceededError로 실행이 중단된다(SPEC §5.2, 체크포인트는 보존). */
  maxCallsPerRun: number;
  roundDelayMs: number;
}

export interface TemplateEntry {
  id: string;
  name: string;
  description: string;
  badge?: string;
  /** 0단계 빌더가 임의의 목표에 붙일 수 있는 절차인지.
   *  입력 모양이 고정된 절차(예: 근무자 명단을 받는 시간표)는 아무 목표에나 얹을 수 없다. */
  fitsAnyGoal?: boolean;
  /** 이 절차가 무엇을 어떻게 재는지, **절차 이름을 쓰지 않고** 설명한 문장.
   *  0단계 밑줄에 그대로 걸리고, 빌더가 모델에게 넘기는 설명도 이것을 쓴다.
   *  이름("인수인계·온보딩 문서")을 넘기면 모델이 그 어휘로 끌려간다 —
   *  플레이리스트를 만드는 목표에 "음악 추천 인수인계 템플릿"이 나온다. */
  builderSummary?: string;
  /** 0단계 빌더가 모델에게 넘길, 각 칸이 하는 일. FlowStep.id로 건다.
   *  이 절차가 지금 쓰는 이름은 넘기지 않는다 — 넘기면 모델이 그대로 베껴,
   *  목표가 회사 업무가 아닐 때도 "업무 소개" 같은 이름이 나온다. */
  builderStagePurpose?: Record<string, string>;
  /** true면 BYO 키 또는 모의 모델 선택이 필요(저지 모델은 승인 전에 확정 — SPEC §8) */
  needsModel: boolean;
  questions: Question[];
  /** 질문 뒤 승인 전·후, 실행, 결과 단계의 템플릿별 표시 문구. */
  flow: TemplateFlow;
  compile(
    submission: InterviewSubmission,
    judge: { provider: JudgeProvider; model: string },
  ): Promise<CompiledGeneric>;
  /** 승인·동결된 팩의 저지 선언에 맞는 클라이언트 구성 — 불일치면 throw(재승인 원칙) */
  createLlm(compiled: CompiledGeneric): LlmClient | null;
  createRuntime(compiled: CompiledGeneric, llm: LlmClient | null): TemplateRuntime;
  /** llm_judge 포함 템플릿의 승인 전 요건 — 검증 배터리(SPEC §3 원칙 2).
   *  결정적 전용 템플릿은 undefined(SPEC §10 면제). */
  examiner?: {
    runBattery(
      compiled: CompiledGeneric,
      llm: LlmClient,
      onProgress?: (message: string) => void,
      /** 검사 하나가 끝날 때마다 — 화면이 결과를 기다리지 않고 바로 표시한다 */
      onCheck?: (check: ExaminerCheckResult) => void,
    ): Promise<ExaminerReport>;
  };
  /** 인터뷰 단계 케이스 초안 보조(선택) — caseList 질문에서만 노출된다.
   *  클릭당 본 호출 1회 + 형식 재시도 1회로 템플릿 상수가 상한하며 실행 예산 밖이다(SPEC §5.2).
   *  초안은 사용자가 확인해야만 제출에 포함된다 — 강제는 위저드 검증·수집이 담당. */
  caseAssist?: {
    /** 초안 버튼 옆 안내 문구 — 템플릿이 소유한다 */
    nudge: string;
    /** 난이도 슬라이더 선언(선택) — 값의 의미(교차 사실 수 등)는 템플릿이 소유하고,
     *  위저드는 선언된 범위의 숫자를 draft에 전달만 한다. */
    difficulty?: {
      label: string;
      min: number;
      max: number;
      defaultValue: number;
      /** 슬라이더 배지 문구 — 값의 템플릿별 의미를 사용자에게 설명한다 */
      describe(value: number): string;
      hint: string;
    };
    draft(
      material: string,
      existing: Array<{ question: string; expectedAnswer: string }>,
      count: number,
      llm: LlmClient,
      difficulty?: number,
      /** 0단계에서 정한 확인 방향 — 초안을 그쪽으로 뽑는다 */
      focus?: readonly string[],
    ): Promise<
      Array<{
        question: string;
        expectedAnswer: string;
        /** 근거 인용(멀티홉 초안) — 확인 UI 표시 전용, 제출에 실리지 않는다 */
        evidence?: Array<{ quote: string; found: boolean }>;
      }>
    >;
  };
  ArtifactView: ComponentType<{ problem: unknown; artifact: unknown }>;
  /** 산출물을 사람이 바로 여는 파일로 — 결과 화면의 내려받기 버튼이 쓴다.
   *  JSON 내보내기(기록 전체)와 달리 산출물 하나만 담는다. */
  exportArtifact?(
    problem: unknown,
    artifact: unknown,
  ): { filename: string; mime: string; text: string };
  /** 개발용 예시 답변(선택) — 개발 서버에서만 노출된다. 프로덕션 빌드에서는 제거된다. */
  devSample?: Record<string, unknown>;
}

const timetableEntry: TemplateEntry = {
  id: timetable.TEMPLATE_ID,
  name: timetable.TEMPLATE_NAME,
  description:
    "근무자 명단과 원칙만 알려주세요. 연속 근무 한도·주당 상한·배정 형평을 당신이 승인한 기준으로 채점하며, 통과할 때까지 근무표를 스스로 다듬습니다.",
  badge: "개발용 테스트 템플릿",
  fitsAnyGoal: false,
  needsModel: false,
  questions: timetable.questions,
  flow: {
    approval: { pending: "평가 구성 승인", approved: "기준 확정" },
    run: "실행",
    result: "결과",
  },
  compile: (submission) => timetable.compile(submission),
  createLlm: () => null,
  createRuntime(compiled) {
    const problem = compiled.problem as timetable.TimetableProblem;
    return {
      scorer: (a) => timetable.score(problem, a as timetable.Timetable),
      generate: (champ, rng) => timetable.mutate(problem, champ as timetable.Timetable, rng),
      initial: (rng) => timetable.initialTimetable(problem, rng),
      scoreHoldout: null,
      callsPerRound: 0,
      maxCallsPerRun: 0,
      roundDelayMs: 120,
    };
  },
  devSample: import.meta.env.DEV ? DEV_SAMPLES[timetable.TEMPLATE_ID] : undefined,
  exportArtifact: (problem, artifact) => {
    const p = problem as timetable.TimetableProblem;
    const t = artifact as timetable.Timetable;
    const rows = t.map((day, i) =>
      [`${i + 1}일차`, ...day.map((who) => (who === null ? "" : p.staff[who]))].join(","),
    );
    return {
      filename: "근무표.csv",
      mime: "text/csv;charset=utf-8",
      text: ["일자,근무1,근무2", ...rows].join("\n"),
    };
  },
  ArtifactView: ({ problem, artifact }) => (
    <TimetableGrid
      problem={problem as timetable.TimetableProblem}
      timetable={artifact as timetable.Timetable}
    />
  ),
};

const handoverEntry: TemplateEntry = {
  id: handover.TEMPLATE_ID,
  name: handover.TEMPLATE_NAME,
  // 질문·답으로 재는 절차라 목표가 무엇이든 붙는다
  fitsAnyGoal: true,
  builderSummary:
    "결과물은 글로 된 문서입니다. 그 문서만 읽은 AI가 사용자가 미리 준 확인 질문들에 실제로 답해보게 해서 채점합니다. 답이 맞을수록, 정한 분량 안에서 짧을수록 높은 점수입니다.",
  builderStagePurpose: {
    "question:material":
      "AI가 결과물을 만들 때 근거로 삼을 자료를 사용자에게서 받는 칸. 긴 자유 서술과 파일 첨부를 받는다. 사용자가 이미 알고 있는 것을 꺼내게 하는 칸이다.",
    "question:cases":
      "결과물이 제대로 됐는지 확인할 질문과, 사용자가 이미 아는 답을 쌍으로 받는 칸. 나중에 이 질문들을 결과물만 읽은 AI에게 던져 채점한다.",
    "question:lengthCap":
      "결과물의 분량 상한과, 같은 내용이면 짧을수록 점수를 줄지를 받는 칸.",
    "question:judgeModel": "채점을 맡을 AI 모델을 고르는 칸.",
    "approval:pending": "기준을 잠그기 전에 사용자가 검토하는 칸.",
    "approval:approved": "기준이 잠긴 칸. 이후 바꾸려면 다시 승인해야 한다.",
    run: "잠긴 기준으로 결과물을 반복해서 고쳐 올리는 칸.",
    result: "최종 결과물과 점수 변화를 보는 칸.",
  },
  description:
    "실제로 받았던 질문과 그때의 답을 넣으세요. 문서만 읽은 AI가 그 질문들에 실제로 답해보는 방식으로 채점하며, 당신이 정한 분량 안에서 커버리지를 넓혀 갑니다.",
  needsModel: true,
  questions: handover.questions,
  flow: {
    approval: { pending: "사전 점검·승인", approved: "기준 확정" },
    run: "실행",
    result: "결과",
  },
  compile: (submission, judge) =>
    handover.compile(submission, { judgeProvider: judge.provider, judgeModel: judge.model }),
  createLlm(compiled) {
    const jp = compiled.pack.judgeProcedure;
    if (jp.kind !== "case_answering") return null;
    if (jp.judge.provider === "mock") {
      return createMockClient(compiled.problem as handover.HandoverProblem);
    }
    const provider = jp.judge.provider;
    const credential = getByoCredential(provider);
    if (credential) {
      return createByoClient(provider, credential, jp.judge.model);
    }
    // BYO 키가 없으면 관리자가 서버에 둔 공유 키로 대체한다(있을 때만).
    // 이 경로는 요청이 Harnest 서버(/proxy/*)를 거친다 — README·SPEC의 공유 키 절 참고.
    if ((provider === "openai" || provider === "gemini") && hasSharedKey(provider)) {
      return provider === "openai"
        ? createSharedOpenAIClient(jp.judge.model)
        : createSharedGeminiClient(jp.judge.model);
    }
    throw new Error(
      `승인된 AI 모델(${PROVIDER_LABEL[provider]})의 연결 정보가 없습니다 — 연결 정보를 입력하거나, 평가 구성을 다시 만들어 모의 모델로 승인하세요.`,
    );
  },
  caseAssist: {
    nudge:
      "AI 초안은 참고 자료에 이미 있는 내용만 재구성합니다. 자료에 없는 지식 — 구두로만 전해지던 규칙, 예외 상황 — 을 직접 추가할수록 검증이 강해집니다.",
    // 실측(experiments/multihop-01): 교차 2 + 단일 답 강제가 무문서 정답률을 낮춘다(0.43→0.30)
    difficulty: {
      label: "난이도 (교차 사실 수)",
      min: 1,
      max: 3,
      defaultValue: 2,
      describe: (value) => (value === 1 ? "사실 1개 · 회수형" : `사실 ${value}개 교차`),
      hint: "2 이상이면 자료의 서로 다른 위치에 있는 사실들을 종합해야만 답할 수 있는 질문을 요구하고, 근거 인용을 초안 카드에 표시합니다.",
    },
    draft: (material, existing, count, llm, difficulty, focus) =>
      handover.draftCases(llm, material, existing, count, difficulty, focus),
  },
  examiner: {
    runBattery: (compiled, llm, onProgress, onCheck) =>
      handover.runExaminerBattery(
        compiled.problem as handover.HandoverProblem,
        compiled.pack,
        llm,
        onProgress,
        onCheck,
      ),
  },
  createRuntime(compiled, llm) {
    if (!llm) throw new Error("AI 모델이 준비되지 않았습니다 — 연결 정보를 입력하거나 모의 모델을 선택하세요.");
    const jp = compiled.pack.judgeProcedure;
    if (
      jp.kind === "case_answering" &&
      (jp.judge.provider !== llm.providerId ||
        (jp.judge.provider !== "mock" && jp.judge.model !== llm.model))
    ) {
      // 승인 시 동결된 저지와 실행 모델이 다르면 실행 불가 — 재승인 원칙(SPEC §8)
      throw new Error(
        `승인된 AI 모델(${jp.judge.provider}/${jp.judge.model})을 사용할 수 없습니다 — 평가 구성을 다시 만들어 승인해 주세요.`,
      );
    }
    const problem = compiled.problem as handover.HandoverProblem;
    // 실행 1회 예산은 런타임 인스턴스 단위로 계수한다 — 라운드 0·루프·홀드아웃이 모두 포함된다
    const budgeted = handover.withCallBudget(llm, handover.MAX_CALLS_PER_RUN);
    const scorer = handover.createScorer(problem, budgeted);
    const planStrategy = handover.createStrategyPlanner(problem, budgeted);
    const generate = handover.createGenerator(problem, budgeted);
    return {
      scorer: (a) => scorer(a as handover.HandoverDoc),
      planStrategy: (champ, rng, feedback) =>
        planStrategy(champ as handover.HandoverDoc, rng, feedback),
      generate: (champ, rng, feedback, strategy) =>
        generate(champ as handover.HandoverDoc, rng, feedback, strategy),
      initial: handover.createInitial(problem, budgeted),
      scoreHoldout: (artifact) =>
        handover.scoreHoldout(problem, artifact as handover.HandoverDoc, budgeted),
      callsPerRound: handover.estimateCallsPerRound(problem),
      maxCallsPerRun: handover.MAX_CALLS_PER_RUN,
      roundDelayMs: 0,
    };
  },
  devSample: import.meta.env.DEV ? DEV_SAMPLES[handover.TEMPLATE_ID] : undefined,
  exportArtifact: (_problem, artifact) => ({
    filename: "인수인계-문서.md",
    mime: "text/markdown;charset=utf-8",
    text: String(artifact ?? ""),
  }),
  ArtifactView: ({ artifact }) => <HandoverDocView doc={String(artifact ?? "")} />,
};

export const TEMPLATES: TemplateEntry[] = [handoverEntry, timetableEntry];

/** 0단계 빌더가 모델에게 넘길 절차 설명 — 각 칸이 실제로 무엇을 받는지 그대로 적는다.
 *  단계 목록의 정본은 buildFlowSteps다. 여기서 따로 만들지 않는다. */
export function planChoices(entries: readonly TemplateEntry[]): PlanTemplateChoice[] {
  return entries.map((entry) => ({
    id: entry.id,
    // 절차 이름과 원래 설명은 넘기지 않는다 — 모델이 그 어휘로 끌려간다
    description: entry.builderSummary ?? entry.description,
    stages: buildFlowSteps(entry.questions, entry.flow).map((step) => {
      const id = step.id.startsWith("question:") ? step.id.slice("question:".length) : null;
      const question = id === null ? undefined : entry.questions.find((q) => q.id === id);
      return {
        id: step.id,
        // 모델에게 보이지 않는다 — 모델이 이름을 안 줬을 때의 대비용이다
        name: step.label,
        purpose: entry.builderStagePurpose?.[step.id] ?? null,
        input: question?.type ?? null,
      };
    }),
  }));
}

/** 0단계 빌더가 고를 수 있는 절차 — 입력 모양이 고정된 것은 뺀다 */
export const BUILDABLE_TEMPLATES: TemplateEntry[] = TEMPLATES.filter((t) => t.fitsAnyGoal === true);

export function getTemplate(id: string | null): TemplateEntry | null {
  return TEMPLATES.find((t) => t.id === id) ?? null;
}
