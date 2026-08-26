/** 인수인계·온보딩 문서 템플릿 — 플래그십 (SPEC §6).
 *  "원샷은 저자가 중요하다고 생각하는 것을 쓰고, 로그는 사람들이 실제로 묻는 것을 드러낸다."
 *  케이스(실제 질문·답 기록)가 원료이자 시험지다: responder가 문서만 보고 케이스를 풀고
 *  grader가 정답과 대조한다(case_answering). 채택은 strict scalar 모드(SPEC §5.1.1). */

import type {
  CaseDef, EvaluationPack, InterviewSubmission, JudgeProvider, LoopSpec, Question,
} from "@harnest/contracts";
import { digestScope, sha256Canonical } from "@harnest/contracts";
import { CONCISENESS_WEIGHT, COVERAGE_WEIGHT } from "./runtime";

export const TEMPLATE_ID = "handover";
export const TEMPLATE_NAME = "인수인계·온보딩 문서";

/** 케이스 수 상한 — 배치 채점(라운드당 3콜)으로 콜 수는 케이스 수와 무관해졌다.
 *  이 상한은 비용이 아니라 프롬프트 분량(케이스 전체가 생성·채점 프롬프트에 실린다)과
 *  입력·검토 부담을 묶는 값이다. */
export const MAX_CASES = 30;
export const MIN_CASES = 4;

/** 참고 자료 문자 수 상한 — 서버 선택 저장의 봉투 상한(1 MiB)과 매 라운드 생성 프롬프트에
 *  material이 통째로 실리는 비용 구조를 고려한 값. 질문 선언이 정본, compile이 재검증한다. */
export const MATERIAL_MAX_CHARS = 100_000;

/** 분량 상한(자) 허용 범위 — 생성 출력 토큰 예산(runtime의 maxOutputTokensFor)과 함께
 *  움직인다. 상한을 더 올리려면 벤더별 최대 출력 토큰부터 확인할 것. */
export const LENGTH_CAP_MIN = 500;
export const LENGTH_CAP_MAX = 20_000;
export const LENGTH_CAP_DEFAULT = 8_000;

/** 실행 1회(라운드 0 + 루프 + 홀드아웃 2회 채점)의 모델 호출 예산 (SPEC §5.2).
 *  배치 채점 1회는 최악 4콜(responder+grader+형식 재시도 각 1회)이다. 피드백·가드가 별도
 *  배치이므로 라운드 0+8라운드에서 전부 발생해도 (8+1)×(1+4+4) + 2×4 = 89회다.
 *  120은 정상 실행에서 절대 걸리지 않는 백스톱이다. */
export const MAX_CALLS_PER_RUN = 120;

export interface HandoverProblem {
  material: string;
  /** 피드백 케이스 — Generator·scorer가 보는 가시 시험지(질문·실패 사유 공개) */
  visibleCases: CaseDef[];
  /** 검증 가드 — 매 라운드 채점하되 집계 점수만 채택의 비퇴보 조건에 쓴다.
   *  개별 질문·트레이스는 Generator에 절대 노출되지 않는다(SPEC §5.1.1). */
  guardCases: CaseDef[];
  /** 루프에 절대 노출되지 않는다 — 라운드 0과 종료 시에만 채점(SPEC §3 원칙 7) */
  holdoutCases: CaseDef[];
  /** 사용자가 정한 절대 분량 상한(자) — hard gate */
  lengthCap: number;
  /** 간결성 가점 사용 여부 — 켜면 커버리지 0.8 + 간결성 0.2 가중(./runtime.ts).
   *  criteria 배열을 바꾸므로 다이제스트에 자동 결속된다. */
  useConciseness: boolean;
}

/** 산출물 = 문서 텍스트 */
export type HandoverDoc = string;

