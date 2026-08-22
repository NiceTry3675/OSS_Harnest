/** 개선 곡선 — 단일 시리즈 라인 차트.
 *  y 도메인 [0,100] 고정, x = 라운드. 마커는 채택 라운드에만(전 점 라벨 금지).
 *  컨테이너 폭을 관찰해 viewBox 폭과 1:1로 맞춘다 — 호버 좌표 변환이 단순해진다. */

import { useEffect, useRef, useState, type MouseEvent } from "react";

interface CurveChartProps {
  /** curve[i] = 라운드 i 종료 시 챔피언 점수 (i=0은 기준선) */
  curve: readonly number[];
  /** 채택된 라운드 번호(= curve 인덱스) */
  adopted?: ReadonlySet<number>;
  /** x축 상한 고정(라이브 뷰의 축 안정용). 생략 시 데이터에 맞춤 */
  xMax?: number;
}

const H = 220;
const PAD_L = 38;
const PAD_R = 14;
const PAD_T = 14;
const PAD_B = 26;
const GRID_VALUES = [25, 50, 75, 100];
const TITLE = "개선 곡선 — 라운드별 챔피언 점수";

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function CurveChart({ curve, adopted, xMax }: CurveChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(Math.max(280, Math.floor(w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const title = (
    <h2 style={{ margin: "0 0 10px", fontSize: 14, color: "var(--ink-2)" }}>{TITLE}</h2>
  );

  if (curve.length <= 1) {
    return (
      <div ref={wrapRef}>
        {title}
        <div
          style={{
            height: 120,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--ink-3)",
            fontSize: 13,
          }}
        >
          실행하면 곡선이 그려집니다
        </div>
      </div>
    );
  }

  const lastRound = curve.length - 1;
  const domainMax = Math.max(1, xMax ?? lastRound, lastRound);
  const plotW = Math.max(1, width - PAD_L - PAD_R);
  const plotH = H - PAD_T - PAD_B;
  const x = (round: number) => PAD_L + (round / domainMax) * plotW;
  const y = (score: number) => PAD_T + (1 - score / 100) * plotH;

  const points = curve.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const tickStep = Math.max(1, Math.ceil(domainMax / 6));
  const ticks: number[] = [];
  for (let t = 0; t <= domainMax; t += tickStep) ticks.push(t);
  if (ticks[ticks.length - 1] !== domainMax) ticks.push(domainMax);

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const round = Math.round(((mx - PAD_L) / plotW) * domainMax);
    setHover(Math.min(lastRound, Math.max(0, round)));
  };

  const hoverScore = hover !== null ? curve[hover] : null;

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      {title}
      <svg
        viewBox={`0 0 ${width} ${H}`}
        width="100%"
        height={H}
        role="img"
        aria-label={TITLE}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {GRID_VALUES.map((v) => (
          <line
            key={v}
            x1={PAD_L}
            x2={PAD_L + plotW}
            y1={y(v)}
            y2={y(v)}
            stroke="var(--chart-grid)"
            strokeWidth={1}
          />
        ))}
        <line
          x1={PAD_L}
          x2={PAD_L + plotW}
          y1={y(0)}
          y2={y(0)}
          stroke="var(--ink-3)"
          strokeWidth={1}
        />
        {[0, 50, 100].map((v) => (
          <text
            key={v}
            x={PAD_L - 6}
            y={y(v) + 4}
            textAnchor="end"
            fontSize={12}
            fill="var(--ink-3)"
          >
            {v}
          </text>
        ))}
        {ticks.map((t) => (
          <text
            key={t}
            x={x(t)}
            y={H - 8}
            textAnchor="middle"
            fontSize={12}
            fill="var(--ink-3)"
          >
            {t}
          </text>
        ))}
        {hover !== null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={PAD_T}
            y2={PAD_T + plotH}
            stroke="var(--ink-3)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}
        <polyline
          points={points}
          fill="none"
          stroke="var(--chart-line)"
          strokeWidth={2}
        />
        {curve.map((v, i) =>
          adopted?.has(i) ? (
            <circle key={i} cx={x(i)} cy={y(v)} r={4} fill="var(--chart-line)" />
          ) : null,
        )}
      </svg>
      {hover !== null && hoverScore !== null && hoverScore !== undefined && (
        <div
          style={{
            position: "absolute",
            left: Math.min(x(hover) + 10, width - 150),
            top: 40,
            pointerEvents: "none",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "4px 9px",
            fontSize: 12,
            color: "var(--ink)",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ color: "var(--ink-2)" }}>
            {hover === 0 ? "기준선(라운드 0)" : `라운드 ${hover}`}
          </span>{" "}
          · {fmt(hoverScore)}점
          {hover !== 0 && (
            <span style={{ color: "var(--ink-2)" }}>
              {" "}
              · {adopted?.has(hover) ? "채택" : "미채택"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
