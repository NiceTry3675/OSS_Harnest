/** 케이스 편집기 — caseList 질문 타입의 {질문, 답} 쌍 목록 입력.
 *  id는 compile이 부여하므로 여기서는 질문·답 텍스트만 수집한다. */

import type { CSSProperties } from "react";

export interface CasePair {
  question: string;
  expectedAnswer: string;
  /** 케이스 출처 — 생략 = 직접 입력. AI 초안을 수정하면 "ai_edited"로 승격된다 */
  provenance?: "user" | "ai" | "ai_edited";
  /** AI 초안 미확인 — 확인 전에는 스텝 검증에 걸리고 answers에 절대 실리지 않는다 */
  needsConfirm?: boolean;
  /** 멀티홉 초안의 근거 인용 — 확인용 표시 전용. toAnswers가 싣지 않아 제출·다이제스트에
   *  절대 유입되지 않는다. found=false는 원료에서 인용을 찾지 못했다는 경고 신호. */
  evidence?: Array<{ quote: string; found: boolean }>;
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
    onChange(
      pairs.map((p, j) => {
        if (j !== i) return p;
        const next = { ...p, ...patch };
        // AI 초안의 텍스트가 수정되면 출처를 "ai_edited"로 승격 — 확인 여부와 무관
        if (p.provenance === "ai") next.provenance = "ai_edited";
        return next;
      }),
    );

  // 확인 = needsConfirm 제거. 이 순간부터 쌍이 제출 대상이 되고 채점 정답으로 동결될 수 있다
  const confirm = (i: number) =>
    onChange(
      pairs.map((p, j) => {
        if (j !== i) return p;
        const { needsConfirm: _dropped, ...rest } = p;
        return rest;
      }),
    );

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
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="badge muted">쌍 {i + 1}</span>
              {p.needsConfirm ? (
                <span className="badge">확인 필요</span>
              ) : p.provenance === "ai" ? (
                <span className="badge muted">AI 초안</span>
              ) : p.provenance === "ai_edited" ? (
                <span className="badge muted">AI 초안·수정</span>
              ) : null}
            </span>
            <span style={{ display: "flex", gap: 6 }}>
              {p.needsConfirm ? (
                <button
                  type="button"
                  className="primary"
                  style={{ fontSize: 12, padding: "4px 10px" }}
                  onClick={() => confirm(i)}
                >
                  확인
                </button>
              ) : null}
              <button
                type="button"
                style={{ fontSize: 12, padding: "4px 10px" }}
                disabled={pairs.length <= 1}
                onClick={() => onChange(pairs.filter((_, j) => j !== i))}
              >
                삭제
              </button>
            </span>
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
            <label htmlFor={`case-a-${i}`}>그때의 답</label>
            <textarea
              id={`case-a-${i}`}
              rows={3}
              style={textareaStyle}
              value={p.expectedAnswer}
              onChange={(e) => update(i, { expectedAnswer: e.target.value })}
            />
          </div>
          {p.evidence !== undefined && p.evidence.length > 0 ? (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 4 }}>
                초안이 근거로 삼은 자료 대목 — 확인할 때 실제 자료와 맞는지 훑어보세요.
              </div>
              {p.evidence.map((e, k) => (
                <div
                  key={k}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 6,
                    fontSize: 12,
                    color: "var(--ink-2)",
                    padding: "2px 0",
                  }}
                >
                  {!e.found ? <span className="badge">자료에서 찾을 수 없음</span> : null}
                  <span style={{ fontStyle: "italic" }}>“{e.quote}”</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button
          type="button"
          disabled={pairs.length >= maxPairs}
          onClick={() => onChange([...pairs, { question: "", expectedAnswer: "" }])}
        >
          쌍 추가
        </button>
        <span className="hint" style={{ marginTop: 0 }}>
          {minPairs}~{maxPairs}쌍을 입력하세요.
        </span>
      </div>
    </div>
  );
}
