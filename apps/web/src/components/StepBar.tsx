/** 상단 단계 표시 — 지금 어디쯤인지, 얼마나 남았는지 항상 보이게 한다.
 *
 *  앞 단계로 건너뛰는 것은 막는다. 승인 전에 관제실로 들어가는 식의 이동은
 *  각 화면이 다시 막아야 하므로, 여기서는 표시만 담당한다. */

import { useLocation } from "react-router-dom";

const STEPS = [
  { path: "/", label: "시작" },
  { path: "/wizard", label: "입력" },
  { path: "/approve", label: "승인" },
  { path: "/console", label: "실행" },
  { path: "/results", label: "결과" },
] as const;

export function StepBar() {
  const { pathname } = useLocation();
  const at = STEPS.findIndex((s) => s.path === pathname);
  if (at < 0) return null;

  const left = STEPS.length - 1 - at;

  return (
    <div className="stepbar">
      <ol className="steps-nav">
        {STEPS.map((s, i) => (
          <li
            key={s.path}
            className={`step${i === at ? " is-now" : ""}${i < at ? " is-past" : ""}`}
            aria-current={i === at ? "step" : undefined}
          >
            <span className="step-num">{i + 1}</span>
            <span className="step-label">{s.label}</span>
          </li>
        ))}
      </ol>
      <span className="step-left">
        {left === 0 ? "마지막 단계입니다" : `${left}단계 남았습니다`}
      </span>
      <div
        className="step-bar-fill"
        style={{ transform: `scaleX(${(at + 1) / STEPS.length})` }}
        aria-hidden="true"
      />
    </div>
  );
}
