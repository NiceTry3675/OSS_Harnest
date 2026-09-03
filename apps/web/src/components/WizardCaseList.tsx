/** 케이스 편집기 — caseList 질문 타입의 {질문, 답} 쌍 목록 입력.
 *  id는 compile이 부여하므로 여기서는 질문·답 텍스트만 수집한다.
 *
 *  입력 방식: 위 입력줄에 질문과 답을 함께 넣고 추가한다. 한 쌍이 한 번에 들어가야
 *  답이 빈 채로 쌓이지 않는다. 추가한 뒤에도 카드 안에서 그대로 고칠 수 있다.
 *
 *  쌍마다 용도가 있다: 매 회차 채점해 판정 내용을 개선에 쓰는 개선용, 매 회차 합계만 채택 판단에
 *  쓰는 중간 점검용, 개선에 쓰지 않고 실행 시작·종료에만 채점하는 최종 확인용. 어떤 쌍이 어느
 *  용도인지 입력하는 동안 보이지 않으면 결과 화면에서 갑자기 튀어나오므로 세 용도 모두 배지로 미리
 *  표시한다 — 단, 분할 산식은 템플릿의 것이라 여기서 흉내 내지 않고 compile 결과(holdoutPolicy)를
 *  되돌린 용도(uses)를 받아 그대로 보인다. */

import { useRef, useState } from "react";
import type { CaseUse } from "../lib/caseSplit";

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

