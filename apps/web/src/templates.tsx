/** 템플릿 등록소 — "폴더 하나 = 템플릿 하나"의 웹 어댑터.
 *  페이지는 이 인터페이스만 알고, 템플릿별 분기 코드를 갖지 않는다(SPEC §6 경계 원칙:
 *  템플릿마다 엔진에 분기가 생기면 경고). */

import type { ComponentType } from "react";
import type {
  CalibrationPairSpec,
  EvaluationPack,
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
import { TimetableGrid } from "./components/TimetableGrid";
import { HandoverDocView } from "./components/HandoverDocView";
import {
  createGeminiClient,
  createMockClient,
  createOpenAIClient,
  getByoKey,
  PROVIDER_LABEL,
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
    ): Promise<ExaminerRunGeneric>;
    buildPairs(run: ExaminerRunGeneric, pack: EvaluationPack): CalibrationPairSpec[];
  };
  ArtifactView: ComponentType<{ problem: unknown; artifact: unknown }>;
}

const timetableEntry: TemplateEntry = {
  id: timetable.TEMPLATE_ID,
  name: timetable.TEMPLATE_NAME,
  description:
    "근무자 명단과 원칙만 알려주세요. 연속 근무 한도·주당 상한·배정 형평을 당신이 승인한 기준으로 채점하며, 통과할 때까지 근무표를 스스로 다듬습니다.",
  badge: "개발용 테스트 템플릿",
  needsModel: false,
  questions: timetable.questions,
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
      roundDelayMs: 120,
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
  compile: (submission, judge) =>
    handover.compile(submission, { judgeProvider: judge.provider, judgeModel: judge.model }),
  createLlm(compiled) {
    const jp = compiled.pack.judgeProcedure;
    if (jp.kind !== "case_answering") return null;
    if (jp.judge.provider === "mock") {
      return createMockClient(compiled.problem as handover.HandoverProblem);
    }
    const provider = jp.judge.provider;
    const key = getByoKey(provider);
    if (!key) {
      throw new Error(
        `승인된 채점 모델(${PROVIDER_LABEL[provider]} BYO)의 키가 없습니다 — 키를 입력하거나, 기준을 다시 만들어 모의 모델로 승인하세요.`,
      );
    }
    return provider === "openai"
      ? createOpenAIClient(key, jp.judge.model)
      : createGeminiClient(key, jp.judge.model);
  },
  examiner: {
    runBattery: (compiled, llm, onProgress) =>
      handover.runExaminerBattery(
        compiled.problem as handover.HandoverProblem,
        compiled.pack,
        llm,
        onProgress,
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
    const scorer = handover.createScorer(problem, llm);
    const generate = handover.createGenerator(problem, llm);
    return {
      scorer: (a) => scorer(a as handover.HandoverDoc),
      generate: (champ, rng, feedback) =>
        generate(champ as handover.HandoverDoc, rng, feedback),
      initial: handover.createInitial(problem, llm),
      scoreHoldout: (artifact) =>
        handover.scoreHoldout(problem, artifact as handover.HandoverDoc, llm),
      callsPerRound: handover.estimateCallsPerRound(problem),
      roundDelayMs: 0,
    };
  },
  ArtifactView: ({ artifact }) => <HandoverDocView doc={String(artifact ?? "")} />,
};

export const TEMPLATES: TemplateEntry[] = [handoverEntry, timetableEntry];

export function getTemplate(id: string | null): TemplateEntry | null {
  return TEMPLATES.find((t) => t.id === id) ?? null;
}
