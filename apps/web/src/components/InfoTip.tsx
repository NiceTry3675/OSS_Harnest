import { useId, useRef, useState } from "react";

export function InfoTip({ label, text }: { label: string; text: string }) {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 280 });

  function positionTooltip() {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const gap = 8;
    const pageMargin = 16;
    const availableWidth = window.innerWidth - rect.right - gap - pageMargin;
    setPosition({
      left: rect.right + gap,
      top: rect.top + rect.height / 2,
      width: Math.min(340, Math.max(80, availableWidth)),
    });
  }

  return (
    <span className="info-tip" onMouseEnter={positionTooltip} onFocus={positionTooltip}>
      <button
        ref={triggerRef}
        type="button"
        className="info-tip-trigger"
        aria-label={`${label} 설명 보기`}
        aria-describedby={tooltipId}
      >
        i
      </button>
      <span id={tooltipId} role="tooltip" className="info-tip-content" style={position}>
        {text}
      </span>
    </span>
  );
}
