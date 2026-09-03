/** 0단계 — 목표를 받아 맞춤 템플릿을 만드는 화면.
 *
 *  Harnest가 최종적으로 하려는 일은 정해진 템플릿 두 개를 고르게 하는 것이 아니라,
 *  사용자가 목표를 말하면 그 목표에 맞는 템플릿을 만들어 주는 것이다.
 *
 *  모델이 실제로 구성을 짠다. 다만 정하는 것은 "무엇을 만들지"와 설정값까지고,
 *  재는 방식(채점기·관문·분할 비율)은 템플릿이 소유한다. 받아온 구성은 그대로
 *  실행되지 않는다 — 위저드의 기본값으로 들어가 사용자가 고치고, 승인 화면에서
 *  사람이 확인한 뒤에야 잠긴다. */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BUILDABLE_TEMPLATES, TEMPLATES, planChoices } from "../templates";
import { useProject } from "../state";
import { setFlowStep } from "../lib/flowStep";
import { appendStream, clearStream, endStream, withActivityLog } from "../lib/activityLog";
import { ActivityConsole } from "../components/ActivityConsole";
import { ProviderCredentialInput } from "../components/ProviderCredentialInput";
import { ErrorNote } from "../components/ErrorNote";
import {
  createByoClient,
  getByoCredential,
  DEFAULT_JUDGE_MODEL,
  PROVIDER_LABEL,
  setByoCredential,
} from "../lib/llm";
import { planTemplate, type TemplatePlan } from "../lib/templatePlan";
import { saveTemplate } from "../lib/savedTemplates";

/** 구성을 만드는 동안 지나가는 마디 */
const PHASES = [
  "목표에서 무엇을 만들지 읽는 중",
  "어떤 평가 절차가 맞는지 고르는 중",
  "분량과 채점 설정을 정하는 중",
  "진행 단계 짜는 중",
];

const EXAMPLES = [
  "신입이 물어보지 않고도 일할 수 있는 인수인계 문서를 만들고 싶습니다",
  "간호사 6명이 도는 병동 근무표를 공정하게 짜고 싶습니다",
  "지원자가 자격 요건을 헷갈리지 않는 채용 공고를 쓰고 싶습니다",
];

const NEWLINE = String.fromCharCode(10);

