/** 인터뷰 위저드 — 챗봇이 아니라 스텝 폼 + 라이브 블루프린트(SPEC §4.3).
 *  질문 정의는 템플릿이 소유하고, 이 화면은 검증·수집만 담당한다. */

import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { Question } from "@harnest/contracts";
import { TEMPLATE_ID, TEMPLATE_NAME, compile, questions } from "@harnest/template-timetable";
import { WizardBlueprint } from "../components/WizardBlueprint";
import { useProject } from "../state";

const ROLE_LABEL: Record<Question["role"], string> = {
  material: "입력 자료",
  constraints: "제약 조건",
  criteria: "평가 기준",
};

function validate(q: Question, raw: string): string | null {
  const v = raw.trim();
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

/** 폼 문자열 → 인터뷰 답변 맵(숫자 질문은 number로 변환) */
function toAnswers(draft: Record<string, string>): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  for (const q of questions) {
    const raw = (draft[q.id] ?? "").trim();
    answers[q.id] = q.type === "number" ? Number(raw) : raw;
  }
  return answers;
}

export function WizardPage() {
  const { answers: savedAnswers, setAnswers, setCompiled } = useProject();
  const navigate = useNavigate();

  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const q of questions) {
      const saved = savedAnswers[q.id];
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

  const q = questions[step];
  const isLast = step === questions.length - 1;
  const liveAnswers = useMemo(() => toAnswers(draft), [draft]);

  function onChange(value: string) {
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
    setSubmitting(true);
    try {
      const answers = toAnswers(draft);
      const compiled = await compile({
        schemaVersion: "skeleton-1",
        templateId: TEMPLATE_ID,
        answers,
      });
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
      <h1>{TEMPLATE_NAME}</h1>
      <p className="sub">몇 가지 질문에 답하면, 오른쪽에 채점 기준이 실시간으로 만들어집니다.</p>

      <div className="row">
        <div className="card grow">
          <div style={{ marginBottom: 14 }}>
            <span className="badge">{step + 1} / {questions.length} 단계</span>
            <span className="badge muted">{ROLE_LABEL[q.role]}</span>
          </div>

          <form onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor={`q-${q.id}`}>{q.label}</label>
              <input
                id={`q-${q.id}`}
                type={q.type === "number" ? "number" : "text"}
                value={draft[q.id] ?? ""}
                placeholder={q.placeholder}
                min={q.min}
                max={q.max}
                autoFocus
                onChange={(e) => onChange(e.target.value)}
              />
              {q.help ? <div className="hint">{q.help}</div> : null}
              {error ? <div className="error">{error}</div> : null}
            </div>

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

        <WizardBlueprint answers={liveAnswers} />
      </div>
    </div>
  );
}
