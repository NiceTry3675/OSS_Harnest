/** 홈 히어로의 흐름 루프 — 제품이 하는 일을 9초에 한 바퀴 보여준다.
 *
 *  기준 잠금 → 회차마다 개선 → 점수로 확인. 세 박자가 하나씩 독립적으로 나오고
 *  다시 처음으로 돌아간다. 장식이지만 지어낸 그림은 아니다 — 실제 흐름 그대로다.
 *
 *  화면 프레임(requestAnimationFrame) 대신 타이머를 쓴다. 탭이 뒤에 있으면
 *  프레임이 멈춰 루프가 어중간한 장면에서 굳어버린다.
 *
 *  움직임을 줄이도록 설정한 사용자에게는 흐름을 글로만 보여준다. */

import { useEffect, useState } from "react";

interface Beat {
  id: string;
  /** 이 박자가 시작하는 시각(ms) */
  at: number;
  label: string;
  note: string;
}

const BEATS: Beat[] = [
  { id: "lock", at: 0, label: "기준 잠금", note: "승인하면 AI도 바꾸지 못합니다" },
  { id: "curve", at: 3000, label: "회차마다 개선", note: "목표에 닿을 때까지 다시 씁니다" },
  { id: "score", at: 6000, label: "점수로 확인", note: "숨긴 질문으로 한 번 더" },
];
const CYCLE = 9000;
const TICK = 40;
/** 마지막 박자에서 숫자가 0에서 100까지 올라가는 데 걸리는 시간 */
const COUNT_MS = 2100;

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function reduced(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function HeroLoop() {
  const [elapsed, setElapsed] = useState(0);
  const [still] = useState(reduced);

  useEffect(() => {
    if (still) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      setElapsed((Date.now() - started) % CYCLE);
    }, TICK);
    return () => window.clearInterval(timer);
  }, [still]);

  if (still) {
    return (
      <div className="flowbox" aria-hidden="true">
        <ol className="flow-still">
          {BEATS.map((b) => (
            <li key={b.id}>
              <strong>{b.label}</strong>
              <span>{b.note}</span>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  let index = 0;
  for (let i = BEATS.length - 1; i >= 0; i--) {
    if (elapsed >= BEATS[i].at) {
      index = i;
      break;
    }
  }
  const beat = BEATS[index];
  const into = elapsed - beat.at;
  const score = Math.round(100 * easeOut(Math.min(1, into / COUNT_MS)));

  return (
    <div className="flowbox" aria-hidden="true">
      {/* key를 바꿔 장면이 바뀔 때마다 CSS 동작을 처음부터 다시 재생시킨다 */}
      <div className="flow-stage" key={beat.id}>
        {beat.id === "lock" && <Lock />}
        {beat.id === "curve" && <Curve />}
        {beat.id === "score" && (
          <div className="flow-score">
            {score}
            <span className="flow-unit">점</span>
          </div>
        )}
      </div>

      <div className="flow-caption" key={`${beat.id}-cap`}>
        <strong>{beat.label}</strong>
        <span>{beat.note}</span>
      </div>

      <div className="flow-rail">
        {BEATS.map((b, i) => (
          <i key={b.id} className={i === index ? "is-on" : undefined} />
        ))}
      </div>
    </div>
  );
}

/** 고리가 내려와 잠기고, 잠긴 순간 빛이 한 번 퍼진다 */
function Lock() {
  return (
    <svg className="flow-art" viewBox="0 0 130 130" role="presentation">
      <defs>
        <linearGradient id="lockBody" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#6ea2ff" />
          <stop offset="1" stopColor="#2f6ae0" />
        </linearGradient>
      </defs>
      <circle className="lock-ring" cx="65" cy="82" r="34" />
      <path className="lock-shackle" d="M46 60V44a19 19 0 0 1 38 0v16" />
      <g className="lock-case">
        <rect x="33" y="60" width="64" height="50" rx="15" fill="url(#lockBody)" />
        <path className="lock-sheen" d="M43 66h44" />
        <circle className="lock-hole" cx="65" cy="80" r="5.5" />
        <path className="lock-hole" d="M65 84.5v9" />
      </g>
    </svg>
  );
}

/** 목표선까지 점수 곡선이 그려지고, 끝점이 그 선에 닿는다 */
function Curve() {
  return (
    <svg className="flow-art" viewBox="0 0 280 140" role="presentation">
      <defs>
        <linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4d8cff" stopOpacity="0.34" />
          <stop offset="1" stopColor="#4d8cff" stopOpacity="0" />
        </linearGradient>
      </defs>

      <path className="curve-grid" d="M16 112h248M16 80h248" />
      <path className="curve-goal" d="M16 30h248" />
      <text className="curve-goal-tag" x="16" y="22">목표</text>

      <path
        className="curve-area"
        d="M18 116 C44 112 52 106 68 102 C92 96 98 90 116 84 C142 75 148 60 168 54 C190 47 200 44 220 40 C244 35 254 38 262 30 L262 116 Z"
      />
      <path
        className="curve-line"
        pathLength={1}
        fill="none"
        d="M18 116 C44 112 52 106 68 102 C92 96 98 90 116 84 C142 75 148 60 168 54 C190 47 200 44 220 40 C244 35 254 38 262 30"
      />
      <circle className="curve-halo" cx="262" cy="30" r="13" />
      <circle className="curve-dot" cx="262" cy="30" r="6.5" />
    </svg>
  );
}
