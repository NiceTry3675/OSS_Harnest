/** 템플릿 등록소 — "폴더 하나 = 템플릿 하나"의 웹 어댑터.
 *  페이지는 이 인터페이스만 알고, 템플릿별 분기 코드를 갖지 않는다(SPEC §6 경계 원칙:
 *  템플릿마다 엔진에 분기가 생기면 경고). */

import type { ComponentType } from "react";
import type {
  CalibrationPairSpec,
  EvaluationPack,
  ExaminerCheckResult,
  InterviewSubmission,
  JudgeProvider,
  Question,
  ScoreResult,
} from "@harnest/contracts";
import type { GeneratorFeedback } from "@harnest/loop-engine";
import * as timetable from "@harnest/template-timetable";
import * as handover from "@harnest/template-handover";
import type { CompiledGeneric, ExaminerRunGeneric, HoldoutEvaluation } from "./state";
import type { LlmClient } from "@harnest/template-handover";
import { DEV_SAMPLES } from "./lib/devSamples";
import type { TemplateFlow } from "./lib/flowStep";
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
  type SharedProvider,
} from "./lib/llm";

export interface TemplateRuntime {
  scorer: (artifact: unknown) => ScoreResult | Promise<ScoreResult>;
  generate: (
    champion: unknown,
    rng: () => number,
    feedback: GeneratorFeedback,
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
  /** llm_judge 포함 템플릿의 승인 전 요건 — 검증 배터리와 캘리브레이션 쌍(SPEC §3 원칙 2).
   *  결정적 전용 템플릿은 undefined(SPEC §10 면제). */
  examiner?: {
    runBattery(
      compiled: CompiledGeneric,
      llm: LlmClient,
      onProgress?: (message: string) => void,
      /** 검사 하나가 끝날 때마다 — 화면이 결과를 기다리지 않고 바로 표시한다 */
      onCheck?: (check: ExaminerCheckResult) => void,
    ): Promise<ExaminerRunGeneric>;
    buildPairs(run: ExaminerRunGeneric, pack: EvaluationPack): CalibrationPairSpec[];
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
  needsModel: false,
  questions: timetable.questions,
  flow: {
    approval: { pending: "기준 승인", approved: "동결" },
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
  description:
    "실제로 받았던 질문과 그때의 답을 넣으세요. 문서만 읽은 AI가 그 질문들에 실제로 답해보는 방식으로 채점하며, 당신이 정한 분량 안에서 커버리지를 넓혀 갑니다.",
  needsModel: true,
  questions: handover.questions,
  flow: {
    approval: { pending: "검증·승인", approved: "동결" },
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
    if (provider !== "vertex" && hasSharedKey(provider as SharedProvider)) {
      return provider === "openai"
        ? createSharedOpenAIClient(jp.judge.model)
        : createSharedGeminiClient(jp.judge.model);
    }
    throw new Error(
      `승인된 채점 모델(${PROVIDER_LABEL[provider]})의 키가 없습니다 — 키를 입력하거나, 기준을 다시 만들어 모의 모델로 승인하세요.`,
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
    draft: (material, existing, count, llm, difficulty) =>
      handover.draftCases(llm, material, existing, count, difficulty),
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
    buildPairs: (run, pack) =>
      handover.buildCalibrationPairs(run as handover.ExaminerRun, pack),
  },
  createRuntime(compiled, llm) {
    if (!llm) throw new Error("채점 모델이 준비되지 않았습니다 — 키를 입력하거나 모의 모델을 선택하세요.");
    const jp = compiled.pack.judgeProcedure;
    if (
      jp.kind === "case_answering" &&
      (jp.judge.provider !== llm.providerId ||
        (jp.judge.provider !== "mock" && jp.judge.model !== llm.model))
    ) {
      // 승인 시 동결된 저지와 실행 모델이 다르면 실행 불가 — 재승인 원칙(SPEC §8)
      throw new Error(
        `승인된 채점 모델(${jp.judge.provider}/${jp.judge.model})을 사용할 수 없습니다 — 기준을 다시 만들어 승인해 주세요.`,
      );
    }
    const problem = compiled.problem as handover.HandoverProblem;
    // 실행 1회 예산은 런타임 인스턴스 단위로 계수한다 — 라운드 0·루프·홀드아웃이 모두 포함된다
    const budgeted = handover.withCallBudget(llm, handover.MAX_CALLS_PER_RUN);
    const scorer = handover.createScorer(problem, budgeted);
    const generate = handover.createGenerator(problem, budgeted);
    return {
      scorer: (a) => scorer(a as handover.HandoverDoc),
      generate: (champ, rng, feedback) =>
        generate(champ as handover.HandoverDoc, rng, feedback),
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

export function getTemplate(id: string | null): TemplateEntry | null {
  return TEMPLATES.find((t) => t.id === id) ?? null;
}
