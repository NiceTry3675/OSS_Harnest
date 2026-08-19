"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { criteria } from "@/lib/mock-data";
import { submitApprovedCriteria } from "@/lib/api/client";
import { harnestStorage } from "@/lib/api/storage";
import type { EvaluationSuggestion, InterviewPayload } from "@/lib/api/types";

export default function CriteriaPage() {
  const router = useRouter();
  const [payload, setPayload] = useState<InterviewPayload | null>(null);
  const [suggestion, setSuggestion] = useState<EvaluationSuggestion | null>(null);
  const [isApproving, setIsApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const criteriaItems = suggestion?.criteria ?? criteria;

  useEffect(() => {
    queueMicrotask(() => {
      setPayload(harnestStorage.getInterviewPayload());
      setSuggestion(harnestStorage.getEvaluationSuggestion());
    });
  }, []);

  async function handleApprove() {
    if (!payload) {
      setError("먼저 인터뷰 입력을 완료해야 합니다.");
      return;
    }

    setIsApproving(true);
    setError(null);

    const approvedPayload: InterviewPayload = {
      ...payload,
      evaluation: {
        status: "approved",
        approvedAt: new Date().toISOString(),
        criteria: criteriaItems.map((item) => ({ ...item, locked: true })),
      },
    };

    try {
      const loopSpec = await submitApprovedCriteria(approvedPayload);
      harnestStorage.setInterviewPayload(approvedPayload);
      harnestStorage.setLoopSpec(loopSpec);
      router.push("/run");
    } catch {
      setError("승인된 평가 기준으로 loop spec을 만들지 못했습니다.");
    } finally {
      setIsApproving(false);
    }
  }

  return (
    <AppShell activeStep="criteria">
      <section className="page-frame">
        <div className="panel">
          <div className="panel-header">
            <p className="eyebrow">Criteria approval</p>
            <h1 className="section-title">AI가 바꿀 수 없는 평가 기준을 승인합니다</h1>
          </div>
          <div className="panel-body criteria-grid">
            {criteriaItems.map((item) => (
              <article className="criteria-card" key={item.id}>
                <strong>{item.title}</strong>
                <p className="muted">{item.description}</p>
                <p>
                  {item.kind} / weight {item.weight}
                </p>
              </article>
            ))}
            {error ? <p className="error-text">{error}</p> : null}
            <div className="button-row">
              <span className="status-lock">승인하면 기준 잠김</span>
              <button
                className="primary-button"
                disabled={isApproving}
                onClick={handleApprove}
                type="button"
              >
                {isApproving ? "Loop spec 생성 중" : "기준 승인하고 실행 준비"}
              </button>
            </div>
          </div>
        </div>
        <aside className="panel blueprint">
          <div className="panel-header">
            <p className="eyebrow">Guardrail</p>
            <h2 className="section-title">AI는 산출물만 고치고 기준은 건드릴 수 없습니다</h2>
          </div>
          <div className="panel-body template-grid">
            <div className="blueprint-item">
              <strong>수정 가능</strong>
              <span>자기소개서 문장, 구조, 강조점</span>
            </div>
            <div className="blueprint-item">
              <strong>승인 후 수정 불가</strong>
              <span>평가 기준, 가중치, 종료 조건</span>
            </div>
          </div>
        </aside>
      </section>
    </AppShell>
  );
}
