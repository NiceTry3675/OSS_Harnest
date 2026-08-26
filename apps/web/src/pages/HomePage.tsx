import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TEMPLATES } from "../templates";
import { useProject } from "../state";
import { IntroTour, markTourSeen, tourSeen } from "../components/IntroTour";
import { setFlowStep } from "../lib/flowStep";
import { HeroLoop } from "../components/HeroLoop";
import {
  listSavedTemplates,
  removeSavedTemplate,
  updateSavedTemplate,
  type SavedTemplate,
} from "../lib/savedTemplates";

export function HomePage() {
  const { reset, setTemplateId, setAnswers } = useProject();
  const [saved, setSaved] = useState<SavedTemplate[]>([]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const navigate = useNavigate();
  const [tour, setTour] = useState(false);
  const picks = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFlowStep({ kind: "outside" }); // 홈은 흐름 밖
    setSaved(listSavedTemplates());
    if (!tourSeen()) setTour(true);
  }, []);

  const closeTour = () => {
    markTourSeen();
    setTour(false);
  };

  const start = (id: string) => {
    reset();
    setTemplateId(id);
    navigate("/wizard");
  };

  /** 보관해 둔 설정으로 시작 — 절차는 그 템플릿이 소유하고, 값만 얹는다 */
  const startSaved = (item: SavedTemplate) => {
    reset();
    setTemplateId(item.templateId);
    setAnswers({
      lengthCap: item.lengthCap,
      conciseness: item.useConciseness,
      questionFocus: item.questionFocus,
      builtName: item.name,
      builtGoal: item.goal,
      builtStages: item.stages,
    });
    navigate("/wizard");
  };

  return (
    <div>
      <section className="hero">
        <div>
          <span className="eyebrow">목표 맞춤 AI</span>
          <h1 className="hero-title">
            목표를 정하세요.
            <br />
            기준을 승인하세요.
            <br />
            AI가 목표에 도달합니다.
          </h1>
          <p className="hero-lead">
            채점 기준을 결정하면 AI는 실행 내내 그 기준을 바꿀 수 없습니다.
            <br />
            올라간 점수를 믿을 수 있는 이유입니다.
          </p>
          <div className="hero-cta">
            <button className="primary" onClick={() => navigate("/build")}>
              템플릿 만들기
            </button>
            <button onClick={() => setTour(true)}>어떻게 진행되나요</button>
          </div>
        </div>
        <HeroLoop />
      </section>

      <div ref={picks} className="picks">
        <h2 className="picks-title">제공된 템플릿</h2>
        <div className="template-grid">
          {TEMPLATES.map((t) => (
            <div key={t.id} className="card template-card">
              <h3 className="template-name">
                {t.name}
                {t.badge ? <span className="badge muted">{t.badge}</span> : null}
              </h3>
              <p className="sub template-desc">{t.description}</p>
              <button className="primary" onClick={() => start(t.id)}>
                이걸로 시작
              </button>
            </div>
          ))}
        </div>
      </div>

      {saved.length > 0 ? (
        <div className="picks">
          <h2 className="picks-title">내가 만든 템플릿</h2>
          <div className="template-grid is-mine">
            {saved.map((item) => (
              <div key={item.savedId} className="card template-card is-saved">
                {renaming === item.savedId ? (
                  <input
                    value={draftName}
                    autoFocus
                    aria-label="템플릿 이름"
                    onChange={(e) => setDraftName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setRenaming(null);
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      const next = draftName.trim();
                      if (next !== "") updateSavedTemplate(item.savedId, { name: next });
                      setSaved(listSavedTemplates());
                      setRenaming(null);
                    }}
                  />
                ) : (
                  <h3 className="template-name">{item.name}</h3>
                )}
                <p className="sub template-desc">
                  {item.artifact} · 분량 {item.lengthCap.toLocaleString()}자 ·{" "}
                  {item.useConciseness ? "길이를 점수에 반영" : "길이는 점수와 무관"}
                </p>
                <p className="template-stages">
                  {(item.stages ?? []).map((stage) => stage.label).join(" › ")}
                </p>
                <div className="template-acts">
                  <button className="primary" onClick={() => startSaved(item)}>
                    이걸로 시작
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRenaming(item.savedId);
                      setDraftName(item.name);
                    }}
                  >
                    이름 바꾸기
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      removeSavedTemplate(item.savedId);
                      setSaved(listSavedTemplates());
                    }}
                  >
                    지우기
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <IntroTour open={tour} onClose={closeTour} />
    </div>
  );
}
