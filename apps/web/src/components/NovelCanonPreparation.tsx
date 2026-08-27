import { useMemo, useState, type FormEvent } from "react";
import {
  applyCanonAnswers,
  type CanonAnswer,
  type CanonInterview,
  type EvidenceRef,
  type NovelAnalysisDraft,
  type NovelCanon,
} from "@harnest/template-novel";

export interface NovelPreparation {
  analysis: NovelAnalysisDraft;
  interview: CanonInterview;
}

function evidenceLabel(analysis: NovelAnalysisDraft, evidence: EvidenceRef): string {
  const source = analysis.sources.find((item) => item.id === evidence.sourceId);
  return source ? `${source.filename} · “${evidence.quote}”` : `원문 · “${evidence.quote}”`;
}

function RelationGraph({ analysis }: { analysis: NovelAnalysisDraft }) {
  const graph = analysis.relationshipGraph;
  const positions = useMemo(() => {
    const count = Math.max(graph.nodes.length, 1);
    return new Map(graph.nodes.map((node, index) => {
      const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
      return [node.characterId, { x: 200 + Math.cos(angle) * 135, y: 135 + Math.sin(angle) * 86 }];
    }));
  }, [graph.nodes]);
  if (graph.nodes.length === 0) {
    return <p className="novel-empty">자료에서 인물 관계를 찾지 못했습니다. 인터뷰에서 필요한 설정을 보완할 수 있습니다.</p>;
  }
  return (
    <div className="novel-graph" role="img" aria-label="분석된 등장인물 관계 그래프">
      <svg viewBox="0 0 400 270">
        <defs>
          <marker id="novel-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" />
          </marker>
        </defs>
        {graph.edges.map((edge) => {
          const from = positions.get(edge.fromCharacterId);
          const to = positions.get(edge.toCharacterId);
          if (!from || !to) return null;
          return (
            <g key={edge.id}>
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                markerEnd={edge.direction === "directed" ? "url(#novel-arrow)" : undefined}
              />
              <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 5}>{edge.label}</text>
            </g>
          );
        })}
        {graph.nodes.map((node) => {
          const point = positions.get(node.characterId)!;
          return (
            <g key={node.id} className="novel-graph-node">
              <circle cx={point.x} cy={point.y} r="31" />
              <text x={point.x} y={point.y + 4}>{node.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function NovelCanonPreparationView({
  value,
  onBack,
  onComplete,
}: {
  value: unknown;
  onBack: () => void;
  onComplete: (canon: NovelCanon) => void | Promise<void>;
}) {
  const { analysis, interview } = value as NovelPreparation;
  const [answers, setAnswers] = useState<Record<string, CanonAnswer>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patchAnswer = (questionId: string, patch: Partial<CanonAnswer>) => {
    setAnswers((current) => ({
      ...current,
      [questionId]: { ...current[questionId], ...patch, questionId },
    }));
    setError(null);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const canon = await applyCanonAnswers(analysis, interview, Object.values(answers));
      await onComplete(canon);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "설정 답변을 확인해 주세요.");
      setBusy(false);
    }
  }

  return (
    <div className="novel-preparation route-swap">
      <div className="novel-prep-head">
        <div>
          <span className="eyebrow">자료 분석 완료 · 정본화 인터뷰</span>
          <h1>AI가 이해한 이야기를 확정해 주세요</h1>
          <p className="sub">모순과 빈칸을 지금 확인한 뒤, 이 정본을 원고 생성과 모든 평가에 고정합니다.</p>
        </div>
        <div className="novel-stat-row" aria-label="분석 요약">
          <span><b>{analysis.sources.length}</b> 자료</span>
          <span><b>{analysis.characters.length}</b> 인물</span>
          <span><b>{analysis.events.length}</b> 사건</span>
          <span><b>{analysis.issues.length}</b> 확인점</span>
        </div>
      </div>

      <div className="novel-prep-grid">
        <aside className="novel-canon-panel">
          <section className="card">
            <span className="eyebrow">인물 관계</span>
            <h2>관계 그래프</h2>
            <RelationGraph analysis={analysis} />
          </section>
          <section className="card novel-canon-summary">
            <span className="eyebrow">분석된 정본 후보</span>
            <h2>{analysis.work.title?.value ?? "제목 미정"}</h2>
            <p>{analysis.work.premise?.value ?? analysis.world.summary?.value ?? "작품 개요를 자료에서 명확히 찾지 못했습니다."}</p>
            <dl>
              <div><dt>세계 설정</dt><dd>{analysis.world.entities.length}개 항목 · 규칙 {analysis.world.rules.length}개</dd></div>
              <div><dt>확인 가능한 명제</dt><dd>{analysis.claims.length}개</dd></div>
              <div><dt>초고 상태</dt><dd>{analysis.work.draftStatus}</dd></div>
            </dl>
          </section>
        </aside>

        <form className="novel-interview" onSubmit={submit}>
          {interview.questions.length === 0 ? (
            <div className="card">
              <h2>추가로 확인할 충돌이 없습니다</h2>
              <p className="sub">분석된 설정을 그대로 정본으로 확정할 수 있습니다.</p>
            </div>
          ) : interview.questions.map((question, index) => {
            const answer = answers[question.id];
            return (
              <section className="card novel-question" key={question.id}>
                <div className="novel-question-meta">
                  <span className={`badge ${question.priority === "blocking" ? "warn" : "muted"}`}>
                    {question.priority === "blocking" ? "필수 확인" : question.priority === "important" ? "중요" : "선택"}
                  </span>
                  <span>{index + 1}/{interview.questions.length}</span>
                </div>
                <h2>{question.title}</h2>
                <p className="novel-question-copy">{question.question}</p>
                <p className="hint">{question.whyItMatters}</p>

                {question.options.length > 0 ? (
                  <div className="novel-options">
                    {question.options.map((option) => (
                      <label key={option.id} className={answer?.selectedOptionId === option.id ? "is-on" : ""}>
                        <input
                          type="radio"
                          name={question.id}
                          checked={answer?.selectedOptionId === option.id}
                          onChange={() => patchAnswer(question.id, {
                            selectedOptionId: option.id,
                            customAnswer: undefined,
                            leaveUnresolved: false,
                          })}
                        />
                        <span><b>{option.label}</b>{option.description ? <small>{option.description}</small> : null}</span>
                      </label>
                    ))}
                  </div>
                ) : null}

                {question.evidenceGroups.flatMap((group) => group.evidence).length > 0 ? (
                  <details className="novel-evidence">
                    <summary>판단 근거 원문 보기</summary>
                    <ul>{question.evidenceGroups.flatMap((group) => group.evidence).map((item, evidenceIndex) => (
                      <li key={`${item.sourceId}-${item.segmentId}-${evidenceIndex}`}>{evidenceLabel(analysis, item)}</li>
                    ))}</ul>
                  </details>
                ) : null}

                {question.allowCustomAnswer ? (
                  <label className="novel-custom">
                    <span>직접 정본을 설명하기</span>
                    <textarea
                      rows={3}
                      value={answer?.customAnswer ?? ""}
                      placeholder="선택지에 없다면 정확한 설정을 적어주세요."
                      onChange={(event) => patchAnswer(question.id, {
                        customAnswer: event.target.value,
                        selectedOptionId: undefined,
                        leaveUnresolved: false,
                      })}
                    />
                  </label>
                ) : null}

                {question.allowUnresolved ? (
                  <label className="novel-unresolved">
                    <input
                      type="checkbox"
                      checked={answer?.leaveUnresolved ?? false}
                      onChange={(event) => patchAnswer(question.id, {
                        leaveUnresolved: event.target.checked,
                        unresolvedRule: "preserve_ambiguity",
                        ...(event.target.checked ? { selectedOptionId: undefined, customAnswer: undefined } : {}),
                      })}
                    />
                    의도적으로 미정으로 남기고 생성기가 단정하지 못하게 하기
                  </label>
                ) : null}
              </section>
            );
          })}
          {error ? <div className="error">{error}</div> : null}
          <div className="novel-prep-actions">
            <button className="primary" type="submit" disabled={busy}>
              {busy ? "정본을 확정하는 중…" : "이 설정을 정본으로 확정하고 승인 화면으로"}
            </button>
            <button type="button" disabled={busy} onClick={onBack}>자료와 창작 방향 다시 보기</button>
          </div>
        </form>
      </div>
    </div>
  );
}
