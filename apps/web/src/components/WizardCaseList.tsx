/** 케이스 편집기 — caseList 질문 타입의 {질문, 답} 쌍 목록 입력.
 *  id는 compile이 부여하므로 여기서는 질문·답 텍스트만 수집한다. */

import type { CSSProperties } from "react";

export interface CasePair {
  question: string;
  expectedAnswer: string;
}

/** styles.css의 input과 같은 결 — textarea 전역 스타일이 없어 여기서 공유한다 */
export const textareaStyle: CSSProperties = {
  font: "inherit",
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--ink)",
  resize: "vertical",
};

export function WizardCaseList({
  pairs,
  minPairs,
  maxPairs,
  onChange,
}: {
  pairs: CasePair[];
  minPairs: number;
  maxPairs: number;
  onChange: (next: CasePair[]) => void;
}) {
  const update = (i: number, patch: Partial<CasePair>) =>
    onChange(pairs.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  return (
    <div>
      {pairs.map((p, i) => (
        <div key={i} className="card" style={{ background: "var(--bg)", padding: "12px 14px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 6,
            }}
          >
            <span className="badge muted">쌍 {i + 1}</span>
            <button
              type="button"
              style={{ fontSize: 12, padding: "4px 10px" }}
              disabled={pairs.length <= 1}
              onClick={() => onChange(pairs.filter((_, j) => j !== i))}
            >
              삭제
            </button>
          </div>
          <div className="field" style={{ marginBottom: 8 }}>
            <label htmlFor={`case-q-${i}`}>실제로 받았던 질문</label>
            <textarea
              id={`case-q-${i}`}
              rows={2}
              style={textareaStyle}
              value={p.question}
              onChange={(e) => update(i, { question: e.target.value })}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor={`case-a-${i}`}>그때 해준 답</label>
            <textarea
              id={`case-a-${i}`}
              rows={3}
              style={textareaStyle}
              value={p.expectedAnswer}
              onChange={(e) => update(i, { expectedAnswer: e.target.value })}
            />
          </div>
        </div>
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button
          type="button"
          disabled={pairs.length >= maxPairs}
          onClick={() => onChange([...pairs, { question: "", expectedAnswer: "" }])}
        >
          질문 추가
        </button>
        <span className="hint" style={{ marginTop: 0 }}>
          {minPairs}~{maxPairs}질문과 답을 입력하세요.
        </span>
      </div>
    </div>
  );
}
