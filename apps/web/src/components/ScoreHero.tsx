/** 관제실 머리 — 점수를 화면의 주인공으로 세운다.
 *  현재 챔피언 점수를 크게 보여주고, 기준선(라운드 0) 대비 상승폭을 붙인다.
 *  라운드·상태는 부수 정보로 내린다. */

import { useCountUp } from "../lib/useCountUp";

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function ScoreHero({
  score,
  baseline,
  round,
  maxRounds,
  statusLabel,
  running,
}: {
  score: number | null;
  baseline: number | null;
  round: number;
  maxRounds: number;
  statusLabel: string;
  running: boolean;
}) {
  const shown = useCountUp(score);
  const delta = score !== null && baseline !== null ? score - baseline : null;
  const progress = maxRounds > 0 ? Math.min(1, round / maxRounds) : 0;

  return (
    <div className="score-hero">
      <div className="score-hero-main">
        <div className="score-hero-label">현재 점수</div>
        <div className="score-hero-value">
          {shown === null ? (
            <span className="score-hero-empty">—</span>
          ) : (
            <>
              <span className="score-hero-number">{fmt(Math.round(shown * 10) / 10)}</span>
              <span className="score-hero-unit">점</span>
            </>
          )}
          {delta !== null && delta > 0 ? (
            <span className="score-delta">+{fmt(Math.round(delta * 10) / 10)}</span>
          ) : null}
        </div>
        {baseline !== null ? (
          <div className="score-hero-sub">
            처음 만든 산출물은 <strong>{fmt(baseline)}점</strong>이었습니다
          </div>
        ) : (
          <div className="score-hero-sub">아직 채점하지 않았습니다</div>
        )}
      </div>

      <div className="score-hero-side">
        <div className={`run-status${running ? " is-running" : ""}`}>
          {running ? <span className="run-dot" aria-hidden="true" /> : null}
          {statusLabel}
        </div>
        <div className="round-count">
          <strong>{round}</strong>
          <span> / {maxRounds} 회차</span>
        </div>
        <div
          className="round-bar"
          role="progressbar"
          aria-valuenow={round}
          aria-valuemin={0}
          aria-valuemax={maxRounds}
          aria-label="진행한 회차"
        >
          <div className="round-bar-fill" style={{ transform: `scaleX(${progress})` }} />
        </div>
      </div>
    </div>
  );
}
