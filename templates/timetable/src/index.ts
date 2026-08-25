/** 시간표 템플릿 — 결정적 개발용 테스트 템플릿 (SPEC §10).
 *  채점이 완전 결정적이라 LLM 저지 변수 없이 파이프라인을 디버깅한다.
 *  경계 원칙: 템플릿 = 신뢰 가능한 부품의 범위 선언(질문·채점기·파라미터 매핑),
 *  엔진 = 그 범위 안의 조합·검증 (SPEC §6). */

import type {
  EvaluationPack, InterviewSubmission, LoopSpec, Question,
} from "@harnest/contracts";
import { digestScope, sha256Canonical } from "@harnest/contracts";
import { WEIGHTS } from "./scoring";

export interface TimetableProblem {
  staff: string[];
  days: number;
  shiftsPerDay: number;
  maxConsecutiveDays: number;
  maxShiftsPerWeek: number;
}

/** timetable[day][shift] = staff 인덱스 */
export type Timetable = number[][];

export const TEMPLATE_ID = "timetable";
export const TEMPLATE_NAME = "근무표 짜기";

export const questions: Question[] = [
  {
    id: "staff",
    role: "material",
    type: "staffList",
    label: "근무자 명단",
    shortLabel: "근무자",
    help: "쉼표로 구분해 입력하세요 (3명 이상)",
    placeholder: "가온, 나래, 다솜, 라온",
  },
  {
    id: "period",
    role: "constraints",
    type: "number",
    label: "짜려는 기간 (일)",
    shortLabel: "기간",
    help: "7~28일",
    min: 7,
    max: 28,
    defaultValue: 14,
  },
  {
    id: "maxConsecutive",
    role: "criteria",
    type: "number",
    label: "한 사람의 최대 연속 근무일",
    shortLabel: "근무 규칙",
    help: "이 값을 넘는 연속 근무는 위반으로 채점됩니다 (1~7)",
    min: 1,
    max: 7,
    defaultValue: 3,
  },
];

export interface CompiledProject {
  problem: TimetableProblem;
  pack: EvaluationPack;
  loopSpec: LoopSpec;
}

/** 인터뷰 답변 → 문제 + Evaluation Pack + 루프 스펙. 브라우저에서 결정적으로 컴파일한다. */
export async function compile(submission: InterviewSubmission): Promise<CompiledProject> {
  const staff = String(submission.answers["staff"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const days = Number(submission.answers["period"] ?? 14);
  const maxConsecutive = Number(submission.answers["maxConsecutive"] ?? 3);

  if (staff.length < 3) throw new Error("근무자는 3명 이상이어야 합니다.");
  if (!Number.isInteger(days) || days < 7 || days > 28) throw new Error("기간은 7~28일이어야 합니다.");
  if (!Number.isInteger(maxConsecutive) || maxConsecutive < 1 || maxConsecutive > 7) {
    throw new Error("최대 연속 근무일은 1~7이어야 합니다.");
  }

  const problem: TimetableProblem = {
    staff,
    days,
    shiftsPerDay: 2,
    maxConsecutiveDays: maxConsecutive,
    // 주당 상한: 전체 슬롯을 인원으로 나눈 평균에 +2 여유 — 사용자 제약이 아니라 파생 제약
    maxShiftsPerWeek: Math.ceil((7 * 2) / staff.length) + 2,
  };

  const base: Omit<EvaluationPack, "definitionDigest"> = {
    packVersion: "skeleton-1",
    templateId: TEMPLATE_ID,
    criteria: [
      {
        id: "consecutive",
        kind: "deterministic",
        scorer: "timetable_consecutive_violations",
        params: { maxConsecutiveDays: problem.maxConsecutiveDays },
        weight: WEIGHTS.consecutive,
        label: `연속 근무 ${problem.maxConsecutiveDays}일 초과 없음`,
      },
      {
        id: "weekly_load",
        kind: "deterministic",
        scorer: "timetable_weekly_load_violations",
        params: { maxShiftsPerWeek: problem.maxShiftsPerWeek },
        weight: WEIGHTS.weekly_load,
        label: `주당 ${problem.maxShiftsPerWeek}회 초과 배정 없음`,
      },
      {
        id: "fairness",
        kind: "deterministic",
        scorer: "timetable_fairness",
        params: {},
        weight: WEIGHTS.fairness,
        label: "배정 횟수의 형평",
      },
    ],
    gates: [
      {
        id: "structure",
        kind: "deterministic",
        scorer: "timetable_structure",
        params: { days: problem.days, shiftsPerDay: problem.shiftsPerDay },
        effect: "reject",
        label: "모든 시프트에 정확히 1명 배정",
      },
    ],
    judgeProcedure: {
      kind: "deterministic_only",
      exemptions: {
        examinerReport: "해당 없음 — 결정적 채점 전용 (SPEC §10)",
        calibration: "해당 없음 — 결정적 채점 전용 (SPEC §10)",
        pairwise: "미적용 — 채택은 스칼라 엄격 개선 (SPEC §10)",
      },
    },
    holdoutPolicy: {
      mode: "none",
      note: "해당 없음 — 이 결정적 개발용 템플릿에는 홀드아웃 케이스가 없습니다 (SPEC §10)",
    },
  };

  const definitionDigest = await sha256Canonical(digestScope(base));
  const pack: EvaluationPack = { ...base, definitionDigest };

  const loopSpec: LoopSpec = {
    maxRounds: 40,
    plateauRounds: 12,
    adoptionRule: "scalar_strict",
    seed: parseInt(definitionDigest.slice(0, 8), 16),
  };

  return { problem, pack, loopSpec };
}

export { score, initialTimetable, mutate } from "./scoring";
