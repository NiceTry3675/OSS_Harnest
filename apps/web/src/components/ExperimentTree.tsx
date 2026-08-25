/** 실험 기록 — 라운드별 채택/기각 목록. 최신 라운드가 위(관찰 우선).
 *  채택된 라운드만 초록으로 강조하고, 나머지는 조용히 둔다. */

import type { RoundRecord } from "@harnest/contracts";

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function verdict(r: RoundRecord): string {
  if (r.adopted) return "더 나아서 채택";
  return r.gateRejected ? "필수 조건을 못 지켜 탈락" : "지금 것이 더 나음";
}

export function ExperimentTree({ tree }: { tree: readonly RoundRecord[] }) {
  if (tree.length === 0) {
    return (
      <p className="hint" style={{ margin: 0 }}>
        기록된 라운드 판정이 없습니다.
      </p>
    );
  }

  const latestFirst = [...tree].reverse();

  return (
    <ul className="rounds">
      {latestFirst.map((r) => (
        <li
          key={r.round}
          className={`round${r.adopted ? " is-adopted" : ""}`}
          title={`후보 ${fmt(r.candidateScore)}점 vs 챔피언 ${fmt(r.championScore)}점`}
        >
          <span className="round-no">{r.round}회차</span>
          <span className="round-say">{verdict(r)}</span>
          <span className="round-score">{fmt(r.candidateScore)}</span>
        </li>
      ))}
    </ul>
  );
}
