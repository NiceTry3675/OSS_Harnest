/** 시간표 결정적 채점기·변이기.
 *  계약: score는 pack의 criteria/gates 정의와 일치해야 하며(구조 게이트 → 3개 기준 합산 0~100),
 *  mutate/initial은 전달받은 rng만 사용한다(리플레이 가능성). */

import type { ScoreResult } from "@harnest/contracts";
import type { Timetable, TimetableProblem } from "./index";

export type Rng = () => number;

/** 기준별 가중치의 단일 원천 — 팩 컴파일(index.ts)과 채점식이 같은 값을 참조한다.
 *  승인·동결되는 가중치와 실행되는 가중치가 갈라지는 순간 판정 절차 불일치다(SPEC §3 원칙 4). */
export const WEIGHTS = { consecutive: 0.5, weekly_load: 0.3, fairness: 0.2 } as const;

const sub = (penalty: number): number => Math.max(0, 100 - penalty);

/** 전 슬롯 무작위 배정 — 의도적으로 나쁜 초기해.
 *  라운드로빈 초기해는 형평이 완벽해 원샷이 천장에서 시작한다(개선 여지 없음 — 델타 01 교훈의 재현).
 *  루프의 존재 증명은 나쁜 시작점에서 승인된 기준으로 올라가는 것이다. rng만 사용(리플레이 가능성). */
export function initialTimetable(problem: TimetableProblem, rng: Rng): Timetable {
  const tt: Timetable = [];
  for (let d = 0; d < problem.days; d++) {
    const row: number[] = [];
    for (let s = 0; s < problem.shiftsPerDay; s++) {
      row.push(Math.floor(rng() * problem.staff.length));
    }
    tt.push(row);
  }
  return tt;
}

/** 복사 후 서로 다른 슬롯 1~3개를 현재와 다른 근무자로 재배정 */
export function mutate(problem: TimetableProblem, tt: Timetable, rng: Rng): Timetable {
  const next = tt.map((row) => row.slice());
  const slots = problem.days * problem.shiftsPerDay;
  const n = Math.min(slots, 1 + Math.floor(rng() * 3));
  const chosen = new Set<number>();
  while (chosen.size < n) chosen.add(Math.floor(rng() * slots));
  for (const slot of chosen) {
    const d = Math.floor(slot / problem.shiftsPerDay);
    const s = slot % problem.shiftsPerDay;
    const current = next[d][s];
    // 현재 근무자를 제외한 균등 추첨
    let pick = Math.floor(rng() * (problem.staff.length - 1));
    if (pick >= current) pick += 1;
    next[d][s] = pick;
  }
  return next;
}

const gateReject = (message: string): ScoreResult => ({
  total: 0,
  violations: [message],
  parts: {},
  gateRejected: true,
});

export function score(problem: TimetableProblem, tt: Timetable): ScoreResult {
  const { staff, days, shiftsPerDay, maxConsecutiveDays, maxShiftsPerWeek } = problem;

  // ① 구조 게이트 — 문이지 저울이 아니다: 위반이면 채점·채택 판정에 진입하지 않는다
  if (!Array.isArray(tt) || tt.length !== days) {
    const got = Array.isArray(tt) ? tt.length : 0;
    return gateReject(`구조 위반: 일수 불일치 — ${got}일(요구 ${days}일)`);
  }
  for (let d = 0; d < days; d++) {
    const row = tt[d];
    if (!Array.isArray(row) || row.length !== shiftsPerDay) {
      return gateReject(`구조 위반: ${d + 1}일차 시프트 수 불일치(요구 ${shiftsPerDay}개)`);
    }
    for (let s = 0; s < shiftsPerDay; s++) {
      const v = row[s];
      if (!Number.isInteger(v) || v < 0 || v >= staff.length) {
        return gateReject(`구조 위반: ${d + 1}일차 ${s + 1}번 시프트의 배정이 결측이거나 유효하지 않음`);
      }
    }
  }

  const violations: string[] = [];

  // ② 연속 근무 — 사람별 "그날 아무 시프트라도 근무"한 연속 일수의 상한 초과분
  let consecutive = 0;
  for (let p = 0; p < staff.length; p++) {
    let run = 0;
    for (let d = 0; d <= days; d++) {
      if (d < days && tt[d].includes(p)) {
        run++;
        continue;
      }
      if (run > maxConsecutiveDays) {
        consecutive += run - maxConsecutiveDays;
        violations.push(`연속 근무 초과: ${staff[p]} — ${run}일 연속(허용 ${maxConsecutiveDays}일)`);
      }
      run = 0;
    }
  }

  // ③ 주당 상한 — 7일 창(0-6, 7-13, …)별 배정 횟수의 상한 초과분
  let weekly = 0;
  const weeks = Math.ceil(days / 7);
  for (let p = 0; p < staff.length; p++) {
    for (let w = 0; w < weeks; w++) {
      let count = 0;
      const end = Math.min(days, w * 7 + 7);
      for (let d = w * 7; d < end; d++) {
        for (const v of tt[d]) if (v === p) count++;
      }
      if (count > maxShiftsPerWeek) {
        weekly += count - maxShiftsPerWeek;
        violations.push(`주당 배정 초과: ${staff[p]} — ${w + 1}주차 ${count}회(허용 ${maxShiftsPerWeek}회)`);
      }
    }
  }

  // ④ 형평 — 사람별 총 배정 횟수의 모표준편차
  const counts = staff.map(() => 0);
  for (const row of tt) for (const v of row) counts[v]++;
  const mean = counts.reduce((a, b) => a + b, 0) / staff.length;
  const fairness = Math.sqrt(counts.reduce((a, c) => a + (c - mean) ** 2, 0) / staff.length);

  // 기준별 0~100 부분 점수 → 승인된 가중치로 합산. parts = 기준별 점수(관제실·트레이스 표기용)
  const parts = {
    consecutive: sub(25 * consecutive),
    weekly_load: sub(25 * weekly),
    fairness: Math.round(sub(20 * fairness) * 10000) / 10000,
  };
  const total =
    Math.round(
      (WEIGHTS.consecutive * parts.consecutive +
        WEIGHTS.weekly_load * parts.weekly_load +
        WEIGHTS.fairness * parts.fairness) * 10,
    ) / 10;
  return { total, violations, parts, gateRejected: false };
}
