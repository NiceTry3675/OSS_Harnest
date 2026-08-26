/** 상단 단계 표시 — 템플릿이 선언한 이름과 현재 Pack에 결속된 승인 상태를 보여준다.
 *
 * 이동 제어는 각 화면의 책임이고, 이 컴포넌트는 의미 커서를 표시 단계로 해석하기만 한다. */

import { resolveFlow, useFlowStep } from "../lib/flowStep";
import { readVoice, voiceFlow, voiceQuestions } from "../lib/templateVoice";
import { useProject } from "../state";
import { getTemplate } from "../templates";

export function StepBar() {
  const cursor = useFlowStep();
  const { templateId, compiled, approvedDigest, approvedAt, answers } = useProject();
  const entry = getTemplate(compiled?.pack.templateId ?? templateId);
  // 0단계에서 만든 템플릿으로 들어왔다면 칸 이름을 그 어휘로 부른다 — 칸 자체는 그대로다
  const voice = readVoice(answers);
  const source =
    entry === null
      ? null
      : { questions: voiceQuestions(entry.questions, voice), flow: voiceFlow(entry.flow, voice) };
  const resolved = resolveFlow(source, cursor, {
    definitionDigest: compiled?.pack.definitionDigest ?? null,
    approvedDigest,
    approvedAt,
  });
  if (resolved === null) return null;

  const { steps, index: at, current } = resolved;
  const left = steps.length - 1 - at;

  return (
    <div className="stepbar">
      <ol className="steps-nav">
        {steps.map((step, i) => (
          <li
            key={step.id}
            className={`step${i === at ? " is-now" : ""}${i < at ? " is-past" : ""}`}
            aria-current={i === at ? "step" : undefined}
          >
            <span className="step-num">{i + 1}</span>
            <span className="step-label">{step.label}</span>
          </li>
        ))}
      </ol>
      <span className="step-mobile" aria-label={`${current.label}, ${at + 1}/${steps.length}`}>
        <span className="step-mobile-label">{current.label}</span>
        <span className="step-mobile-count">{at + 1}/{steps.length}</span>
      </span>
      <span className="step-left">
        {left === 0 ? "마지막 단계입니다" : `${left}단계 남았습니다`}
      </span>
      <div
        className="step-bar-fill"
        style={{ transform: `scaleX(${(at + 1) / steps.length})` }}
        aria-hidden="true"
      />
    </div>
  );
}
