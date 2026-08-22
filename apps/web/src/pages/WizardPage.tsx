/** 인터뷰 위저드 — 챗봇이 아니라 스텝 폼 + 라이브 블루프린트(SPEC §4.3).
 *  질문 정의는 템플릿 등록소(entry.questions)가 소유하고, 이 화면은 검증·수집만 담당한다.
 *  채점 모델(저지)은 승인 전에 확정되어야 하므로 마지막 스텝에서 고른다(SPEC §12 미결 7). */

import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Question } from "@harnest/contracts";
import { getTemplate } from "../templates";
import { WizardBlueprint } from "../components/WizardBlueprint";
import { WizardCaseList, textareaStyle, type CasePair } from "../components/WizardCaseList";
import { getByoKey, setByoKey } from "../lib/llm";
import { useProject } from "../state";

const ROLE_LABEL: Record<Question["role"], string> = {
  material: "입력 자료",
  constraints: "제약 조건",
  criteria: "평가 기준",
};

/** caseList 안내 기본 범위 — 질문이 min/max를 선언하면 그 값을 따른다 */
const CASE_MIN_DEFAULT = 4;
const CASE_MAX_DEFAULT = 9;

type DraftValue = string | CasePair[];
type JudgeChoice = "mock" | "gemini";

function validate(q: Question, value: DraftValue): string | null {
  if (q.type === "caseList") {
    const pairs = Array.isArray(value) ? value : [];
    const halfFilled = pairs.some(
      (p) => (p.question.trim() === "") !== (p.expectedAnswer.trim() === ""),
    );
    if (halfFilled) return "각 쌍의 질문과 답을 모두 채워 주세요.";
    const complete = pairs.filter((p) => p.question.trim() && p.expectedAnswer.trim());
    const min = q.min ?? CASE_MIN_DEFAULT;
    if (complete.length < min) return `질문·답 쌍을 ${min}개 이상 채워 주세요.`;
    return null;
  }
  const v = typeof value === "string" ? value.trim() : "";
  if (q.type === "textarea") return null; // 선택 입력 — 빈 값 통과
  if (q.type === "staffList") {
    const names = v.split(",").map((s) => s.trim()).filter(Boolean);
    if (names.length < 3) return "쉼표로 구분해 3명 이상 입력해 주세요.";
    return null;
  }
  if (q.type === "number") {
    if (v === "") return "값을 입력해 주세요.";
    const n = Number(v);
    if (!Number.isInteger(n)) return "정수를 입력해 주세요.";
    if (q.min !== undefined && q.max !== undefined && (n < q.min || n > q.max)) {
      return `${q.min}~${q.max} 사이의 정수를 입력해 주세요.`;
    }
    if (q.min !== undefined && n < q.min) return `${q.min} 이상이어야 합니다.`;
    if (q.max !== undefined && n > q.max) return `${q.max} 이하여야 합니다.`;
    return null;
  }
  if (v === "") return "값을 입력해 주세요.";
  return null;
}

/** 폼 초안 → 인터뷰 답변 맵(숫자는 number, caseList는 완성된 쌍 배열 — id는 compile이 부여) */
function toAnswers(
  questions: Question[],
  draft: Record<string, DraftValue>,
): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  for (const q of questions) {
    const value = draft[q.id];
    if (q.type === "caseList") {
      const pairs = Array.isArray(value) ? value : [];
      answers[q.id] = pairs
        .map((p) => ({ question: p.question.trim(), expectedAnswer: p.expectedAnswer.trim() }))
        .filter((p) => p.question.length > 0 && p.expectedAnswer.length > 0);
      continue;
    }
    const raw = typeof value === "string" ? value.trim() : "";
    answers[q.id] = q.type === "number" ? Number(raw) : raw;
  }
  return answers;
}

