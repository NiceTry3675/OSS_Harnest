/** 인터뷰 위저드 — 챗봇이 아니라 스텝 폼 + 라이브 블루프린트(SPEC §4.3).
 *  질문 정의는 템플릿 등록소(entry.questions)가 소유하고, 이 화면은 검증·수집만 담당한다.
 *  채점 모델(저지)은 승인 전에 확정되어야 하므로 마지막 스텝에서 고른다(SPEC §8). */

import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Question } from "@harnest/contracts";
import type { LlmClient } from "@harnest/template-handover";
import { getTemplate } from "../templates";
import { WizardBlueprint } from "../components/WizardBlueprint";
import { WizardCaseList, textareaStyle, type CasePair } from "../components/WizardCaseList";
import { appendFileTexts, extractFileText, FILE_ACCEPT } from "../lib/attachText";
import {
  createAssistMockClient,
  createGeminiClient,
  createOpenAIClient,
  getByoKey,
  setByoKey,
  testByoConnection,
  type ByoProvider,
} from "../lib/llm";
import {
  CASE_MAX_DEFAULT,
  CASE_MIN_DEFAULT,
  toAnswers,
  validate,
  type DraftValue,
} from "../lib/wizard-form";
import { useProject } from "../state";

const ROLE_LABEL: Record<Question["role"], string> = {
  material: "입력 자료",
  constraints: "제약 조건",
  criteria: "평가 기준",
};

type JudgeChoice = "mock" | ByoProvider;

