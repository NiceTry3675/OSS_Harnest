import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { templates } from "@/lib/mock-data";

const recentRuns = [
  { name: "지원서 문항을 공고에 맞게 개선", score: "62 → 78", state: "완료" },
  { name: "주말 근무 제약을 지키는 근무표 만들기", score: "위반 9 → 2", state: "진행 중" },
  { name: "상품 상세페이지 문구 전환율 개선", score: "54 → 69", state: "리플레이" },
];

const guardrails = [
  "사용자가 승인한 평가 기준은 실행 중 잠깁니다.",
  "AI는 산출물만 고치고 채점 기준은 수정할 수 없습니다.",
  "웹에서 실행 기록, 점수 변화, diff를 함께 확인합니다.",
];

export default function Home() {
  return (
    <AppShell activeStep="template">
      <section className="workspace-home">
        <div className="workspace-heading">
          <div>
            <p className="eyebrow">Harnest Studio</p>
            <h1>어떤 결과물을 개선하고 싶나요?</h1>
            <p>
              사용자가 목표를 입력하면 Harnest가 필요한 질문을 고르고, 평가 기준과
              브라우저 실행 루프를 함께 설계합니다.
            </p>
          </div>
          <Link className="primary-button" href="/interview">
            목표 입력하기
          </Link>
        </div>

        <div className="workspace-layout">
          <section className="start-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">New loop</p>
                <h2 className="section-title">목표를 적으면 맞는 개선 루프를 설계합니다</h2>
              </div>
              <span className="soft-badge">웹에서 생성 · 웹에서 실행</span>
            </div>

            <div className="start-form-preview">
              <label>
                만들고 싶은 개선 루프
                <div className="fake-input goal-input">
                  예: 지원서가 채용공고의 핵심 조건을 더 잘 반영하게 만들고 싶어요
                </div>
              </label>
              <label>
                Harnest가 이어서 정리할 것
                <div className="criteria-chips">
                  <span>필요한 질문</span>
                  <span>평가 기준 후보</span>
                  <span>반복 실행 설정</span>
                </div>
              </label>
            </div>

            <div className="start-footer">
              <p>자소서, 근무표, 글쓰기처럼 도메인이 달라도 시작은 사용자의 목표입니다.</p>
              <Link className="primary-button" href="/interview">
                목표로 시작
              </Link>
            </div>
          </section>

          <aside className="insight-card">
            <div className="preview-toolbar">
              <span>최근 실행 미리보기</span>
              <strong>기준 잠김</strong>
            </div>
            <div className="insight-score">
              <span>최종 점수</span>
              <strong>78</strong>
              <small>시작 대비 +16</small>
            </div>
            <div className="calm-chart" aria-hidden="true">
              <span style={{ left: "8%", bottom: "24%" }} />
              <span style={{ left: "34%", bottom: "24%" }} />
              <span style={{ left: "52%", bottom: "48%" }} />
              <span style={{ left: "74%", bottom: "48%" }} />
              <span style={{ left: "92%", bottom: "70%" }} />
            </div>
            <p className="insight-copy">
              채택된 수정만 기준선으로 남고, 폐기된 후보는 실행 기록에서 분리됩니다.
            </p>
          </aside>

          <section className="section-block template-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Examples</p>
                <h2 className="section-title">목표를 빠르게 시작하는 예시</h2>
              </div>
            </div>
            <div className="template-list">
              {templates.map((template) => (
                <article
                  className={`template-card ${template.status === "active" ? "selected" : ""}`}
                  key={template.id}
                >
                  <div>
                    <strong>{template.name}</strong>
                    <p>{template.description}</p>
                  </div>
                  <div className="template-meta">
                    <span>{template.evaluation}</span>
                    {template.status === "active" ? (
                      <Link className="secondary-button compact" href="/interview">
                        열기
                      </Link>
                    ) : (
                      <button className="secondary-button compact" disabled>
                        준비 중
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="section-block">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Why it works</p>
                <h2 className="section-title">비개발자용 하네스는 뒤에 숨깁니다</h2>
              </div>
            </div>
            <div className="guardrail-list">
              {guardrails.map((item) => (
                <div className="guardrail-item" key={item}>
                  <span />
                  <p>{item}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="section-block recent-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Activity</p>
                <h2 className="section-title">최근 실행</h2>
              </div>
            </div>
            <div className="recent-list">
              {recentRuns.map((run) => (
                <div className="recent-row" key={run.name}>
                  <span>{run.name}</span>
                  <strong>{run.score}</strong>
                  <small>{run.state}</small>
                </div>
              ))}
            </div>
          </section>
        </div>
      </section>
    </AppShell>
  );
}