/** 펼쳐 둘 쌍 — 확인이 필요한 것과 손으로 펼친 것만 편집면을 연다 */
function useOpenRows() {
  const [opened, setOpened] = useState<ReadonlySet<number>>(new Set());
  const toggle = (i: number) =>
    setOpened((current) => {
      const next = new Set(current);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  return { opened, toggle };
}

export function WizardCaseList({
  pairs,
  minPairs,
  maxPairs,
  uses = null,
  split = null,
  describedBy,
  onChange,
}: {
  pairs: CasePair[];
  minPairs: number;
  maxPairs: number;
  /** compile 결과에서 되돌린 쌍별 용도 — 아직 계산되지 않았으면 null(배지 없음) */
  uses?: Array<CaseUse | null> | null;
  /** 용도별 개수(pack 기준) — 안내 문구용 */
  split?: { holdout: number; guard: number } | null;
  /** 검증 실패 문구의 id — 입력줄에 aria-describedby로 건다 */
  describedBy?: string;
  onChange: (next: CasePair[]) => void;
}) {
  const { opened, toggle } = useOpenRows();
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

  // 근거 인용 안내는 인용이 있는 첫 카드에서 한 번만 보여준다 — 카드마다 반복하면 소음이다
  const firstEvidenceIdx = pairs.findIndex((p) => p.evidence !== undefined && p.evidence.length > 0);

  // 최소 개수를 채우기 전에는 compile이 실패하므로 어느 것이 어떤 용도인지 정해지지 않는다
  const settled = pairs.length >= minPairs;
  // 개선용 개수는 pack이 따로 세지 않는다 — 되돌린 용도에서 센다(제출되지 않는 쌍은 어느 용도도 아니다)
  const visibleCount = uses === null ? 0 : uses.filter((use) => use === "visible").length;

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
            aria-invalid={describedBy !== undefined || undefined}
            aria-describedby={describedBy}
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
        {uses !== null && split !== null
          ? `질문마다 용도를 표시합니다. 개선용 ${visibleCount}개는 매 회차 채점해 판정 내용을 결과물 개선에 쓰고, 중간 점검용 ${split.guard}개는 매 회차 합계 점수만 채택 판단에 쓰며, 최종 확인용 ${split.holdout}개는 개선에 쓰지 않고 시작할 때와 끝날 때만 채점합니다. 어떤 질문이 어느 용도인지는 평가 구성이 정하며, 질문을 고치거나 순서를 바꾸면 다시 정해질 수 있습니다.`
          : settled
            ? pairs.some((p) => p.needsConfirm)
              ? "초안을 확인하면 질문마다 용도(개선용·중간 점검용·최종 확인용)가 정해집니다."
              : "질문마다 용도(개선용·중간 점검용·최종 확인용)를 정하는 중…"
            : `${minPairs}개를 채우면 질문마다 용도(개선용·중간 점검용·최종 확인용)가 정해집니다.`}{" "}
        Shift+Enter로 줄바꿈.
      </p>

      <div className="q-list" style={{ marginTop: 16 }}>
        {pairs.map((p, i) => {
          const use = uses?.[i] ?? null;
          return (
            <div key={i}>
              <div
                className={`q-item${use === "holdout" ? " is-hidden" : use === "guard" ? " is-guard" : ""}${
                  opened.has(i) || p.needsConfirm ? "" : " is-folded"
                }`}
              >
                <div className="q-top">
                  <span className="q-no">{i + 1}</span>
                  {use === "holdout" ? (
                    <span className="badge muted" title="개선에 쓰지 않고 시작할 때와 끝날 때만 채점합니다">
                      숨김 · 최종 확인용
                    </span>
                  ) : use === "guard" ? (
                    <span className="badge muted" title="매 회차 채점하되 합계 점수만 채택 판단에 씁니다">
                      중간 점검용
                    </span>
                  ) : use === "visible" ? (
                    <span className="badge muted" title="매 회차 채점하고 판정 내용을 결과물 개선에 씁니다">
                      개선용
                    </span>
                  ) : null}
                  {p.needsConfirm ? (
                    <span className="badge">확인 필요</span>
                  ) : p.provenance === "ai" ? (
                    <span className="badge muted">AI 초안</span>
                  ) : p.provenance === "ai_edited" ? (
                    <span className="badge muted">AI 초안·수정</span>
                  ) : null}
                  {/* 접혔을 때는 질문이 제목 노릇을 한다 — 무엇에 관한 쌍인지 한 줄로 안다 */}
                  {!p.needsConfirm && !opened.has(i) ? (
                    <button type="button" className="q-peek" onClick={() => toggle(i)}>
                      {p.question.trim() || "질문이 비어 있습니다"}
                    </button>
                  ) : null}
                  <span className="q-acts">
                    {p.needsConfirm ? (
                      <button type="button" className="primary" onClick={() => confirm(i)}>
                        확인
                      </button>
                    ) : (
                      <button type="button" onClick={() => toggle(i)}>
                        {opened.has(i) ? "접기" : "수정"}
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={`${i + 1}번째 질문 지우기`}
                      onClick={() => onChange(pairs.filter((_, j) => j !== i))}
                    >
                      지우기
                    </button>
                  </span>
                </div>

                {opened.has(i) || p.needsConfirm ? (
                  <>
                <div className="q-fields">
                  <div className="pair-field">
                    <label htmlFor={`edit-q-${i}`}>질문</label>
                    <textarea
                      id={`edit-q-${i}`}
                      rows={2}
                      value={p.question}
                      placeholder="질문을 입력해 주세요"
                      onChange={(e) => update(i, { question: e.target.value })}
                    />
                  </div>
                  <div className="pair-field">
                    <label htmlFor={`edit-a-${i}`}>답</label>
                    <textarea
                      id={`edit-a-${i}`}
                      rows={3}
                      value={p.expectedAnswer}
                      placeholder="답을 입력해 주세요"
                      onChange={(e) => update(i, { expectedAnswer: e.target.value })}
                    />
                  </div>
                </div>
                {p.evidence !== undefined && p.evidence.length > 0 ? (
                  <div style={{ marginTop: 10, paddingLeft: 30 }}>
                    {i === firstEvidenceIdx ? (
                      <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 4 }}>
                        초안이 근거로 삼은 자료 대목 — 확인할 때 실제 자료와 맞는지 훑어보세요.
                      </div>
                    ) : null}
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
                  </>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
