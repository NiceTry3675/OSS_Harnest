/** 케이스 편집기 — caseList 질문 타입의 {질문, 답} 쌍 목록 입력.
 *  id는 compile이 부여하므로 여기서는 질문·답 텍스트만 수집한다.
 *
 *  입력 방식: 위 입력줄에 질문과 답을 함께 넣고 추가한다. 한 쌍이 한 번에 들어가야
 *  답이 빈 채로 쌓이지 않는다. 추가한 뒤에도 카드 안에서 그대로 고칠 수 있다.
 *
 *  뒤쪽 몇 개는 개선·채택 과정에서 숨기고 실행 시작·종료에만 별도 채점한다. 어떤 것이
 *  그렇게 되는지 입력하는 동안 보이지 않으면 결과 화면에서 갑자기 튀어나오므로 미리 표시한다.
 *  다만 최소 개수를 채우기 전에는 분할이 확정되지 않으므로 표시하지 않는다. */

import { useRef, useState } from "react";

export interface CasePair {
  question: string;
  expectedAnswer: string;
  /** 케이스 출처 — 생략 = 직접 입력. AI 초안을 수정하면 "ai_edited"로 승격된다 */
  provenance?: "user" | "ai" | "ai_edited";
  /** AI 초안 미확인 — 확인 전에는 스텝 검증에 걸리고 answers에 절대 실리지 않는다 */
  needsConfirm?: boolean;
  /** 멀티홉 초안의 근거 인용 — 확인용 표시 전용. toAnswers가 싣지 않아 제출·다이제스트에
   *  절대 유입되지 않는다. found=false는 글자 그대로 일치를 확인하지 못했다는 낮은 확신의 경고. */
  evidence?: Array<{ quote: string; found: boolean }>;
}

/** 템플릿의 홀드아웃 분할과 같은 식 — 뒤에서 이만큼이 숨겨진다 */
function hiddenCount(n: number): number {
  return n === 0 ? 0 : Math.max(1, Math.floor(n / 3));
}

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
  const [q, setQ] = useState("");
  const [a, setA] = useState("");
  const qRef = useRef<HTMLTextAreaElement>(null);
  const aRef = useRef<HTMLTextAreaElement>(null);

  const full = pairs.length >= maxPairs;

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

  const add = () => {
    const question = q.trim();
    const answer = a.trim();
    if (!question || !answer || full) return;
    onChange([...pairs, { question, expectedAnswer: answer }]);
    setQ("");
    setA("");
    qRef.current?.focus();
  };

  // 최소 개수를 채우기 전에는 어느 것이 숨겨질지 확정되지 않는다
  const settled = pairs.length >= minPairs;
  const hidden = settled ? hiddenCount(pairs.length) : 0;
  const hideFrom = pairs.length - hidden;

  return (
    <div>
      <div className="pair-input">
        <div className="pair-field">
          <label htmlFor="new-q">실제로 받았던 질문</label>
          <textarea
            id="new-q"
            ref={qRef}
            rows={2}
            value={q}
            disabled={full}
            placeholder="예: 월 마감은 며칠까지 끝내야 하나요?"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                aRef.current?.focus();
              }
            }}
          />
        </div>
        <div className="pair-field">
          <label htmlFor="new-a">그때 당신이 한 답</label>
          <textarea
            id="new-a"
            ref={aRef}
            rows={2}
            value={a}
            disabled={full}
            placeholder="예: 5영업일까지. 1~2일 세금계산서 수집, 3일 전표 등록…"
            onChange={(e) => setA(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                add();
              }
            }}
          />
        </div>
        <button type="button" className="primary pair-add" disabled={full || !q.trim() || !a.trim()} onClick={add}>
          추가
        </button>
      </div>

      <p className="hint" style={{ marginTop: 8 }}>
        {minPairs}~{maxPairs}개.{" "}
        {settled
          ? `지금은 뒤에서 ${hidden}개가 개선 과정에 숨겨지고 시작·종료 시에만 별도 채점됩니다.`
          : `${minPairs}개를 채우면 뒤쪽 몇 개가 숨겨질지 정해집니다.`}{" "}
        Shift+Enter로 줄바꿈.
      </p>

      <div className="q-list" style={{ marginTop: 16 }}>
        {pairs.map((p, i) => {
          const isHidden = settled && i >= hideFrom;
          return (
            <div key={i}>
              {settled && i === hideFrom ? (
                <div className="hide-mark">
                  여기부터는 개선 과정에 숨기고 시작·종료 시에만 별도 채점합니다
                </div>
              ) : null}

              <div className={`q-item${isHidden ? " is-hidden" : ""}`}>
                <div className="q-top">
                  <span className="q-no">{i + 1}</span>
                  <span className="q-text">{p.question || "(질문이 비어 있습니다)"}</span>
                  {isHidden ? <span className="badge muted">숨김</span> : null}
                  {p.needsConfirm ? (
                    <span className="badge">확인 필요</span>
                  ) : p.provenance === "ai" ? (
                    <span className="badge muted">AI 초안</span>
                  ) : p.provenance === "ai_edited" ? (
                    <span className="badge muted">AI 초안·수정</span>
                  ) : null}
                  <span className="q-acts">
                    {p.needsConfirm ? (
                      <button type="button" className="primary" onClick={() => confirm(i)}>
                        확인
                      </button>
                    ) : null}
                    <button
                      type="button"
                      aria-label={`${i + 1}번째 질문 지우기`}
                      onClick={() => onChange(pairs.filter((_, j) => j !== i))}
                    >
                      지우기
                    </button>
                  </span>
                </div>

                <details className="q-edit">
                  <summary>고치기</summary>
                  <div className="pair-field">
                    <label htmlFor={`edit-q-${i}`}>질문</label>
                    <textarea
                      id={`edit-q-${i}`}
                      rows={2}
                      value={p.question}
                      onChange={(e) => update(i, { question: e.target.value })}
                    />
                  </div>
                  <div className="pair-field">
                    <label htmlFor={`edit-a-${i}`}>답</label>
                    <textarea
                      id={`edit-a-${i}`}
                      rows={3}
                      value={p.expectedAnswer}
                      onChange={(e) => update(i, { expectedAnswer: e.target.value })}
                    />
                  </div>
                </details>

                {p.expectedAnswer.trim() ? (
                  <p className="q-ans">{p.expectedAnswer}</p>
                ) : (
                  <p className="q-ans q-ans-empty">답이 비어 있습니다 — 고치기를 눌러 채워주세요.</p>
                )}
                {p.evidence !== undefined && p.evidence.length > 0 ? (
                  <div style={{ marginTop: 10, paddingLeft: 30 }}>
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
                        {!e.found ? (
                          <span
                            className="badge"
                            title="공백·구두점 차이를 무시하고 대조했지만 자료에서 같은 대목을 찾지 못했습니다 — 실제 자료와 직접 비교해 주세요."
                          >
                            자료와 그대로 일치하지 않음
                          </span>
                        ) : null}
                        <span style={{ fontStyle: "italic" }}>“{e.quote}”</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
