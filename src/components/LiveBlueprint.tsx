import type { BlueprintItem } from "@/lib/types";

export function LiveBlueprint({ items }: { items: BlueprintItem[] }) {
  return (
    <aside className="panel blueprint">
      <div className="panel-header">
        <p className="eyebrow">Harness preview</p>
        <h2 className="section-title">승인하면 이 구조로 웹 실행 루프가 만들어집니다</h2>
      </div>
      <div className="panel-body template-grid">
        {items.map((item) => (
          <div className="blueprint-item" key={item.label}>
            <strong>{item.label}</strong>
            <span>{item.value}</span>
          </div>
        ))}
        <div className="blueprint-item blueprint-scorecard">
          <strong>채점표</strong>
          <div>
            <span>공고 핵심어</span>
            <b>40%</b>
          </div>
          <div>
            <span>직무 적합도</span>
            <b>50%</b>
          </div>
          <div>
            <span>글자 수 제한</span>
            <b>10%</b>
          </div>
        </div>
        <div className="blueprint-item blueprint-scorecard">
          <strong>실행 조건</strong>
          <div>
            <span>최대 반복</span>
            <b>30회</b>
          </div>
          <div>
            <span>종료 기준</span>
            <b>80점</b>
          </div>
          <div>
            <span>LLM 경로</span>
            <b>무료 체험</b>
          </div>
        </div>
      </div>
    </aside>
  );
}
