import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { criteria } from "@/lib/mock-data";

export default function CriteriaPage() {
  return (
    <AppShell activeStep="criteria">
      <section className="page-frame">
        <div className="panel">
          <div className="panel-header">
            <p className="eyebrow">Criteria approval</p>
            <h1 className="section-title">AI가 바꿀 수 없는 평가 기준을 승인합니다</h1>
          </div>
          <div className="panel-body criteria-grid">
            {criteria.map((item) => (
              <article className="criteria-card" key={item.id}>
                <strong>{item.title}</strong>
                <p className="muted">{item.description}</p>
                <p>
                  {item.kind} / weight {item.weight}
                </p>
              </article>
            ))}
            <div className="button-row">
              <span className="status-lock">평가 기준 잠김</span>
              <Link className="primary-button" href="/run">
                실행 관제실로 이동
              </Link>
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
              <strong>수정 불가</strong>
              <span>승인된 평가 기준과 가중치</span>
            </div>
          </div>
        </aside>
      </section>
    </AppShell>
  );
}
