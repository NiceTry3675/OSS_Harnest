import { Link } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { templates } from "@/lib/mock-data";

const buildSteps = [
  {
    label: "1",
    title: "목표와 재료를 받습니다",
    description: "사용자는 개선하고 싶은 결과물, 기준 문서, 제약 조건만 입력합니다.",
  },
  {
    label: "2",
    title: "채점표를 제안합니다",
    description: "Harnest는 키워드, 제약, 루브릭을 실제 평가 가능한 기준으로 바꿉니다.",
  },
  {
    label: "3",
    title: "사용자가 기준을 잠급니다",
    description: "승인된 기준은 실행 중 바뀌지 않고, AI는 산출물만 고칠 수 있습니다.",
  },
  {
    label: "4",
    title: "웹에서 반복 실행합니다",
    description: "점수가 오른 후보만 채택하고, 폐기된 후보와 diff를 기록합니다.",
  },
];

export function HomePage() {
  return (
    <AppShell activeStep="template">
      <section className="workspace-home">
        <div className="product-hero">
          <div>
            <p className="eyebrow">Harnest Studio</p>
            <h1>목표를 넣으면, 평가 기준부터 실행 루프까지 만듭니다.</h1>
            <p>
              Harnest는 비개발자가 목표와 재료를 입력하면 채점표를 제안하고,
              사용자가 승인한 기준을 잠근 뒤 웹에서 반복 개선을 실행하는 작업대입니다.
            </p>
            <div className="hero-actions">
              <Link className="primary-button" to="/interview">
                개선 루프 만들기
              </Link>
              <a className="secondary-button" href="#how-it-works">
                작동 방식 보기
              </a>
            </div>
          </div>
          <aside className="contract-preview" aria-label="Harnest가 만드는 실행 계약">
            <div className="contract-topline">
              <span>실행 계약</span>
              <strong>승인 전</strong>
            </div>
            <div className="contract-row">
              <span>목표</span>
              <b>사용자가 정한 결과물 개선</b>
            </div>
            <div className="contract-row">
              <span>수정 가능</span>
              <b>산출물 본문</b>
            </div>
            <div className="contract-row locked">
              <span>수정 불가</span>
              <b>승인된 채점표</b>
            </div>
            <div className="contract-flow">
              <span>후보 생성</span>
              <span>채점</span>
              <span>채택/폐기</span>
              <span>반복</span>
            </div>
          </aside>
        </div>

        <div className="workspace-layout">
          <section className="start-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Work order</p>
                <h2 className="section-title">첫 화면은 프롬프트가 아니라 작업 지시서입니다</h2>
              </div>
              <span className="soft-badge">목표 기반 생성</span>
            </div>

            <div className="start-form-preview">
              <label>
                개선하고 싶은 결과
                <div className="fake-input goal-input">
                  예: 내 자기소개서가 특정 채용공고의 핵심 조건을 더 잘 반영하게 만들기
                </div>
              </label>
              <label>
                사용자가 넣는 재료
                <div className="work-order-grid">
                  <span>기준 문서</span>
                  <span>초기 산출물</span>
                  <span>반드시 지킬 조건</span>
                  <span>반복 종료 조건</span>
                </div>
              </label>
            </div>

            <div className="start-footer">
              <p>
                자소서 예시는 첫 템플릿일 뿐입니다. 핵심은 어떤 도메인이든 사용자의
                목표를 평가 가능한 루프로 바꾸는 것입니다.
              </p>
              <Link className="primary-button" to="/interview">
                작업 지시서 작성
              </Link>
            </div>
          </section>

          <aside className="insight-card harness-card">
            <div className="preview-toolbar">
              <span>Harnest가 만드는 것</span>
              <strong>채점표 + 루프</strong>
            </div>
            <div className="harness-stack">
              <div>
                <span>01</span>
                <strong>평가 기준</strong>
                <p>무엇을 잘했다고 볼지 결정합니다.</p>
              </div>
              <div>
                <span>02</span>
                <strong>수정 범위</strong>
                <p>AI가 고칠 수 있는 영역을 제한합니다.</p>
              </div>
              <div>
                <span>03</span>
                <strong>반복 규칙</strong>
                <p>점수가 오르면 채택하고 아니면 폐기합니다.</p>
              </div>
            </div>
          </aside>

          <section className="section-block template-section" id="how-it-works">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Flow</p>
                <h2 className="section-title">사용자는 하네스를 몰라도 이 순서로 완성합니다</h2>
              </div>
            </div>
            <div className="build-step-list">
              {buildSteps.map((step) => (
                <article className="build-step" key={step.label}>
                  <span>{step.label}</span>
                  <div>
                    <strong>{step.title}</strong>
                    <p>{step.description}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="section-block">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Templates</p>
                <h2 className="section-title">첫 vertical slice는 자소서 매칭으로 검증합니다</h2>
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
                      <Link className="secondary-button compact" to="/interview">
                        시작
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

          <section className="section-block recent-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Positioning</p>
                <h2 className="section-title">일반 챗봇과 다른 지점</h2>
              </div>
            </div>
            <div className="comparison-grid">
              <article>
                <span>일반 AI</span>
                <strong>답변을 바로 생성</strong>
                <p>좋아졌는지 판단은 다시 사용자에게 남습니다.</p>
              </article>
              <article>
                <span>Harnest</span>
                <strong>채점 기준을 먼저 고정</strong>
                <p>승인된 기준으로 반복 실행하고 점수와 diff를 남깁니다.</p>
              </article>
            </div>
          </section>
        </div>
      </section>
    </AppShell>
  );
}