const JUDGE_MODEL: Record<JudgeChoice, string> = {
  mock: "모의 모델",
  gemini: "gemini-3.7-flash",
  openai: "gpt-5.6-sol",
};

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
        // 저장된 answers에서 provenance까지 복원 — needsConfirm은 저장 경로에 존재할 수 없다
        // (확인하지 않은 초안은 toAnswers가 원천 제거하므로)
        const pairs: CasePair[] = Array.isArray(saved)
          ? (saved as Array<Partial<CasePair>>).map((p) => ({
              question: String(p.question ?? ""),
              expectedAnswer: String(p.expectedAnswer ?? ""),
              ...(p.provenance === "ai" || p.provenance === "ai_edited"
                ? { provenance: p.provenance }
                : {}),
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
  const [assistChoice, setAssistChoice] = useState<JudgeChoice>("mock");
  const [assistBusy, setAssistBusy] = useState(false);
  const [attachBusy, setAttachBusy] = useState(false);
  const [keyDrafts, setKeyDrafts] = useState<Record<ByoProvider, string>>(() => ({
    gemini: getByoKey("gemini") ?? "",
    openai: getByoKey("openai") ?? "",
  }));

  const liveAnswers = useMemo(() => toAnswers(questions, draft), [questions, draft]);

  // 저지 선언: needsModel이 아니면 무시되는 자리 표시 값을 넘긴다
  const judge = useMemo(
    () =>
      entry?.needsModel
        ? { provider: judgeChoice, model: JUDGE_MODEL[judgeChoice] }
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

  const busy = submitting || assistBusy || attachBusy;

  function onChange(value: DraftValue) {
    setDraft((d) => ({ ...d, [q.id]: value }));
    setError(null);
  }

  /** 파일 첨부 — 추출은 전부 이 브라우저 안에서 일어난다. 상한을 넘는 파일부터 중단하되
   *  이미 붙인 파일은 유지한다. */
  async function onAttachFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // 같은 파일 재첨부 허용
    if (files.length === 0) return;
    setAttachBusy(true);
    let current = typeof draft[q.id] === "string" ? (draft[q.id] as string) : "";
    let changed = false;
    let failure: string | null = null;
    for (const file of files) {
      let text: string;
      try {
        text = await extractFileText(file);
      } catch (err) {
        failure = err instanceof Error ? err.message : `'${file.name}' 파일을 읽지 못했습니다.`;
        break;
      }
      const next = appendFileTexts(current, [{ name: file.name, text }]);
      if (q.maxChars !== undefined && next.length > q.maxChars) {
        failure = `최대 ${q.maxChars.toLocaleString()}자 상한을 넘어 '${file.name}'부터 붙이지 못했습니다.`;
        break;
      }
      current = next;
      changed = true;
    }
    if (changed) onChange(current); // onChange가 error를 지우므로 실패 메시지는 그 뒤에 싣는다
    if (failure) setError(failure);
    setAttachBusy(false);
  }

  /** AI 케이스 초안 — 클릭당 본 호출 1회(+형식 재시도 1회), 실행 예산 밖(SPEC §5.2).
   *  초안은 "확인 필요" 상태로 들어가며, 확인 전에는 검증·수집이 모두 차단한다. */
  async function onDraftCases() {
    const assist = entry!.caseAssist;
    if (!assist || q.type !== "caseList") return;
    const pairs = Array.isArray(draft[q.id]) ? (draft[q.id] as CasePair[]) : [];
    const filled = pairs.filter((p) => p.question.trim() || p.expectedAnswer.trim());
    const max = q.max ?? CASE_MAX_DEFAULT;
    const remaining = max - filled.length;
    if (remaining <= 0) {
      setError(`쌍이 이미 ${max}개로 가득 차 초안을 더 만들 수 없습니다.`);
      return;
    }
    const materialQ = questions.find((mq) => mq.role === "material" && mq.type === "textarea");
    const material =
      materialQ && typeof draft[materialQ.id] === "string" ? (draft[materialQ.id] as string) : "";

    let client: LlmClient;
    if (assistChoice === "mock") {
      client = createAssistMockClient();
    } else {
      const key = keyDrafts[assistChoice].trim();
      if (!key) {
        setError(`${assistChoice === "openai" ? "OpenAI" : "Gemini"} API 키를 입력해 주세요.`);
        return;
      }
      client =
        assistChoice === "openai"
          ? createOpenAIClient(key, JUDGE_MODEL.openai)
          : createGeminiClient(key, JUDGE_MODEL.gemini);
    }

    setAssistBusy(true);
    setError(null);
    try {
      const existing = pairs
        .filter((p) => p.question.trim() && p.expectedAnswer.trim())
        .map((p) => ({ question: p.question.trim(), expectedAnswer: p.expectedAnswer.trim() }));
      const drafted = await assist.draft(material, existing, remaining, client);
      if (assistChoice !== "mock") {
        // 실패한 키가 기존의 정상 키를 덮지 않도록 성공한 뒤에만 저장한다.
        setByoKey(assistChoice, keyDrafts[assistChoice].trim());
      }
      if (drafted.length === 0) {
        setError("새 초안이 없습니다 — 모두 기존 질문과 중복이었습니다.");
        return;
      }
      // 빈 행부터 채우고, 모자라면 상한까지 행을 추가한다
      const next = [...pairs];
      for (const d of drafted) {
        const pair: CasePair = {
          question: d.question,
          expectedAnswer: d.expectedAnswer,
          provenance: "ai",
          needsConfirm: true,
        };
        const emptyIdx = next.findIndex((p) => !p.question.trim() && !p.expectedAnswer.trim());
        if (emptyIdx >= 0) next[emptyIdx] = pair;
        else if (next.length < max) next.push(pair);
      }
      onChange(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "초안 생성에 실패했습니다.");
    } finally {
      setAssistBusy(false);
    }
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
    if (entry!.needsModel && judgeChoice !== "mock") {
      const key = keyDrafts[judgeChoice].trim();
      if (!key) {
        setError(`${judgeChoice === "openai" ? "OpenAI" : "Gemini"} API 키를 입력해 주세요.`);
        return;
      }
    }
    setSubmitting(true);
    try {
      if (entry!.needsModel && judgeChoice !== "mock") {
        const key = keyDrafts[judgeChoice].trim();
        await testByoConnection(judgeChoice, key, JUDGE_MODEL[judgeChoice]);
        // 실패한 키가 기존의 정상 키를 덮지 않도록 성공한 뒤에만 저장한다.
        setByoKey(judgeChoice, key);
      }
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
                <>
                  <WizardCaseList
                    pairs={Array.isArray(draft[q.id]) ? (draft[q.id] as CasePair[]) : []}
                    minPairs={q.min ?? CASE_MIN_DEFAULT}
                    maxPairs={q.max ?? CASE_MAX_DEFAULT}
                    onChange={onChange}
                  />
                  {entry.caseAssist ? (
                    <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                      <label>AI 초안 도우미 (선택)</label>
                      <div style={{ display: "grid", gap: 6, fontSize: 14 }}>
                        {(["mock", "gemini", "openai"] as const).map((choice) => (
                          <label
                            key={choice}
                            style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}
                          >
                            <input
                              type="radio"
                              name="assist-model"
                              style={{ width: "auto" }}
                              checked={assistChoice === choice}
                              onChange={() => {
                                setAssistChoice(choice);
                                setError(null);
                              }}
                            />
                            {choice === "mock"
                              ? "모의 모델 (무료 · 데모용 결정적 초안)"
                              : choice === "gemini"
                                ? "Gemini (BYO 키 — 키는 이 브라우저에만 저장됩니다)"
                                : "OpenAI · GPT-5.6 Sol (BYO 키 — 브라우저 직행)"}
                          </label>
                        ))}
                      </div>
                      {assistChoice !== "mock" ? (
                        <div style={{ marginTop: 8 }}>
                          <input
                            type="password"
                            value={keyDrafts[assistChoice]}
                            placeholder={`${assistChoice === "openai" ? "OpenAI" : "Gemini"} API 키`}
                            autoComplete="off"
                            onChange={(e) => {
                              const value = e.target.value;
                              setKeyDrafts((current) => ({ ...current, [assistChoice]: value }));
                              setError(null);
                            }}
                          />
                        </div>
                      ) : null}
                      <div style={{ marginTop: 8 }}>
                        <button type="button" disabled={busy} onClick={onDraftCases}>
                          {assistBusy ? "초안 생성 중…" : "AI로 질답 초안 만들기"}
                        </button>
                      </div>
                      <div className="hint">
                        {entry.caseAssist.nudge} 이 호출은 클릭당 1회이며 실행 비용 예산과
                        별개입니다. 초안은 각 쌍의 확인 버튼을 눌러야만 제출에 포함됩니다.
                      </div>
                    </div>
                  ) : null}
                </>
              ) : q.type === "textarea" ? (
                <>
                  <textarea
                    id={`q-${q.id}`}
                    rows={8}
                    style={textareaStyle}
                    value={typeof draft[q.id] === "string" ? (draft[q.id] as string) : ""}
                    placeholder={q.placeholder}
                    autoFocus
                    onChange={(e) => onChange(e.target.value)}
                  />
                  {q.attachText ? (
                    <div style={{ marginTop: 8 }}>
                      <input
                        type="file"
                        multiple
                        accept={FILE_ACCEPT}
                        disabled={busy}
                        style={{ width: "auto" }}
                        onChange={onAttachFiles}
                      />
                      <div className="hint">
                        {attachBusy
                          ? "파일에서 텍스트를 추출하는 중…"
                          : `현재 ${(typeof draft[q.id] === "string" ? (draft[q.id] as string) : "").length.toLocaleString()}자` +
                            (q.maxChars !== undefined
                              ? ` / 최대 ${q.maxChars.toLocaleString()}자`
                              : "") +
                            " · 파일은 이 브라우저에서만 읽히며 서버로 전송되지 않습니다."}
                      </div>
                    </div>
                  ) : null}
                </>
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
                  <label style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
                    <input
                      type="radio"
                      name="judge-model"
                      style={{ width: "auto" }}
                      checked={judgeChoice === "openai"}
                      onChange={() => {
                        setJudgeChoice("openai");
                        setError(null);
                      }}
                    />
                    OpenAI · GPT-5.6 Sol (BYO 키 — 브라우저 직행)
                  </label>
                </div>
                {judgeChoice !== "mock" ? (
                  <div style={{ marginTop: 8 }}>
                    <input
                      type="password"
                      value={keyDrafts[judgeChoice]}
                      placeholder={`${judgeChoice === "openai" ? "OpenAI" : "Gemini"} API 키`}
                      autoComplete="off"
                      onChange={(e) => {
                        const value = e.target.value;
                        setKeyDrafts((current) => ({ ...current, [judgeChoice]: value }));
                        setError(null);
                      }}
                    />
                    <div className="hint">
                      키는 이 브라우저(localStorage)에만 저장되고, 요청은 {judgeChoice === "openai" ? "OpenAI" : "Gemini"} API로 직접 전송됩니다.
                      승인 화면으로 이동하기 전에 선택한 모델로 1회 연결을 확인합니다.
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}

            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                disabled={step === 0 || busy}
                onClick={() => {
                  setError(null);
                  setStep(step - 1);
                }}
              >
                이전
              </button>
              <button type="submit" className="primary" disabled={busy}>
                {isLast
                  ? submitting
                    ? judgeChoice === "mock"
                      ? "확인 중…"
                      : "모델 연결 확인 중…"
                    : "작성 완료 — 승인 화면으로"
                  : "다음"}
              </button>
            </div>
          </form>
        </div>

        <WizardBlueprint entry={entry} answers={liveAnswers} judge={judge} />
      </div>
    </div>
  );
}