export const questions: Question[] = [
  {
    id: "material",
    role: "material",
    type: "textarea",
    label: "어떤 업무를 넘기시나요?",
    shortLabel: "업무 소개",
    help: "지금 하고 있는 일을 편하게 적어주세요. 기존 문서는 파일 선택으로 첨부할 수 있습니다.",
    nextLabel: "질문 넣으러 가기",
    placeholder: "예: 저는 사내 배포 파이프라인을 관리합니다. 주간 배포는 …",
    attachText: true,
    maxChars: MATERIAL_MAX_CHARS,
  },
  {
    id: "cases",
    role: "material",
    type: "caseList",
    label: "실제로 받았던 질문과,\n그때 당신이 한 답을 알려주세요.",
    shortLabel: "질문과 답",
    help: `한 줄씩 ${MIN_CASES}~${MAX_CASES}개 입력하세요. 질문은 개선·중간 점검·최종 확인에 나누어 씁니다. 최종 확인 질문은 시작과 끝에만 채점합니다.`,
    nextLabel: "분량 정하러 가기",
    // 케이스 수 상한의 정본은 이 선언 — 위저드는 min/max를 읽어 렌더하고 compile이 재검증한다
    min: MIN_CASES,
    max: MAX_CASES,
  },
  {
    id: "lengthCap",
    role: "criteria",
    type: "number",
    label: "문서 길이를 어떻게 다룰까요?",
    shortLabel: "분량·간결성",
    nextLabel: "채점 모델 고르기",
    help: `이 분량을 넘는 문서는 점수 비교에서 제외됩니다 (${LENGTH_CAP_MIN}~${LENGTH_CAP_MAX.toLocaleString()}자). 기록 전체가 상한 안에 들어갈 만큼 넉넉하면 필수 분량 조건만으로 베끼기를 막기 어려워집니다`,
    min: LENGTH_CAP_MIN,
    max: LENGTH_CAP_MAX,
    defaultValue: LENGTH_CAP_DEFAULT,
  },
  {
    // 분량 상한과 같은 단계에서 묻는다 — 방금 정한 상한을 두고 판단하는 질문이다
    id: "conciseness",
    role: "criteria",
    type: "toggle",
    label: "길이를 점수에도 반영할까요?",
    sameStep: true,
    help:
      "사용: 답변 가능성 80% + 간결성 20%. 답변 수준이 같으면 더 짧은 문서가 높은 점수를 받습니다.\n" +
      "사용 안 함: 문서 길이는 점수에 반영하지 않습니다.",
    defaultValue: true,
  },
  {
    id: "judgeModel",
    role: "criteria",
    type: "judgeModel",
    label: "어떤 AI가 채점할까요?",
    shortLabel: "채점 모델",
    nextLabel: "작성 완료 — 승인 화면으로",
    help: "이 모델도 평가 절차의 일부라 승인하면 함께 잠깁니다. 바꾸려면 다시 승인해야 합니다.",
  },
];

export interface CompiledHandover {
  problem: HandoverProblem;
  pack: EvaluationPack;
  loopSpec: LoopSpec;
  /** 설정의 산술적 성질에 대한 정적 안내 — 승인 화면이 그대로 표시한다.
   *  (예: 기록 전체가 분량 상한 안 = 베끼기 방어(분량 게이트) 약화, 실측 교훈 ①) */
  notices: string[];
}

export interface CompileOptions {
  /** 저지 구동 모델 — 판정 절차의 일부로 동결되므로 승인 전에 확정한다(SPEC §8). */
  judgeProvider: JudgeProvider;
  judgeModel: string;
}

/** mulberry32 기반 결정적 Fisher–Yates 셔플 — 케이스 분할 전용.
 *  엔진 RNG와 상태를 공유하지 않으며, 같은 (items, seed)에는 항상 같은 순열을 준다. */
