/** 실험 기록 — 라운드별 채택/기각 목록. 최신 라운드가 위(관찰 우선).
 *  채택된 라운드만 초록으로 강조하고, 나머지는 조용히 둔다. */

import type { RoundRecord } from "@harnest/contracts";

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function verdict(r: RoundRecord): string {
  if (r.adopted) return "더 나아서 채택";
  return r.gateRejected ? "필수 관문에서 실격" : "기존 산출물이 더 나음";
}

export function ExperimentTree({ tree }: { tree: readonly RoundRecord[] }) {
  // 빈 상태도 목록이 찰 때와 같은 자리를 잡는다 — 실행을 누르는 순간 화면이 튀지 않게
  if (tree.length === 0) {
    return (
      <div className="rounds-empty">
        <p className="hint" style={{ margin: 0 }}>
          기록된 라운드 판정이 없습니다.
        </p>
      </div>
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
