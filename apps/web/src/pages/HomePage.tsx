import { useNavigate } from "react-router-dom";
import { TEMPLATES } from "../templates";
import { useProject } from "../state";

export function HomePage() {
  const { reset, setTemplateId } = useProject();
  const navigate = useNavigate();

  return (
    <div>
      <h1>AI에게 한 번 시키고 끝이 아니라, 당신이 승인한 기준으로 될 때까지 스스로 고치는 AI</h1>
      <p className="sub">채점 기준은 당신이 승인하고, 실행 중 AI는 이 기준을 변경할 수 없습니다.</p>

      <h2>템플릿</h2>
      <div className="row" style={{ flexWrap: "wrap" }}>
        {TEMPLATES.map((t) => (
          <div key={t.id} className="card" style={{ width: 440, flexShrink: 0 }}>
            <h2 style={{ margin: "0 0 6px" }}>
              {t.name}{" "}
              {t.badge ? <span className="badge muted">{t.badge}</span> : null}
            </h2>
            <p className="sub" style={{ marginBottom: 14 }}>{t.description}</p>
            <button
              className="primary"
              onClick={() => {
                reset();
                setTemplateId(t.id);
                navigate("/wizard");
              }}
            >
              시작하기
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
