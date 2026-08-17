import Link from "next/link";
import { AppShell } from "@/components/AppShell";

export default function ResultPage() {
  return (
    <AppShell activeStep="result">
      <section className="page-frame">
        <div className="panel">
          <div className="panel-header">
            <p className="eyebrow">Final result</p>
            <h1 className="title">62점에서 시작한 초안이 78점까지 개선됐습니다.</h1>
          </div>
          <div className="panel-body template-grid">
            <article className="metric-card">
              <strong>최종 결과물</strong>
              <p>
                서버 개발 직무 요구사항에 맞춰 프로젝트 경험, 장애 대응, MSA
                설계 경험이 전면에 오도록 재구성된 자기소개서입니다.
              </p>
            </article>
            <article className="metric-card">
              <strong>홀드아웃 점수</strong>
              <p className="muted">백엔드 loop spec 연동 후 표시 예정</p>
            </article>
            <div className="button-row">
              <Link className="secondary-button" href="/run">
                실행 기록 보기
              </Link>
              <Link className="primary-button" href="/">
                새 작업 시작
              </Link>
            </div>
          </div>
        </div>
        <aside className="panel blueprint">
          <div className="panel-header">
            <p className="eyebrow">Improvement record</p>
            <h2 className="section-title">어떤 기준으로 좋아졌는지 함께 남깁니다</h2>
          </div>
          <div className="panel-body metric-grid">
            <div className="blueprint-item">
              <strong>시작 점수</strong>
              <span>62</span>
            </div>
            <div className="blueprint-item">
              <strong>최종 점수</strong>
              <span>78</span>
            </div>
            <div className="blueprint-item">
              <strong>채택된 개선</strong>
              <span>2회</span>
            </div>
          </div>
        </aside>
      </section>
    </AppShell>
  );
}
