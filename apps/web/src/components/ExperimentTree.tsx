/** 실험 기록 — 라운드별 채택/기각 목록. 최신 라운드가 위(관찰 우선).
 *  채택 가지만 본선(li.adopted), 기각은 회색(li.rejected). */

import type { RoundRecord } from "@harnest/contracts";

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function verdict(r: RoundRecord): string {
  if (r.adopted) return "채택";
  return r.gateRejected ? "탈락 — 지켜야 할 조건을 어김" : "안 바꿈 — 점수가 오르지 않음";
}

export function ExperimentTree({ tree }: { tree: readonly RoundRecord[] }) {
  if (tree.length === 0) {
    return (
      <p style={{ color: "var(--ink-3)", fontSize: 13, margin: 0 }}>
        아직 기록이 없습니다. 실행을 시작하면 고칠 때마다 결과가 여기에 쌓입니다.
      </p>
    );
  }

  const latestFirst = [...tree].reverse();

  return (
    <ul className="tree" style={{ maxHeight: 280, overflowY: "auto" }}>
      {latestFirst.map((r) => (
        <li key={r.round} className={r.adopted ? "adopted" : "rejected"}>
          {r.round}번째 고침 — 새 문서 {fmt(r.candidateScore)}점 · 기존 최고 {fmt(r.championScore)}점 →{" "}
          {verdict(r)}
        </li>
      ))}
    </ul>
  );
}
