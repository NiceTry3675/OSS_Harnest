/** 근무표 그리드 — 행=시프트(주간/야간), 열=일차, 셀=근무자명. */

import type { Timetable, TimetableProblem } from "@harnest/template-timetable";

const SHIFT_NAMES = ["주간", "야간"];

interface TimetableGridProps {
  problem: TimetableProblem;
  timetable: Timetable;
}

export function TimetableGrid({ problem, timetable }: TimetableGridProps) {
  const shiftName = (s: number) => SHIFT_NAMES[s] ?? `${s + 1}교대`;

  const cell = (day: number, shift: number): string => {
    const row: readonly number[] | undefined = timetable[day];
    const idx: number | undefined = row?.[shift];
    return idx !== undefined && Number.isInteger(idx) && idx >= 0 && idx < problem.staff.length
      ? problem.staff[idx]
      : "—";
  };

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="grid">
        <thead>
          <tr>
            <th />
            {Array.from({ length: problem.days }, (_, d) => (
              <th key={d}>{d + 1}일차</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: problem.shiftsPerDay }, (_, s) => (
            <tr key={s}>
              <th>{shiftName(s)}</th>
              {Array.from({ length: problem.days }, (_, d) => (
                <td key={d}>{cell(d, s)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