export function WizardPage() {
  const { templateId, answers: savedAnswers, setAnswers, setCompiled } = useProject();
  const navigate = useNavigate();
  const entry = getTemplate(templateId);
  const questions = entry?.questions ?? [];

  const [draft, setDraft] = useState<Record<string, DraftValue>>(() => {
    const init: Record<string, DraftValue> = {};
    for (const q of questions) {
      const saved = savedAnswers[q.id];
      if (q.type === "caseList") {
        const pairs: CasePair[] = Array.isArray(saved)
          ? (saved as Array<Partial<CasePair>>).map((p) => ({
              question: String(p.question ?? ""),
              expectedAnswer: String(p.expectedAnswer ?? ""),
            }))
          : [];
        const min = q.min ?? CASE_MIN_DEFAULT;
        while (pairs.length < min) pairs.push({ question: "", expectedAnswer: "" });
        init[q.id] = pairs;
        continue;
      }
      init[q.id] =
        saved !== undefined && saved !== null
          ? String(saved)
          : q.defaultValue !== undefined && q.defaultValue !== null
            ? String(q.defaultValue)
            : "";
    }
    return init;
  });
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [judgeChoice, setJudgeChoice] = useState<JudgeChoice>("mock");
  const [keyDraft, setKeyDraft] = useState<string>(() => getByoKey() ?? "");

  const liveAnswers = useMemo(() => toAnswers(questions, draft), [questions, draft]);

  // 저지 선언: needsModel이 아니면 무시되는 자리 표시 값을 넘긴다
  const judge = useMemo(
    () =>
      entry?.needsModel
        ? judgeChoice === "gemini"
          ? { provider: "gemini" as const, model: "gemini-3.7-flash" }
          : { provider: "mock" as const, model: "모의 모델" }
        : { provider: "mock" as const, model: "-" },
    [entry, judgeChoice],
  );

  if (!entry) {
    return (
      <div className="card">
        <h1>템플릿이 선택되지 않았습니다</h1>
        <p className="sub">먼저 홈에서 템플릿을 골라 주세요.</p>
        <Link to="/">
          <button className="primary">템플릿 고르러 가기</button>
        </Link>
      </div>
    );
  }

  const q = questions[step];
  const isLast = step === questions.length - 1;

  function onChange(value: DraftValue) {
    setDraft((d) => ({ ...d, [q.id]: value }));
    setError(null);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const err = validate(q, draft[q.id] ?? "");
    if (err) {
      setError(err);
      return;
    }
    if (!isLast) {
      setStep(step + 1);
      return;
    }
    if (entry!.needsModel && judgeChoice === "gemini") {
      const key = keyDraft.trim();
      if (!key) {
        setError("Gemini API 키를 입력해 주세요.");
        return;
      }
      setByoKey(key);
    }
    setSubmitting(true);
    try {
      const answers = toAnswers(questions, draft);
      const compiled = await entry!.compile(
        { schemaVersion: "skeleton-1", templateId: entry!.id, answers },
        judge,
      );
      setAnswers(answers);
      setCompiled(compiled);
      navigate("/approve");
    } catch (err2) {
      setError(err2 instanceof Error ? err2.message : "답변을 확인해 주세요.");
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1>{entry.name}</h1>
      <p className="sub">몇 가지 질문에 답하면, 오른쪽에 채점 기준이 실시간으로 만들어집니다.</p>

      <div className="row">
        <div className="card grow">
          <div style={{ marginBottom: 14 }}>
            <span className="badge">{step + 1} / {questions.length} 단계</span>
            <span className="badge muted">{ROLE_LABEL[q.role]}</span>
          </div>

          <form onSubmit={onSubmit}>
            <div className="field">
              {q.type === "caseList" ? (
                <label>{q.label}</label>
              ) : (
                <label htmlFor={`q-${q.id}`}>{q.label}</label>
              )}
              {q.type === "caseList" ? (
                <WizardCaseList
                  pairs={Array.isArray(draft[q.id]) ? (draft[q.id] as CasePair[]) : []}
                  minPairs={q.min ?? CASE_MIN_DEFAULT}
                  maxPairs={q.max ?? CASE_MAX_DEFAULT}
                  onChange={onChange}
                />
              ) : q.type === "textarea" ? (
                <textarea
                  id={`q-${q.id}`}
                  rows={8}
                  style={textareaStyle}
                  value={typeof draft[q.id] === "string" ? (draft[q.id] as string) : ""}
                  placeholder={q.placeholder}
                  autoFocus
                  onChange={(e) => onChange(e.target.value)}
                />
              ) : (
                <input
                  id={`q-${q.id}`}
                  type={q.type === "number" ? "number" : "text"}
                  value={typeof draft[q.id] === "string" ? (draft[q.id] as string) : ""}
                  placeholder={q.placeholder}
                  min={q.min}
                  max={q.max}
                  autoFocus
                  onChange={(e) => onChange(e.target.value)}
                />
              )}
              {q.help ? <div className="hint">{q.help}</div> : null}
            </div>

            {isLast && entry.needsModel ? (
              <div
                className="field"
                style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}
              >
                <label>채점 모델 선택</label>
                <div style={{ display: "grid", gap: 6, fontSize: 14 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
                    <input
                      type="radio"
                      name="judge-model"
                      style={{ width: "auto" }}
                      checked={judgeChoice === "mock"}
                      onChange={() => {
                        setJudgeChoice("mock");
                        setError(null);
                      }}
                    />
                    모의 모델 (무료 · 데모용 결정적 채점)
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
                    <input
                      type="radio"
                      name="judge-model"
                      style={{ width: "auto" }}
                      checked={judgeChoice === "gemini"}
                      onChange={() => {
                        setJudgeChoice("gemini");
                        setError(null);
                      }}
                    />
                    Gemini (BYO 키 — 키는 이 브라우저에만 저장됩니다)
                  </label>
                </div>
                {judgeChoice === "gemini" ? (
                  <div style={{ marginTop: 8 }}>
                    <input
                      type="password"
                      value={keyDraft}
                      placeholder="Gemini API 키"
                      autoComplete="off"
                      onChange={(e) => {
                        setKeyDraft(e.target.value);
                        setError(null);
                      }}
                    />
                    <div className="hint">
                      키는 이 브라우저(localStorage)에만 저장되고, 요청은 Gemini API로 직접
                      전송됩니다.
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}

            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                disabled={step === 0 || submitting}
                onClick={() => {
                  setError(null);
                  setStep(step - 1);
                }}
              >
                이전
              </button>
              <button type="submit" className="primary" disabled={submitting}>
                {isLast ? (submitting ? "확인 중…" : "작성 완료 — 승인 화면으로") : "다음"}
              </button>
            </div>
          </form>
        </div>

        <WizardBlueprint entry={entry} answers={liveAnswers} judge={judge} />
      </div>
    </div>
  );
}
