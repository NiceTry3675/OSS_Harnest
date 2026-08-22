/** 인수인계·온보딩 문서 템플릿 — 플래그십 (SPEC §6, 실측 go 2026-08-22).
 *  "원샷은 저자가 중요하다고 생각하는 것을 쓰고, 로그는 사람들이 실제로 묻는 것을 드러낸다."
 *  케이스(실제 질문·답 기록)가 원료이자 시험지다: responder가 문서만 보고 케이스를 풀고
 *  grader가 정답과 대조한다(case_answering — 스키마 §5). 채택은 제3 모드(SPEC §5.1.1). */

import type {
  CaseDef, EvaluationPack, InterviewSubmission, LoopSpec, Question,
} from "@harnest/contracts";
import { digestScope, sha256Canonical } from "@harnest/contracts";

export const TEMPLATE_ID = "handover";
export const TEMPLATE_NAME = "인수인계·온보딩 문서";

/** 스켈레톤 비용 상한 — 케이스당 라운드마다 2콜(responder+grader). SPEC §12 미결 2 */
export const MAX_CASES = 9;
export const MIN_CASES = 4;

export interface HandoverProblem {
  material: string;
  /** 루프(Generator·scorer)가 보는 케이스 — 원료이자 가시 시험지 */
  visibleCases: CaseDef[];
  /** 루프에 절대 노출되지 않는다 — 라운드 0과 종료 시에만 채점(SPEC §3 원칙 7) */
  holdoutCases: CaseDef[];
  /** 사용자가 정한 절대 분량 상한(자) — hard gate */
  lengthCap: number;
}

/** 산출물 = 문서 텍스트 */
export type HandoverDoc = string;

export const questions: Question[] = [
  {
    id: "material",
    role: "material",
    type: "textarea",
    label: "업무 소개 · 참고 자료",
    help: "인수인계 대상 업무를 소개하는 글이나 기존 자료를 붙여넣으세요 (선택)",
    placeholder: "예: 저는 사내 배포 파이프라인을 관리합니다. 주간 배포는 …",
  },
  {
    id: "cases",
    role: "material",
    type: "caseList",
    label: "실제로 받았던 질문과 그때의 답",
    help: `실제 질문·답 쌍 ${MIN_CASES}~${MAX_CASES}개. 마지막 1/3은 검증용으로 숨겨져 문서 작성에 쓰이지 않습니다`,
  },
  {
    id: "lengthCap",
    role: "criteria",
    type: "number",
    label: "문서 최대 분량 (자)",
    help: "이 분량을 넘는 문서는 실격 처리됩니다 (500~8000자)",
    min: 500,
    max: 8000,
    defaultValue: 2000,
  },
];

export interface CompiledHandover {
  problem: HandoverProblem;
  pack: EvaluationPack;
  loopSpec: LoopSpec;
}

export interface CompileOptions {
  /** 저지 구동 모델 — 판정 절차의 일부로 동결된다. 승인 전에 확정(SPEC §12 미결 7 UX 제약) */
  judgeProvider: "gemini" | "mock";
  judgeModel: string;
}

export async function compile(
  submission: InterviewSubmission,
  opts: CompileOptions,
): Promise<CompiledHandover> {
  const material = String(submission.answers["material"] ?? "").trim();
  const rawCases = submission.answers["cases"];
  const lengthCap = Number(submission.answers["lengthCap"] ?? 2000);

  if (!Array.isArray(rawCases)) throw new Error("질문·답 기록을 입력해 주세요.");
  const cases: CaseDef[] = rawCases
    .map((c, i) => ({
      id: `case-${i + 1}`,
      question: String((c as CaseDef).question ?? "").trim(),
      expectedAnswer: String((c as CaseDef).expectedAnswer ?? "").trim(),
    }))
    .filter((c) => c.question.length > 0 && c.expectedAnswer.length > 0);

  if (cases.length < MIN_CASES) throw new Error(`질문·답 쌍이 ${MIN_CASES}개 이상 필요합니다.`);
  if (cases.length > MAX_CASES) throw new Error(`질문·답 쌍은 최대 ${MAX_CASES}개입니다 (비용 상한).`);
  if (!Number.isInteger(lengthCap) || lengthCap < 500 || lengthCap > 8000) {
    throw new Error("문서 최대 분량은 500~8000자여야 합니다.");
  }

  // 자동 꼬리 분할: 입력 순서의 마지막 1/3(최소 1개)이 홀드아웃 — 실측 02 반복성 보존 설계의 축소판
  const holdoutCount = Math.max(1, Math.floor(cases.length / 3));
  const visibleCases = cases.slice(0, cases.length - holdoutCount);
  const holdoutCases = cases.slice(cases.length - holdoutCount);

  const problem: HandoverProblem = { material, visibleCases, holdoutCases, lengthCap };

  // 케이스 본문·자료의 지문을 판정 절차에 결속 — 내용이 다른 시험지는 다른 다이제스트를
  // 갖는다(같은 개수·같은 상한이어도). 체크포인트 귀속·시드가 실제 시험지 내용에 잠긴다.
  const casesDigest = (await sha256Canonical({ material, cases })).slice(0, 16);

  const base: Omit<EvaluationPack, "definitionDigest"> = {
    packVersion: "skeleton-1",
    templateId: TEMPLATE_ID,
    criteria: [
      {
        id: "case_answerability",
        kind: "case_answering",
        scorer: "handover_case_answering",
        params: { visibleCases: visibleCases.length, scale: "0/0.5/1", casesDigest },
        weight: 1.0,
        label: `문서만 보고 실제 질문에 답할 수 있는가 (가시 케이스 ${visibleCases.length}개 실측)`,
      },
    ],
    gates: [
      {
        id: "length_cap",
        kind: "deterministic",
        scorer: "length_within",
        params: { maxChars: lengthCap },
        effect: "reject",
        label: `분량 ${lengthCap.toLocaleString()}자 이하`,
      },
    ],
    judgeProcedure: {
      kind: "case_answering",
      judge: { provider: opts.judgeProvider, model: opts.judgeModel },
      notices: {
        examinerReport: "미구현 — 정식 요건(SPEC §4.1 검증 리포트), 다음 단계에서 추가",
        calibration: "미구현 — llm_judge 포함 루프의 필수 요건(SPEC §3 원칙 2), 다음 단계에서 추가",
        pairwise: "미적용 — 케이스 실측 중심 루프의 제3 채택 모드(SPEC §5.1.1, 실측 02b~05 검증)",
      },
    },
    holdoutPolicy: {
      mode: "auto_tail",
      note: `입력의 마지막 ${holdoutCount}개 케이스는 루프에 숨겨지며 시작·종료 시에만 채점됩니다`,
      holdoutCaseIds: holdoutCases.map((c) => c.id),
    },
  };

  const definitionDigest = await sha256Canonical(digestScope(base));
  const pack: EvaluationPack = { ...base, definitionDigest };

  const loopSpec: LoopSpec = {
    // LLM 비용: 라운드당 (1 생성 + 가시×2 채점)콜 — 짧게 돌리고 정체로 끊는다
    maxRounds: 8,
    plateauRounds: 4,
    adoptionRule: "scalar_strict",
    seed: parseInt(definitionDigest.slice(0, 8), 16),
  };

  return { problem, pack, loopSpec };
}

export * from "./prompts";
export * from "./runtime";
