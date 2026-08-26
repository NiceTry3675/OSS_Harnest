/** 개선 곡선 — 단일 시리즈 라인 차트.
 *  y축 하한은 첫 점수를 5점 단위로 내림해 작은 개선도 읽히게 하고, 상한은 100으로 고정한다.
 *  x = 라운드. 마커는 채택 라운드에만(전 점 라벨 금지).
 *  컨테이너 폭을 관찰해 viewBox 폭과 1:1로 맞춘다 — 호버 좌표 변환이 단순해진다. */

import { useEffect, useRef, useState, type MouseEvent } from "react";

interface CurveChartProps {
  /** curve[i] = 라운드 i 종료 시 챔피언 점수 (i=0은 기준선) */
  curve: readonly number[];
  /** 채택된 라운드 번호(= curve 인덱스) */
  adopted?: ReadonlySet<number>;
  /** x축 상한 고정(라이브 뷰의 축 안정용). 생략 시 데이터에 맞춤 */
  xMax?: number;
  /** 실행 중이면 현재 지점을 강조한다 */
  live?: boolean;
}

const H = 300;
const PAD_L = 38;
const PAD_R = 14;
const PAD_T = 14;
const PAD_B = 26;
const SCORE_CEILING = 100;
const SCORE_FLOOR_STEP = 5;
const TITLE = "점수 변화";

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** 첫 점수 아래 가장 가까운 5점 단위를 표시 하한으로 삼는다.
 *  만점에서 시작해도 축 폭이 0이 되지 않도록 최소 한 구간은 남긴다. */
export function scoreDomainFloor(baseline: number): number {
  if (!Number.isFinite(baseline)) return 0;
  const clamped = Math.min(SCORE_CEILING, Math.max(0, baseline));
  return Math.min(
    SCORE_CEILING - SCORE_FLOOR_STEP,
    Math.floor(clamped / SCORE_FLOOR_STEP) * SCORE_FLOOR_STEP,
  );
}

function scoreTicks(domainFloor: number): number[] {
  const span = SCORE_CEILING - domainFloor;
  const step = Math.max(
    SCORE_FLOOR_STEP,
    Math.ceil(span / 4 / SCORE_FLOOR_STEP) * SCORE_FLOOR_STEP,
  );
  const ticks: number[] = [];
  for (let score = domainFloor; score < SCORE_CEILING; score += step) ticks.push(score);
  ticks.push(SCORE_CEILING);
  return ticks;
}

export function CurveChart({ curve, adopted, xMax, live }: CurveChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  const baseline = curve[0];
  const domainFloor = baseline === undefined ? 0 : scoreDomainFloor(baseline);

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
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 12,
        marginBottom: 10,
      }}
    >
      <h2 style={{ margin: 0, fontSize: 14, color: "var(--ink-2)" }}>{TITLE}</h2>
      {baseline !== undefined ? (
        <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
          표시 범위 {domainFloor}–{SCORE_CEILING}점
        </span>
      ) : null}
    </div>
  );

  if (curve.length === 0) {
    return (
      <div ref={wrapRef}>
        {title}
        <div
          style={{
            height: H,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--ink-3)",
            fontSize: 13,
          }}
        >
          실행을 시작하면 점수가 여기에 그려집니다
        </div>
      </div>
    );
  }

  const lastRound = curve.length - 1;
  const domainMax = Math.max(1, xMax ?? lastRound, lastRound);
  const plotW = Math.max(1, width - PAD_L - PAD_R);
  const plotH = H - PAD_T - PAD_B;
  const x = (round: number) => PAD_L + (round / domainMax) * plotW;
  const y = (score: number) =>
    PAD_T + ((SCORE_CEILING - score) / (SCORE_CEILING - domainFloor)) * plotH;

  const points = curve.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  // 시작 점수와 현재 점수 사이를 칠해, 얼마나 올라왔는지가 면적으로 보이게 한다
  const current = curve[lastRound];
  const gained = current > baseline;
  const areaPoints = `${points} ${x(lastRound)},${y(baseline)} ${x(0)},${y(baseline)}`;
  const yTicks = scoreTicks(domainFloor);
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
        aria-label={`${TITLE}, 표시 범위 ${domainFloor}점부터 ${SCORE_CEILING}점`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {yTicks.map((v) => (
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
        {yTicks.map((v) => (
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
        {gained && (
          <polygon points={areaPoints} fill="var(--chart-line)" fillOpacity={0.1} />
        )}
        <line
          x1={PAD_L}
          x2={PAD_L + plotW}
          y1={y(baseline)}
          y2={y(baseline)}
          stroke="var(--ink-3)"
          strokeWidth={1}
          strokeDasharray="4 4"
        />
        <text
          x={PAD_L + 4}
          y={y(baseline) - 6}
          fontSize={11}
          fill="var(--ink-3)"
        >
          시작 {fmt(baseline)}점
        </text>
        <polyline
          points={points}
          fill="none"
          stroke="var(--chart-line)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {curve.map((v, i) =>
          adopted?.has(i) && i !== lastRound ? (
            <circle key={i} cx={x(i)} cy={y(v)} r={4} fill="var(--chart-line)" />
          ) : null,
        )}
        {/* 현재 지점 — 실행 중에는 맥박이 함께 퍼진다 */}
        {live && (
          <circle className="curve-now-halo" cx={x(lastRound)} cy={y(current)} r={5} fill="var(--chart-line)" />
        )}
        <circle
          cx={x(lastRound)}
          cy={y(current)}
          r={5}
          fill="var(--chart-line)"
          stroke="var(--surface)"
          strokeWidth={2}
        />
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
            {hover === 0 ? "시작" : `${hover}회차`}
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
