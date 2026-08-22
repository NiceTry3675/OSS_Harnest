import { describe, expect, it } from "vitest";
import { initialTimetable, mutate, score, type Rng } from "./scoring";
import type { Timetable, TimetableProblem } from "./index";

/** 테스트 전용 mulberry32 — 엔진 패키지에 의존하지 않기 위한 로컬 복사 */
function testRng(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const problem = (over: Partial<TimetableProblem> = {}): TimetableProblem => ({
  staff: ["가온", "나래", "다솜"],
  days: 7,
  shiftsPerDay: 1,
  maxConsecutiveDays: 3,
  maxShiftsPerWeek: 7,
  ...over,
});

describe("initialTimetable", () => {
  it("무작위 배정 — 유효 범위·차원, 같은 rng면 같은 결과(리플레이)", () => {
    const p = problem({ staff: ["가온", "나래", "다솜", "라온"], days: 7, shiftsPerDay: 2 });
    const tt = initialTimetable(p, testRng(1));
    expect(tt).toHaveLength(7);
    for (const row of tt) {
      expect(row).toHaveLength(2);
      for (const v of row) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(4);
      }
    }
    expect(initialTimetable(p, testRng(1))).toEqual(tt);
    // 게이트는 통과한다 — 나쁜 시작점이되 유효한 산출물
    expect(score(p, tt).gateRejected).toBe(false);
  });
});

describe("mutate", () => {
  it("서로 다른 슬롯 1~3개를 다른 근무자로 재배정하고 원본은 유지한다", () => {
    const p = problem({ staff: ["가온", "나래", "다솜", "라온"], days: 14, shiftsPerDay: 2 });
    const base = initialTimetable(p, testRng(1));
    const baseCopy = structuredClone(base);

    for (let seed = 0; seed < 50; seed++) {
      const next = mutate(p, base, testRng(seed));
      expect(base).toEqual(baseCopy); // 원본 불변

      let diff = 0;
      for (let d = 0; d < p.days; d++) {
        for (let s = 0; s < p.shiftsPerDay; s++) {
          const v = next[d][s];
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(p.staff.length);
          if (v !== base[d][s]) diff++;
        }
      }
      expect(diff).toBeGreaterThanOrEqual(1);
      expect(diff).toBeLessThanOrEqual(3);
    }
  });

  it("같은 rng 수열이면 같은 결과 — 리플레이 가능성", () => {
    const p = problem({ days: 14, shiftsPerDay: 2 });
    const base = initialTimetable(p, testRng(1));
    expect(mutate(p, base, testRng(9))).toEqual(mutate(p, base, testRng(9)));
  });
});

describe("score — 구조 게이트", () => {
  it("일수 불일치는 게이트 기각", () => {
    const r = score(problem(), [[0], [1], [2]]);
    expect(r.gateRejected).toBe(true);
    expect(r.total).toBe(0);
    expect(r.violations[0]).toContain("구조 위반");
  });

  it("시프트 수 불일치는 게이트 기각", () => {
    const tt: Timetable = [[0], [1], [2], [0, 1], [1], [2], [0]];
    const r = score(problem(), tt);
    expect(r.gateRejected).toBe(true);
    expect(r.total).toBe(0);
  });

  it("유효하지 않은 인덱스·결측은 게이트 기각", () => {
    const bad = score(problem(), [[0], [1], [99], [0], [1], [2], [0]]);
    expect(bad.gateRejected).toBe(true);

    const negative = score(problem(), [[0], [1], [-1], [0], [1], [2], [0]]);
    expect(negative.gateRejected).toBe(true);

    const fractional = score(problem(), [[0], [1], [1.5], [0], [1], [2], [0]]);
    expect(fractional.gateRejected).toBe(true);
  });
});

