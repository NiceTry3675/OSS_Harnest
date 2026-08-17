import Link from "next/link";
import { AppShell } from "@/components/AppShell";

const events = [
  { id: "00", title: "초안 기준선", score: 62, status: "kept" },
  { id: "03", title: "직무 키워드 재배치", score: 71, status: "kept" },
  { id: "07", title: "표현 확장 후보", score: 69, status: "dropped" },
  { id: "09", title: "성과 중심 문장 교체", score: 78, status: "kept" },
  { id: "14", title: "다음 후보 평가 중", score: 78, status: "running" },
];

export default function RunPage() {
  return (
    <AppShell activeStep="run">
      <section className="run-page">
        <div className="run-hero">
          <div>
            <p className="eyebrow">Browser loop running</p>
            <h1>자소서 매칭 루프가 웹에서 실행 중입니다</h1>
            <p>
              승인된 평가 기준은 잠긴 상태로 유지되고, AI는 후보를 만들고 채점한 뒤
              점수가 오른 수정만 다음 기준선으로 채택합니다.
            </p>
          </div>
          <div className="run-summary">
            <div>
              <span>현재 점수</span>
              <strong>78</strong>
              <small>/100</small>
            </div>
            <div>
              <span>시작 대비</span>
              <strong>+16</strong>
              <small>2 kept edits</small>
            </div>
          </div>
        </div>

        <div className="run-layout">
          <section className="section-block timeline-panel">
            <div className="section-heading">
              <p className="eyebrow">Experiment trail</p>
              <h2 className="section-title">채택된 수정만 본선으로 이어집니다</h2>
            </div>
            <div className="event-list">
              {events.map((event) => (
                <div className={`event-row ${event.status}`} key={event.id}>
                  <span className="event-id">#{event.id}</span>
                  <div>
                    <strong>{event.title}</strong>
                    <p>{event.status === "dropped" ? "폐기됨" : event.status === "running" ? "평가 중" : "채택됨"}</p>
                  </div>
                  <b>{event.score}</b>
                </div>
              ))}
            </div>
          </section>

          <section className="section-block chart-panel">
            <div className="section-heading">
              <p className="eyebrow">Score curve</p>
              <h2 className="section-title">개선 곡선</h2>
            </div>
            <svg className="score-chart" viewBox="0 0 640 300" role="img">
              <title>62점에서 78점까지 개선되는 점수 그래프</title>
              <line className="chart-axis" x1="44" x2="596" y1="238" y2="238" />
              <polyline
                className="chart-line"
                points="48,204 154,204 248,152 348,152 456,104 596,82"
              />
              {[
                ["62", 48, 204],
                ["71", 248, 152],
                ["78", 456, 104],
                ["78", 596, 82],
              ].map(([label, x, y]) => (
                <g key={`${label}-${x}`}>
                  <circle className="chart-dot" cx={x} cy={y} r="7" />
                  <text x={Number(x) + 12} y={Number(y) - 12}>
                    {label}
                  </text>
                </g>
              ))}
            </svg>
          </section>

          <section className="section-block diff-panel">
            <div className="section-heading">
              <p className="eyebrow">Accepted diff</p>
              <h2 className="section-title">점수를 올린 변경만 보여줍니다</h2>
            </div>
            <div className="diff-text">
              <span>Before</span>
              <p>다양한 프로젝트를 경험했습니다.</p>
              <span>After</span>
              <p>
                Spring 기반 주문 API를 설계하며 트래픽 3배 증가를 무중단으로 처리했습니다.
              </p>
            </div>
          </section>

          <aside className="section-block criteria-panel">
            <div className="section-heading">
              <p className="eyebrow">Locked criteria</p>
              <h2 className="section-title">AI가 바꿀 수 없는 기준</h2>
            </div>
            <div className="criteria-mini-list">
              <span>공고 핵심어 반영</span>
              <span>직무 적합도 루브릭</span>
              <span>글자 수 제한</span>
            </div>
            <Link className="primary-button" href="/result">
              결과 확인
            </Link>
          </aside>
        </div>
      </section>
    </AppShell>
  );
}
