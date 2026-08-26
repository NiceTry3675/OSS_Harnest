/** 0단계 — 목표를 받아 맞춤 템플릿을 만드는 화면.
 *
 *  Harnest가 최종적으로 하려는 일은 정해진 템플릿 두 개를 고르게 하는 것이 아니라,
 *  사용자가 목표를 말하면 그 목표에 맞는 템플릿을 통째로 만들어 주는 것이다.
 *  이 화면은 그 모습을 먼저 보여준다.
 *
 *  아직 모델이 템플릿을 만들지는 않는다. 대신 목표 문장에서 실제로 단서를 읽어
 *  구성을 고른다 — 아무 목표나 쳐도 결과가 달라지고, 하지 않은 일을 했다고
 *  말하지 않는다.
 *
 *  구성을 확정하면 지금 실제로 도는 템플릿으로 들어간다. */

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TEMPLATES } from "../templates";
import { useProject } from "../state";
import { setFlowStep } from "../lib/flowStep";

interface Criterion {
  id: string;
  label: string;
  weight: number;
}

interface Blueprint {
  /** 어느 템플릿으로 들어갈지 */
  templateId: string;
  /** 만들어진 템플릿의 이름 — 결과 머리에 붙는다 */
  name: string;
  artifact: string;
  criteria: Criterion[];
  gates: string[];
  steps: string[];
}

/** 목표 문장에서 읽는 단서 — 앞에 있는 갈래가 먼저 걸린다 */
const SHAPES: Array<{ hit: RegExp; make: (goal: string) => Blueprint }> = [
  {
    hit: /(근무|교대|당직|시프트|일정표|스케줄|배정)/,
    make: () => ({
      templateId: "timetable",
      name: "근무표 템플릿",
      artifact: "근무표",
      criteria: [
        { id: "fair", label: "야간·주말이 한 사람에게 몰리지 않는가", weight: 50 },
        { id: "cover", label: "모든 시간대에 사람이 배치되었는가", weight: 50 },
      ],
      gates: ["연속 근무 한도를 넘지 않을 것", "주당 근무 상한을 넘지 않을 것"],
      steps: ["근무자 명단", "지켜야 할 규칙", "사전 점검·승인", "기준 확정", "실행", "결과"],
    }),
  },
  {
    hit: /(공고|모집|채용|안내문|공지)/,
    make: () => ({
      templateId: "handover",
      name: "안내문 템플릿",
      artifact: "안내문",
      criteria: [
        { id: "answerable", label: "읽는 사람이 되물을 것 없이 이해하는가", weight: 70 },
        { id: "brevity", label: "간결성", weight: 30 },
      ],
      gates: ["분량 상한을 넘지 않을 것"],
      steps: [
        "무엇을 알리는 글인가",
        "실제로 받았던 질문과 답",
        "분량·간결성",
        "채점 모델",
        "사전 점검·승인",
        "기준 확정",
        "실행",
        "결과",
      ],
    }),
  },
];

/** 어느 갈래에도 걸리지 않는 목표 — 문서 만들기로 본다 */
function fallback(): Blueprint {
  return {
    templateId: "handover",
    name: "인수인계·온보딩 문서 템플릿",
    artifact: "문서",
    criteria: [
      { id: "answerable", label: "문서만 보고 실제 질문에 답할 수 있는가", weight: 80 },
      { id: "brevity", label: "간결성", weight: 20 },
    ],
    gates: ["분량 상한을 넘지 않을 것"],
    steps: [
      "업무 소개",
      "실제로 받았던 질문과 답",
      "분량·간결성",
      "채점 모델",
      "사전 점검·승인",
      "기준 확정",
      "실행",
      "결과",
    ],
  };
}

function shapeFor(goal: string): Blueprint {
  const found = SHAPES.find((shape) => shape.hit.test(goal));
  return found ? found.make(goal) : fallback();
}

/** 템플릿을 만드는 동안 지나가는 마디 */
const PHASES = [
  "목표에서 무엇을 만들지 읽는 중",
  "무엇을 잘한 걸로 볼지 정하는 중",
  "반드시 지켜야 할 조건 세우는 중",
  "진행 단계 짜는 중",
];
const PHASE_MS = 700;

const EXAMPLES = [
  "신입이 물어보지 않고도 일할 수 있는 인수인계 문서를 만들고 싶습니다",
  "간호사 6명이 도는 병동 근무표를 공정하게 짜고 싶습니다",
  "지원자가 자격 요건을 헷갈리지 않는 채용 공고를 쓰고 싶습니다",
];

