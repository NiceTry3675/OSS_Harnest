/** 상단 단계 표시 — 지금 어디쯤인지, 얼마나 남았는지 항상 보이게 한다.
 *
 *  칸은 화면보다 잘다. 입력 화면이 자료·질문·모델 세 칸, 승인 화면이 검증·잠금 두 칸이라
 *  각 화면이 flowStep으로 자기 칸을 알린다. 앞 칸으로 건너뛰는 것은 막는다 —
 *  승인 없이 실행으로 들어가는 이동은 각 화면이 다시 막아야 하므로 여기서는 표시만 한다. */

import { FLOW_STEPS, useFlowStep } from "../lib/flowStep";

export function StepBar() {
  const at = useFlowStep();
  if (at < 0) return null;

  const left = FLOW_STEPS.length - 1 - at;

  return (
    <div className="stepbar">
      <ol className="steps-nav">
        {FLOW_STEPS.map((label, i) => (
          <li
            key={label}
            className={`step${i === at ? " is-now" : ""}${i < at ? " is-past" : ""}`}
            aria-current={i === at ? "step" : undefined}
          >
            <span className="step-num">{i + 1}</span>
            <span className="step-label">{label}</span>
          </li>
        ))}
      </ol>
      <span className="step-left">
        {left === 0 ? "마지막 단계입니다" : `${left}단계 남았습니다`}
      </span>
      <div
        className="step-bar-fill"
        style={{ transform: `scaleX(${(at + 1) / FLOW_STEPS.length})` }}
        aria-hidden="true"
      />
    </div>
  );
}
