import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TEMPLATES } from "../templates";
import { useProject } from "../state";
import { IntroTour, markTourSeen, tourSeen } from "../components/IntroTour";
import { useCountUp } from "../lib/useCountUp";

/** 처음 만든 문서와 마지막 문서의 점수 — 홈에서 반복 재생하는 예시 수치.
 *  실제 실행 결과가 아니라 제품이 하는 일을 보여주는 그림이다. */
const DEMO_FROM = 49.9;
const DEMO_TO = 100;

/** 점수가 오르는 모습을 반복해서 보여주는 작은 계기 */
function ScoreOrb() {
  const [target, setTarget] = useState<number>(DEMO_TO);
  const shown = useCountUp(target, 1400);

  useEffect(() => {
    const t = setInterval(() => {
      setTarget(DEMO_FROM);
      setTimeout(() => setTarget(DEMO_TO), 60);
    }, 4200);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="orb" aria-hidden="true">
      <div className="orb-inner">
        <div className="orb-score">
          {shown === null ? DEMO_TO : Math.round(shown * 10) / 10}
        </div>
        <div className="orb-cap">{DEMO_FROM}에서 올라온 점수</div>
        <div className="orb-track"><i /></div>
      </div>
    </div>
  );
}

export function HomePage() {
  const { reset, setTemplateId } = useProject();
  const navigate = useNavigate();
  const [tour, setTour] = useState(false);
  const picks = useRef<HTMLDivElement>(null);

  useEffect(() => {
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

  return (
    <div>
      <section className="hero">
        <div>
          <span className="eyebrow">AI 개선 관제실</span>
          <h1 className="hero-title">
            기준은 당신이 정합니다.
            <br />
            AI는 그 안에서만
            <br />
            좋아집니다.
          </h1>
          <p className="hero-lead">
            채점 기준을 승인하는 순간 잠깁니다. AI는 실행 내내 그 기준을 바꿀 수 없습니다.
            올라간 점수를 믿을 수 있는 이유입니다.
          </p>
          <div className="hero-cta">
            <button
              className="primary"
              onClick={() => picks.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            >
              시작하기
            </button>
            <button onClick={() => setTour(true)}>어떻게 진행되나요</button>
          </div>
        </div>
        <ScoreOrb />
      </section>

      <div ref={picks} className="picks">
        <h2 className="picks-title">무엇을 맡기시겠어요?</h2>
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

      <IntroTour open={tour} onClose={closeTour} />
    </div>
  );
}