function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export async function compile(
  submission: InterviewSubmission,
  opts: CompileOptions,
): Promise<CompiledHandover> {
  const material = String(submission.answers["material"] ?? "").trim();
  const rawCases = submission.answers["cases"];
  const lengthCap = Number(submission.answers["lengthCap"] ?? LENGTH_CAP_DEFAULT);
  // 명시적 false만 끔 — 키가 없는 구버전 답변은 기본값(켬)을 따른다
  const useConciseness = submission.answers["conciseness"] !== false;

  if (!Array.isArray(rawCases)) throw new Error("질문·답 기록을 입력해 주세요.");
  const cases: CaseDef[] = rawCases
    .map((c, i) => {
      const prov = (c as CaseDef).provenance;
      return {
        id: `case-${i + 1}`,
        question: String((c as CaseDef).question ?? "").trim(),
        expectedAnswer: String((c as CaseDef).expectedAnswer ?? "").trim(),
        // "user"는 생략 규약 — 직접 입력 흐름의 casesDigest를 기존과 동일하게 유지한다
        ...(prov === "ai" || prov === "ai_edited" ? { provenance: prov } : {}),
      };
    })
    .filter((c) => c.question.length > 0 && c.expectedAnswer.length > 0);

  if (cases.length < MIN_CASES) throw new Error(`질문·답 쌍이 ${MIN_CASES}개 이상 필요합니다.`);
  if (cases.length > MAX_CASES) {
    throw new Error(`질문·답 쌍은 최대 ${MAX_CASES}개입니다 (프롬프트 분량 상한).`);
  }
  if (!Number.isInteger(lengthCap) || lengthCap < LENGTH_CAP_MIN || lengthCap > LENGTH_CAP_MAX) {
    throw new Error(
      `문서 최대 분량은 ${LENGTH_CAP_MIN}~${LENGTH_CAP_MAX.toLocaleString()}자여야 합니다.`,
    );
  }
  if (material.length > MATERIAL_MAX_CHARS) {
    throw new Error(
      `참고 자료는 최대 ${MATERIAL_MAX_CHARS.toLocaleString()}자입니다 (현재 ${material.length.toLocaleString()}자).`,
    );
  }

  // 케이스 본문·자료의 지문을 판정 절차에 결속 — 내용이 다른 시험지는 다른 다이제스트를
  // 갖는다(같은 개수·같은 상한이어도). 체크포인트 귀속·시드가 실제 시험지 내용에 잠긴다.
  const casesDigest = (await sha256Canonical({ material, cases })).slice(0, 16);

  // 시드 셔플 분할(피드백 40% · 검증 가드 40% · 홀드아웃 20%, 각 최소 1) — 케이스 초안이
  // 자료 순서를 따르더라도 세 집합이 특정 주제군(예: 자료 후반부)에 몰리지 않게 한다.
  // 시드를 내용 지문에서 유도하므로 같은 시험지는 언제 컴파일해도 같은 분할이다
  // (컴파일 순수성 = 다이제스트 안정성).
  const shuffled = seededShuffle(cases, parseInt(casesDigest.slice(0, 8), 16));
  const holdoutCount = Math.max(1, Math.floor(cases.length * 0.2));
  const guardCount = Math.max(1, Math.floor(cases.length * 0.4));
  const holdoutCases = shuffled.slice(0, holdoutCount);
  const guardCases = shuffled.slice(holdoutCount, holdoutCount + guardCount);
  const visibleCases = shuffled.slice(holdoutCount + guardCount);
  // 비퇴보 허용 오차 = 채점 반 단계(0.5점짜리 뒤집힘 하나) — 저지 노이즈로 좋은 후보가
  // 기각되지 않게 하되, 실제 퇴보는 걸러낸다. 사용자 노브가 아니라 개수에서 유도되는 산식.
  const guardTolerance = Math.round((100 / (2 * guardCases.length)) * 10) / 10;

  const problem: HandoverProblem = {
    material,
    visibleCases,
    guardCases,
    holdoutCases,
    lengthCap,
    useConciseness,
  };

  const base: Omit<EvaluationPack, "definitionDigest"> = {
    packVersion: "skeleton-1",
    templateId: TEMPLATE_ID,
    criteria: [
      {
        id: "case_answerability",
        kind: "case_answering",
        scorer: "handover_case_answering",
        params: { visibleCases: visibleCases.length, scale: "0/0.5/1", casesDigest },
        weight: useConciseness ? COVERAGE_WEIGHT : 1.0,
        label: "답변 가능성",
      },
      // 간결성(선택) — 상한 대비 여유의 결정적 산술. 커버리지와 정면으로 충돌하는 축이라
      // "전부 담으면 만점" 포화를 없앤다. 답변력 0이면 0점(빈 문서 역전 방지, runtime.ts).
      ...(useConciseness
        ? [
            {
              id: "conciseness",
              kind: "deterministic" as const,
              scorer: "length_headroom",
              params: { maxChars: lengthCap },
              weight: CONCISENESS_WEIGHT,
              label: `간결성 (분량 상한 ${lengthCap.toLocaleString()}자 대비 여유 — 답변력이 0이면 0점)`,
            },
          ]
        : []),
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
      // 검증 리포트는 승인 전 요건으로 구현됨(./examiner.ts) — forDigest 결속이라 팩 필드가 아니다
      pairwiseNotice:
        "필수 조건과 중간 점검을 통과하고, 종합 점수가 현재 결과보다 높아야 합니다.",
    },
    holdoutPolicy: {
      mode: "seeded_split",
      note:
        `질문을 세 가지 용도로 나눕니다.\n` +
        `개선용: 평가 결과를 다음 개선에 반영합니다.\n` +
        `중간 점검용: 매 회차 평가하되 합계 점수만 새 개선안의 채택 판단에 사용합니다.\n` +
        `최종 확인용: 개선에는 사용하지 않고 시작과 끝에서만 평가합니다.`,
      guardCaseIds: guardCases.map((c) => c.id),
      holdoutCaseIds: holdoutCases.map((c) => c.id),
      guardTolerance,
    },
  };

  const definitionDigest = await sha256Canonical(digestScope(base));
  const pack: EvaluationPack = { ...base, definitionDigest };

  const loopSpec: LoopSpec = {
    // LLM 비용: 라운드당 (1 생성 + 피드백 배치 2 + 가드 배치 2)콜 — 짧게 돌리고 정체로 끊는다
    maxRounds: 8,
    plateauRounds: 4,
    adoptionRule: "scalar_strict",
    seed: parseInt(definitionDigest.slice(0, 8), 16),
  };

  // 베끼기 방어 안내 — 가시 기록 전체가 상한 안에 들어가면 정답을 통째로 옮겨 적는 문서를
  // 분량 게이트가 걸러내지 못한다(게이트 밴드 교훈 ①). LLM 호출 없는 두 숫자의 산술이므로
  // 배터리 판정이 아니라 컴파일 시 정적 안내로 알린다.
  const verbatimLength = visibleCases
    .map((c) => `질문: ${c.question}\n답: ${c.expectedAnswer}`)
    .join("\n\n").length;
  const notices: string[] = [];
  if (verbatimLength <= lengthCap) {
    notices.push(
      `질문·답 전체(약 ${verbatimLength.toLocaleString()}자)를 그대로 옮겨도 ${lengthCap.toLocaleString()}자 제한을 넘지 않습니다.\n` +
        "이를 막으려면 분량 상한을 낮추세요. 그대로 두려면 최종 확인 점수를 확인하세요.",
    );
  }

  return { problem, pack, loopSpec, notices };
}

export * from "./assist";
export * from "./prompts";
export * from "./runtime";
export * from "./probes";
export * from "./examiner";
