import { useNavigate } from "react-router-dom";
import { TEMPLATES } from "../templates";
import { useProject } from "../state";

/** 홈 — SPEC §1의 세 가지 핵심 가치를 비개발자의 말로 옮긴다.
 *  (1) 좋은 결과의 기준을 실행 전에 공개·승인 (2) 승인된 판정 절차는 실행 중 불변
 *  (3) 원샷과 최종을 같은 기준으로 측정.
 *  반복 횟수를 주인공으로 세우지 않는다 — SPEC §1이 명시적으로 배제한다. */
export function HomePage() {
  const { reset, setTemplateId } = useProject();
  const navigate = useNavigate();

  const main = TEMPLATES.filter((t) => !t.badge);
  const dev = TEMPLATES.filter((t) => t.badge);

  const start = (id: string) => {
    reset();
    setTemplateId(id);
    navigate("/wizard");
  };

  return (
    <div>
      <h1 className="hero-title">좋은 결과의 기준을 먼저 정하고, 그 기준으로만 개선합니다</h1>
      <p className="hero-sub">
        AI가 무엇을 잘한 것으로 볼지 실행 전에 당신에게 보여주고 승인받습니다. 승인한 뒤에는
        AI가 그 기준을 바꿀 수 없고, 처음 결과와 마지막 결과를 같은 기준으로 재서 보여줍니다.
      </p>

      <ol className="steps">
        <li>
          <span className="steps-n">1</span>
          <span>몇 가지 질문에 답하면 채점 기준이 만들어집니다</span>
        </li>
        <li>
          <span className="steps-n">2</span>
          <span>기준을 직접 확인하고 승인하면 잠깁니다</span>
        </li>
        <li>
          <span className="steps-n">3</span>
          <span>AI가 그 기준으로 고쳐 가는 과정을 지켜봅니다</span>
        </li>
      </ol>

      <h2>무엇을 만들까요?</h2>
      <div className="template-grid">
        {main.map((t) => (
          <div key={t.id} className="card template-card">
            <h3 className="template-name">{t.name}</h3>
            <p className="sub">{t.description}</p>
            <button className="primary" onClick={() => start(t.id)}>
              시작하기
            </button>
          </div>
        ))}
      </div>

      {dev.length > 0 && (
        <details className="dev-templates">
          <summary>개발·테스트용 템플릿 {dev.length}개</summary>
          {dev.map((t) => (
            <div key={t.id} className="card template-card">
              <h3 className="template-name">
                {t.name} <span className="badge muted">{t.badge}</span>
              </h3>
              <p className="sub">{t.description}</p>
              <button onClick={() => start(t.id)}>시작하기</button>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