/** parts = 기준별 0~100 부분 점수, total = 승인 가중치(0.5/0.3/0.2) 합산 — 팩과 채점식의 단일 원천 검증 */
describe("score — 가중 합산", () => {
  const w = (c: number, wl: number, f: number) =>
    Math.round((0.5 * c + 0.3 * wl + 0.2 * f) * 10) / 10;

  it("연속 근무 초과 2건: 부분 점수 50, 형평 편차 반영", () => {
    // 가온이 5일 연속(허용 3일) → 초과 2. 배정 수 [5, 2, 0] → 편차 sqrt(38/9)
    const p = problem({ maxShiftsPerWeek: 100 });
    const tt: Timetable = [[0], [0], [0], [0], [0], [1], [1]];
    const r = score(p, tt);

    const fairness = 100 - 20 * Math.sqrt(38 / 9);
    expect(r.gateRejected).toBe(false);
    expect(r.parts["consecutive"]).toBe(50);
    expect(r.parts["weekly_load"]).toBe(100);
    expect(r.parts["fairness"]).toBeCloseTo(fairness, 3);
    expect(r.violations).toContain("연속 근무 초과: 가온 — 5일 연속(허용 3일)");
    expect(r.total).toBe(w(50, 100, fairness));
  });

  it("주당 상한 초과 2건: 부분 점수 50", () => {
    // 가온이 1주차에 10회(허용 8회) → 초과 2. 배정 수 [10, 4, 0] → 편차 sqrt(456/27)
    const p = problem({ shiftsPerDay: 2, maxConsecutiveDays: 7, maxShiftsPerWeek: 8 });
    const tt: Timetable = [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [1, 1], [1, 1]];
    const r = score(p, tt);

    const fairness = 100 - 20 * Math.sqrt(456 / 27);
    expect(r.gateRejected).toBe(false);
    expect(r.parts["consecutive"]).toBe(100);
    expect(r.parts["weekly_load"]).toBe(50);
    expect(r.parts["fairness"]).toBeCloseTo(fairness, 3);
    expect(r.violations).toContain("주당 배정 초과: 가온 — 1주차 10회(허용 8회)");
    expect(r.total).toBe(w(100, 50, fairness));
  });

  it("주당 상한: 창 경계(0-6 / 7-13)가 분리 계산된다", () => {
    // 가온: 6일차 1회(1주차) + 7~13일차 7회(2주차) → 2주차만 초과 1 → 부분 점수 75
    const p = problem({ days: 14, maxConsecutiveDays: 14, maxShiftsPerWeek: 6 });
    const tt: Timetable = Array.from({ length: 14 }, (_, d) => [d >= 6 ? 0 : 1]);
    const r = score(p, tt);

    expect(r.parts["weekly_load"]).toBe(75);
    expect(r.violations).toContain("주당 배정 초과: 가온 — 2주차 7회(허용 6회)");
  });

  it("위반 없는 균등 배정은 전 기준 100 → 총점 100", () => {
    const p = problem({ days: 3, maxConsecutiveDays: 3, maxShiftsPerWeek: 7 });
    const r = score(p, [[0], [1], [2]]);
    expect(r.gateRejected).toBe(false);
    expect(r.violations).toEqual([]);
    expect(r.parts).toEqual({ consecutive: 100, weekly_load: 100, fairness: 100 });
    expect(r.total).toBe(100);
  });

  it("기준 감점이 100을 넘으면 해당 기준 점수는 0에서 바닥 — 다른 기준은 살아있다", () => {
    // 가온 10일 연속(허용 1일) → 초과 9 → 25*9 = 225 감점 → consecutive 0
    const p = problem({ days: 10, maxConsecutiveDays: 1, maxShiftsPerWeek: 7 });
    const tt: Timetable = Array.from({ length: 10 }, () => [0]);
    const r = score(p, tt);

    const fairness = 100 - 20 * Math.sqrt(600 / 27);
    expect(r.gateRejected).toBe(false);
    expect(r.parts["consecutive"]).toBe(0);
    expect(r.parts["weekly_load"]).toBe(100);
    expect(r.total).toBe(w(0, 100, fairness));
  });

  it("연속 근무는 마지막 날까지 이어진 run도 집계한다", () => {
    // 나래가 3~6일차 4일 연속(허용 3일) → 초과 1 → 부분 점수 75
    const p = problem({ maxShiftsPerWeek: 100 });
    const tt: Timetable = [[0], [2], [0], [1], [1], [1], [1]];
    const r = score(p, tt);
    expect(r.parts["consecutive"]).toBe(75);
    expect(r.violations).toContain("연속 근무 초과: 나래 — 4일 연속(허용 3일)");
  });
});

describe("결정적 전용 면제 (SPEC §10 특례 ①)", () => {
  it("실제 timetable 팩은 리포트·캘리브레이션 없이도 승인 차단이 없다", async () => {
    const { approvalBlockers } = await import("@harnest/contracts");
    const { compile } = await import("./index");
    const { pack } = await compile({
      schemaVersion: "skeleton-1",
      templateId: "timetable",
      answers: { staff: "가람, 나래, 다온", period: 7, maxConsecutive: 3 },
    });
    expect(pack.judgeProcedure.kind).toBe("deterministic_only");
    expect(approvalBlockers(pack, null, null)).toEqual([]);
  });
});