export function BuilderPage() {
  const { reset, setTemplateId } = useProject();
  const navigate = useNavigate();
  const [goal, setGoal] = useState("");
  const [phase, setPhase] = useState(-1);
  const [plan, setPlan] = useState<Blueprint | null>(null);
  const [newStep, setNewStep] = useState("");
  const timers = useRef<number[]>([]);

  useEffect(() => {
    setFlowStep({ kind: "outside" });
    return () => timers.current.forEach((t) => window.clearTimeout(t));
  }, []);

  const [madeFor, setMadeFor] = useState("");

  const build = () => {
    const trimmed = goal.trim();
    if (trimmed === "") return;
    setPlan(null);
    setMadeFor(trimmed);
    setPhase(0);
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = PHASES.map((_, i) =>
      window.setTimeout(() => setPhase(i + 1), PHASE_MS * (i + 1)),
    );
    timers.current.push(
      window.setTimeout(() => setPlan(shapeFor(trimmed)), PHASE_MS * PHASES.length + 250),
    );
  };

  const drop = (id: string) => {
    if (!plan || plan.criteria.length <= 1) return;
    const left = plan.criteria.filter((c) => c.id !== id);
    // 하나를 빼면 남은 것들이 100을 채우도록 몫을 다시 나눈다
    const total = left.reduce((sum, c) => sum + c.weight, 0);
    setPlan({
      ...plan,
      criteria: left.map((c) => ({ ...c, weight: Math.round((c.weight / total) * 100) })),
    });
  };

  const startRun = () => {
    if (!plan) return;
    reset();
    setTemplateId(plan.templateId);
    navigate("/wizard");
  };

  const building = phase >= 0 && plan === null;
  const template = plan ? TEMPLATES.find((t) => t.id === plan.templateId) : null;

  return (
    <div className="builder">
      <span className="eyebrow">0단계 · 템플릿 만들기</span>
      <h1 className="q-big">무엇을 잘하게 만들고 싶으세요?</h1>
      <p className="q-help">
        목표를 한 문장으로 적어 주세요. 그 목표에 맞는 템플릿 — 채점 기준, 반드시 지켜야 할 조건,
        진행 단계 — 을 만들어 보여드립니다.
      </p>

      <div className="builder-ask">
        <textarea
          rows={3}
          value={goal}
          placeholder="예: 신입이 물어보지 않고도 일할 수 있는 인수인계 문서를 만들고 싶습니다"
          onChange={(e) => setGoal(e.target.value)}
        />
        <div className="builder-chips">
          {EXAMPLES.map((example) => (
            <button key={example} type="button" onClick={() => setGoal(example)}>
              {example}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="primary builder-go"
          disabled={goal.trim() === "" || building}
          onClick={build}
        >
          {building ? "템플릿 만드는 중…" : "이 목표에 맞는 템플릿 만들기"}
        </button>
      </div>

      {phase >= 0 ? (
        <ol className="builder-phases">
          {PHASES.map((label, i) => (
            <li key={label} className={phase > i ? "is-done" : phase === i ? "is-now" : undefined}>
              <i aria-hidden="true">{phase > i ? "✓" : i + 1}</i>
              {label}
            </li>
          ))}
        </ol>
      ) : null}

      {plan ? (
        <div className="builder-plan">
          <div className="builder-card">
            <header className="builder-card-top">
              <span className="badge">새로 만든 템플릿</span>
              <h2>{plan.name}</h2>
              <p className="builder-for">“{madeFor}”에 맞춰 짰습니다</p>
            </header>

            <div className="builder-cols">
              <div className="builder-col">
                <section className="builder-block">
                  <h3>무엇을 잘한 걸로 볼지</h3>
                  <ul className="builder-rules">
                    {plan.criteria.map((c) => (
                      <li key={c.id}>
                        <div className="builder-rule-head">
                          <span>{c.label}</span>
                          <b>{c.weight}%</b>
                          <button
                            type="button"
                            disabled={plan.criteria.length <= 1}
                            onClick={() => drop(c.id)}
                          >
                            빼기
                          </button>
                        </div>
                        <div className="builder-bar" aria-hidden="true">
                          <i style={{ width: `${c.weight}%` }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="builder-block">
                  <h3>반드시 지켜야 할 조건</h3>
                  <ul className="builder-rules">
                    {plan.gates.map((gate) => (
                      <li key={gate} className="is-gate">
                        <div className="builder-rule-head">
                          <span>{gate}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setPlan({ ...plan, gates: plan.gates.filter((g) => g !== gate) })
                            }
                          >
                            빼기
                          </button>
                        </div>
                      </li>
                    ))}
                    {plan.gates.length === 0 ? (
                      <li className="is-empty">조건이 없습니다</li>
                    ) : null}
                  </ul>
                </section>
              </div>

              <div className="builder-col">
                <section className="builder-block">
                  <h3>
                    진행 단계 <span className="builder-count">{plan.steps.length}</span>
                  </h3>
                  <ol className="builder-steps">
                    {plan.steps.map((step, i) => (
                      <li key={step}>
                        <i>{i + 1}</i>
                        <span>{step}</span>
                        <button
                          type="button"
                          aria-label={`${step} 단계 빼기`}
                          onClick={() =>
                            setPlan({ ...plan, steps: plan.steps.filter((s) => s !== step) })
                          }
                        >
                          빼기
                        </button>
                      </li>
                    ))}
                  </ol>
                  <div className="builder-add">
                    <input
                      value={newStep}
                      placeholder="단계를 더하려면 이름을 적으세요"
                      onChange={(e) => setNewStep(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        const name = newStep.trim();
                        if (name === "" || plan.steps.includes(name)) return;
                        setPlan({ ...plan, steps: [...plan.steps, name] });
                        setNewStep("");
                      }}
                    />
                    <button
                      type="button"
                      disabled={newStep.trim() === "" || plan.steps.includes(newStep.trim())}
                      onClick={() => {
                        setPlan({ ...plan, steps: [...plan.steps, newStep.trim()] });
                        setNewStep("");
                      }}
                    >
                      더하기
                    </button>
                  </div>
                </section>
              </div>
            </div>

            <footer className="builder-foot">
              <button type="button" className="primary builder-go" onClick={startRun}>
                이 템플릿으로 시작
              </button>
              {template ? (
                <span className="hint">
                  지금은 「{template.name}」 절차로 진행합니다 — 이 템플릿에 가장 가까운 절차입니다.
                </span>
              ) : null}
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