export function BuilderPage() {
  const { reset, setTemplateId, setAnswers, readOnly } = useProject();
  const navigate = useNavigate();
  const [goal, setGoal] = useState("");
  const [phase, setPhase] = useState(-1);
  const [plan, setPlan] = useState<TemplatePlan | null>(null);
  const [madeFor, setMadeFor] = useState("");
  const [credential, setCredential] = useState(() => getByoCredential("openai") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setFlowStep({ kind: "outside" });
    clearStream();
  }, []);

  const build = async () => {
    const trimmed = goal.trim();
    if (trimmed === "" || busy) return;
    if (readOnly) {
      // 구성 생성도 모델 호출이다 — 읽기 전용 탭은 내지 않는다(SPEC §4.2)
      setError(
        "다른 탭에서 이 프로젝트를 편집·실행 중이라 이 탭에서는 템플릿을 만들 수 없습니다. 그 탭을 닫은 뒤 이 탭을 새로고침하면 이어서 작업할 수 있습니다.",
      );
      return;
    }
    if (credential.trim() === "") {
      setError(`${PROVIDER_LABEL.openai} 키를 넣어 주세요 — 구성은 모델이 짭니다.`);
      return;
    }
    setError(null);
    setPlan(null);
    setMadeFor(trimmed);
    setBusy(true);
    setPhase(0);
    clearStream("목표를 읽고 구성을 짜는 중");
    // 마디는 진행을 보여주는 표시일 뿐 — 실제 판단은 아래 한 번의 호출에서 일어난다
    const ticks = PHASES.map((_, i) => window.setTimeout(() => setPhase(i + 1), 900 * (i + 1)));
    try {
      const llm = withActivityLog(
        createByoClient("openai", credential.trim(), DEFAULT_JUDGE_MODEL.openai),
        "목표를 읽고 구성을 짜는 중",
      );
      const made = await planTemplate(
        llm,
        trimmed,
        planChoices(BUILDABLE_TEMPLATES),
      );
      setByoCredential("openai", credential.trim());
      setPhase(PHASES.length);
      setPlan(made);
      appendStream(
        [
          `만들 것: ${made.artifact}`,
          `평가 절차: ${TEMPLATES.find((t) => t.id === made.templateId)?.name ?? made.templateId}`,
          `분량 상한: ${made.lengthCap.toLocaleString()}자`,
          `길이를 점수에 반영: ${made.useConciseness ? "예" : "아니오"}`,
        ].join(NEWLINE),
        made.name,
      );
      endStream("구성을 짰습니다");
    } catch (err) {
      setPhase(-1);
      setError(err instanceof Error ? err.message : "구성을 만들지 못했습니다.");
      endStream("실패");
    } finally {
      ticks.forEach((t) => window.clearTimeout(t));
      setBusy(false);
    }
  };

  const startRun = () => {
    if (!plan) return;
    // 고친 상태 그대로 보관함에 남긴다 — 홈에서 다시 꺼내 쓸 수 있다
    saveTemplate(plan, madeFor);
    reset();
    setTemplateId(plan.templateId);
    // 모델이 정한 값을 위저드 기본값으로 넘긴다 — 사용자가 그 화면에서 고칠 수 있다
    setAnswers({
      lengthCap: plan.lengthCap,
      conciseness: plan.useConciseness,
      // 확인 방향은 초안을 뽑을 때만 쓰인다 — compile은 이 키를 읽지 않는다
      questionFocus: plan.questionFocus,
      // 어떤 템플릿으로 들어왔는지 — 위저드가 머리에 달고 있는다. compile은 읽지 않는다.
      builtName: plan.name,
      builtGoal: madeFor,
      builtStages: plan.stages,
    });
    navigate("/wizard");
  };

  const template = plan ? TEMPLATES.find((t) => t.id === plan.templateId) : null;

  return (
    <div className="builder">
      <span className="eyebrow">0단계 · 템플릿 만들기</span>
      <h1 className="q-big">무엇을 잘하게 만들고 싶으세요?</h1>
      <p className="q-help">
        목표를 한 문장으로 적어 주세요. 그 목표에 맞는 템플릿 — 평가 절차, 분량, 확인할 질문의
        방향 — 을 만들어 보여드립니다.
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
        <div className="builder-key">
          <ProviderCredentialInput
            provider="openai"
            value={credential}
            storedCredential={null}
            idPrefix="builder"
            disabled={busy}
            onChange={(next) => {
              setCredential(next);
              setError(null);
            }}
            onDelete={() => {
              setByoCredential("openai", null);
              setCredential("");
            }}
            onError={setError}
          />
        </div>
        <button
          type="button"
          className="primary builder-go"
          disabled={goal.trim() === "" || busy || readOnly}
          title={readOnly ? "다른 탭에서 이 프로젝트를 편집·실행 중입니다" : undefined}
          onClick={build}
        >
          {busy ? "템플릿 만드는 중…" : "이 목표에 맞는 템플릿 만들기"}
        </button>
        <ErrorNote message={error} live="assertive" style={{ marginTop: 12 }} />
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

      {busy || plan ? (
        <ActivityConsole
          model={DEFAULT_JUDGE_MODEL.openai}
          empty="목표를 읽고 구성을 짜는 과정이 여기에 흐릅니다."
          height={260}
        />
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
                  <h3>만들 것</h3>
                  <p className="builder-artifact">{plan.artifact}</p>
                </section>

                <section className="builder-block">
                  <h3>채점 설정</h3>
                  <ul className="builder-rules">
                    <li>
                      <div className="builder-rule-head">
                        <span>분량 상한</span>
                        <b>{plan.lengthCap.toLocaleString()}자</b>
                      </div>
                    </li>
                    <li>
                      <div className="builder-rule-head">
                        <span>길이를 점수에 반영</span>
                        <b>{plan.useConciseness ? "사용" : "사용 안 함"}</b>
                      </div>
                    </li>
                  </ul>
                </section>

                <section className="builder-block">
                  <h3>무엇을 물어 확인할지</h3>
                  <ul className="builder-rules">
                    {plan.questionFocus.map((focus) => (
                      <li key={focus}>
                        <div className="builder-rule-head">
                          <span>{focus}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setPlan({
                                ...plan,
                                questionFocus: plan.questionFocus.filter((f) => f !== focus),
                              })
                            }
                          >
                            빼기
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>

              <div className="builder-col">
                <section className="builder-block">
                  <h3>
                    진행 단계 <span className="builder-count">{plan.stages.length}</span>
                  </h3>
                  <p className="builder-note">
                    이 절차가 밟는 칸입니다. 각 칸이 실제로 하는 일은 절차가 정하고, 부르는
                    이름은 목표에 맞춰 바꿀 수 있습니다.
                  </p>
                  <ol className="builder-steps">
                    {plan.stages.map((stage, i) => (
                      <li key={stage.id}>
                        <i>{i + 1}</i>
                        <input
                          value={stage.label}
                          aria-label={`${i + 1}번째 단계 이름`}
                          onChange={(e) =>
                            setPlan({
                              ...plan,
                              stages: plan.stages.map((item) =>
                                item.id === stage.id ? { ...item, label: e.target.value } : item,
                              ),
                            })
                          }
                        />
                        {stage.title !== undefined ? (
                          <span className="builder-asks" title={stage.title}>
                            {stage.title}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </section>
              </div>
            </div>

            <footer className="builder-foot">
              <button type="button" className="primary builder-go" onClick={startRun}>
                이 템플릿으로 시작
              </button>
              <span className="hint">
                {template?.builderSummary ?? ""} 분량과 채점 설정은 다음 화면에 채워지고, 승인 전에
                직접 고칠 수 있습니다.
              </span>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
