/** 실험 기록 — 라운드별 채택/기각 목록. 최신 라운드가 위(관찰 우선).
 *  채택 가지만 본선(li.adopted), 기각은 회색(li.rejected). */

import type { RoundRecord } from "@harnest/contracts";

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function verdict(r: RoundRecord): string {
  if (r.adopted) return "채택";
  return r.gateRejected ? "기각(게이트)" : "기각(미개선)";
}

export function ExperimentTree({ tree }: { tree: readonly RoundRecord[] }) {
  if (tree.length === 0) {
    return (
      <p className="hint" style={{ margin: 0 }}>
        아직 실험 기록이 없습니다. 실행을 시작하면 라운드별 판정이 여기에 쌓입니다.
      </p>
    );
  }

  const latestFirst = [...tree].reverse();

  return (
    <ul className="rounds">
      {latestFirst.map((r) => (
        <li key={r.round} className={`round${r.adopted ? " is-adopted" : ""}`}>
          <span className="round-no">라운드 {r.round}</span>
          <span className="round-say">
            후보 {fmt(r.candidateScore)}점 vs 챔피언 {fmt(r.championScore)}점 → {verdict(r)}
          </span>
        </li>
      ))}
    </ul>
  );
}
