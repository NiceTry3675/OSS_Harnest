/** 인터뷰 위저드 — 챗봇이 아니라 스텝 폼 + 라이브 블루프린트(SPEC §4.3).
 *  질문 정의는 템플릿 등록소(entry.questions)가 소유하고, 이 화면은 검증·수집만 담당한다.
 *  채점 모델(저지)은 승인 전에 확정되어야 하므로 마지막 스텝에서 고른다(SPEC §8). */

import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Question } from "@harnest/contracts";
import type { LlmClient } from "@harnest/template-handover";
import { getTemplate } from "../templates";
import { WizardBlueprint } from "../components/WizardBlueprint";
import { ActivityConsole } from "../components/ActivityConsole";
import { appendStream, clearStream, endStream, withActivityLog } from "../lib/activityLog";
import { WizardCaseList, type CasePair } from "../components/WizardCaseList";
import { ModelPicker } from "../components/ModelPicker";
import { ProviderCredentialInput } from "../components/ProviderCredentialInput";
import { appendFileTexts, extractFileText, FILE_ACCEPT } from "../lib/attachText";
import {
  createByoClient,
  createAssistMockClient,
  getByoCredential,
  loadSharedProviders,
  normalizeVertexServiceAccount,
  PROVIDER_LABEL,
  setByoCredential,
  testByoConnection,
  detectByoCredential,
  listAvailableModels,
  type CredentialProvider,
  type AvailableModel,
  testSharedConnection,
  type ByoProvider,
  type SharedProvider,
} from "../lib/llm";
import {
  CASE_MAX_DEFAULT,
  CASE_MIN_DEFAULT,
  toAnswers,
  validate,
  type DraftValue,
} from "../lib/wizard-form";
import { setFlowStep } from "../lib/flowStep";
import { useProject } from "../state";

const ROLE_LABEL: Record<Question["role"], string> = {
  material: "입력 자료",
  constraints: "제약 조건",
  criteria: "평가 기준",
};

type JudgeChoice = "mock" | CredentialProvider;

/** 목록을 불러오기 전에 쓰는 기본 모델 — 고르면 그 값이 이긴다 */
const JUDGE_MODEL: Record<JudgeChoice, string> = {
  mock: "모의 모델",
  gemini: "gemini-3.7-flash",
  vertex: "gemini-3.7-flash",
  openai: "gpt-5.6-sol",
  anthropic: "claude-sonnet-4-5",
  openrouter: "openai/gpt-5.6-sol",
  ollama: "llama3.1",
};

/** 카드로 고르는 공급자 — 모의 모델은 고르는 것이 아니라 빠져나가는 것이라 따로 둔다 */
const PROVIDER_CHOICES: CredentialProvider[] = [
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
  "vertex",
  "ollama",
];

const PROVIDER_OPTION_LABEL: Record<JudgeChoice, string> = {
  mock: "모의 모델 (외부 호출 없는 결정적 데모)",
  gemini: "Gemini (API 키 — 브라우저 저장·직접 호출)",
  vertex: "Vertex AI (서비스 계정 JSON — 브라우저 직접 호출)",
  openai: "OpenAI (API 키 — 브라우저 저장·직접 호출)",
  anthropic: "Claude (API 키 — 브라우저 저장·직접 호출)",
  openrouter: "OpenRouter (API 키 — 여러 회사 모델을 한 키로)",
  ollama: "Ollama (내 컴퓨터 주소 — 키 없음)",
};

const PROVIDER_CARD: Record<
  JudgeChoice,
  { name: string; model: string; description: string }
> = {
  mock: {
    name: "모의 모델",
    model: "키 없이 사용",
    description: "외부 모델 호출 없이 결정적으로 제품 흐름을 확인합니다.",
  },
  openai: {
    name: "OpenAI",
    model: JUDGE_MODEL.openai,
    description: "API 키로 브라우저에서 직접 호출합니다. 공유 키가 설정돼 있으면 비워 둘 수 있습니다.",
  },
  anthropic: {
    name: "Claude",
    model: JUDGE_MODEL.anthropic,
    description: "Anthropic API 키로 브라우저에서 직접 호출합니다.",
  },
  gemini: {
    name: "Google Gemini",
    model: JUDGE_MODEL.gemini,
    description: "API 키로 브라우저에서 직접 호출합니다. 공유 키가 설정돼 있으면 비워 둘 수 있습니다.",
  },
  openrouter: {
    name: "OpenRouter",
    model: JUDGE_MODEL.openrouter,
    description: "한 키로 여러 회사 모델을 씁니다. 쓸 수 있는 모델을 목록으로 불러옵니다.",
  },
  vertex: {
    name: "Vertex AI",
    model: JUDGE_MODEL.vertex,
    description: "서비스 계정 JSON을 붙여넣습니다. 사내 Google Cloud 계정을 쓸 때 고릅니다.",
  },
  ollama: {
    name: "Ollama",
    model: JUDGE_MODEL.ollama,
    description: "내 컴퓨터에서 도는 모델입니다. 키 대신 주소를 넣습니다 (예: localhost:11434).",
  },
};

/** 남은 분량을 원으로 보여준다 — 숫자만 있으면 얼마나 찼는지 감이 안 온다 */
function CharRing({ filled, max }: { filled: number; max: number }) {
  const r = 11;
  const circumference = 2 * Math.PI * r;
  const ratio = Math.min(1, max > 0 ? filled / max : 0);
  return (
    <svg className="char-ring" viewBox="0 0 26 26" aria-hidden="true">
      <circle className="bg" cx="13" cy="13" r={r} />
      <circle
        className="fg"
        cx="13"
        cy="13"
        r={r}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - ratio)}
      />
    </svg>
  );
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
        // 빈 카드를 미리 깔지 않는다 — 입력창에서 하나씩 추가한다
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

  // 단계가 바뀌면 맨 위에서 시작한다 — 긴 목록 중간에서 열리면 어디인지 알 수 없다
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
    const questionId = questions[step]?.id;
    setFlowStep(questionId ? { kind: "question", questionId } : { kind: "outside" });
  }, [questions, step]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 기본값을 공급자로 둔다 — 키 칸이 처음부터 보여야 한다는 요청
  const [judgeChoice, setJudgeChoice] = useState<JudgeChoice>("openai");
  // 초안은 실제 모델로 뽑아야 쓸 만하다 — 모의 모델은 화면 확인용이라 기본값에서 뺀다
  const [assistChoice, setAssistChoice] = useState<JudgeChoice>("gemini");
  const [assistBusy, setAssistBusy] = useState(false);
  // 클릭 1회에 요청할 초안 개수 — 남은 슬롯까지 자유롭게 고른다(호출은 개수와 무관하게 클릭당 1회)
  const [assistCount, setAssistCount] = useState(3);
  // 초안 난이도 — 값의 의미는 템플릿의 difficulty 선언이 소유한다
  const [assistDifficulty, setAssistDifficulty] = useState(
    () => entry?.caseAssist?.difficulty?.defaultValue ?? 1,
  );
  const [attachBusy, setAttachBusy] = useState(false);
  const [assistText, setAssistText] = useState("");
  const [attached, setAttached] = useState<Array<{ name: string; size: string }>>([]);
  const [credentialDrafts, setCredentialDrafts] = useState<Record<CredentialProvider, string>>(
    () => ({
      gemini: getByoCredential("gemini") ?? "",
      vertex: "",
      openai: getByoCredential("openai") ?? "",
      anthropic: getByoCredential("anthropic") ?? "",
      openrouter: getByoCredential("openrouter") ?? "",
      ollama: getByoCredential("ollama") ?? "",
    }),
  );
  // 고른 모델 — 비어 있으면 공급자 기본값을 쓴다
  const [judgeModel, setJudgeModel] = useState("");
  // 공급자별로 불러온 모델 목록
  const [modelList, setModelList] = useState<AvailableModel[]>([]);
  const [modelBusy, setModelBusy] = useState(false);
  const [modelNote, setModelNote] = useState<string | null>(null);
  const [storedVertexCredential, setStoredVertexCredential] = useState<string | null>(() =>
    getByoCredential("vertex"),
  );
  const [sharedProviders, setSharedProviders] = useState<Partial<Record<SharedProvider, boolean>>>(
    {},
  );

  useEffect(() => {
    let cancelled = false;
    loadSharedProviders().then((result) => {
      if (!cancelled) setSharedProviders(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const liveAnswers = useMemo(() => toAnswers(questions, draft), [questions, draft]);

  // 저지 선언: needsModel이 아니면 무시되는 자리 표시 값을 넘긴다
  const judge = useMemo(
    () =>
      entry?.needsModel
        ? { provider: judgeChoice, model: judgeModel.trim() || JUDGE_MODEL[judgeChoice] }
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

  const sharedAvailable = (provider: CredentialProvider): boolean =>
    (provider === "gemini" || provider === "openai") && sharedProviders[provider] === true;

  // 자격 증명이 채워지면 잠깐 기다렸다가 모델 목록을 스스로 불러온다.
  // 글자를 칠 때마다 부르지 않도록 잠시 멈춘 뒤에만 호출한다.
  useEffect(() => {
    if (judgeChoice === "mock") return;
    const credential =
      judgeChoice === "vertex"
        ? credentialDrafts.vertex.trim() || storedVertexCredential || ""
        : credentialDrafts[judgeChoice].trim();
    if (!credential) {
      setModelList([]);
      setModelNote(null);
      return;
    }
    let alive = true;
    setModelBusy(true);
    setModelNote(null);
    const timer = window.setTimeout(() => {
      listAvailableModels(judgeChoice, credential)
        .then((models) => {
          if (!alive) return;
          setModelList(models);
          setJudgeModel((current) =>
            current && models.some((m) => m.id === current) ? current : (models[0]?.id ?? current),
          );
        })
        .catch((err: unknown) => {
          if (!alive) return;
          setModelList([]);
          setModelNote(err instanceof Error ? err.message : "모델 목록을 불러오지 못했습니다.");
        })
        .finally(() => {
          if (alive) setModelBusy(false);
        });
    }, 700);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      window.clearTimeout(timer);
    };
  }, [judgeChoice, credentialDrafts, storedVertexCredential]);

  /** 고른 공급자의 자격 증명으로 쓸 수 있는 모델을 불러온다.
   *  OpenRouter·Ollama·OpenAI는 실제 목록을, 나머지는 정리해 둔 목록을 준다. */
  const loadModels = async (): Promise<void> => {
    if (judgeChoice === "mock") return;
    const credential = credentialFor(judgeChoice);
    if (!credential) {
      setModelNote(
        judgeChoice === "ollama"
          ? "먼저 Ollama 주소를 넣어 주세요 (예: localhost:11434)."
          : "먼저 API 키를 넣어 주세요.",
      );
      return;
    }
    setModelBusy(true);
    setModelNote(null);
    try {
      const models = await listAvailableModels(judgeChoice, credential);
      setModelList(models);
      if (models.length === 0) {
        setModelNote("쓸 수 있는 모델을 찾지 못했습니다.");
      } else if (!models.some((m) => m.id === judgeModel)) {
        setJudgeModel(models[0].id);
      }
    } catch (err) {
      setModelList([]);
      setModelNote(err instanceof Error ? err.message : "모델 목록을 불러오지 못했습니다.");
    } finally {
      setModelBusy(false);
    }
  };

  const credentialFor = (provider: CredentialProvider): string => {
    const draft = credentialDrafts[provider].trim();
    return provider === "vertex" ? draft || storedVertexCredential || "" : draft;
  };

  const persistCredential = (provider: CredentialProvider, raw: string): void => {
    const saved = provider === "vertex" ? normalizeVertexServiceAccount(raw) : raw.trim();
    setByoCredential(provider, saved);
    if (provider === "vertex") {
      setStoredVertexCredential(saved);
      setCredentialDrafts((current) => ({ ...current, vertex: "" }));
    }
  };

  const deleteCredential = (provider: CredentialProvider): void => {
    setByoCredential(provider, null);
    setCredentialDrafts((current) => ({ ...current, [provider]: "" }));
    if (provider === "vertex") setStoredVertexCredential(null);
    setError(null);
  };

  // AI 초안 슬라이더 범위 — 남은 슬롯을 넘겨 요청할 수 없다(빈 행은 채울 슬롯으로 계산)
  const casePairs =
    q.type === "caseList" && Array.isArray(draft[q.id]) ? (draft[q.id] as CasePair[]) : [];
  const caseFilled = casePairs.filter((p) => p.question.trim() || p.expectedAnswer.trim()).length;
  const assistSliderMax = Math.max(1, (q.max ?? CASE_MAX_DEFAULT) - caseFilled);
  const assistEffective = Math.min(assistCount, assistSliderMax);

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
    const added: Array<{ name: string; size: string }> = [];
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
      added.push({ name: file.name, size: `${Math.max(1, Math.round(file.size / 1024))}KB` });
    }
    if (added.length > 0) setAttached((prev) => [...prev, ...added]);
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
      const credential = credentialFor(assistChoice);
      if (!credential) {
        setError(`${PROVIDER_LABEL[assistChoice]} 자격 증명을 입력해 주세요.`);
        return;
      }
      try {
        client = createByoClient(assistChoice, credential, JUDGE_MODEL[assistChoice]);
      } catch (credentialError) {
        setError(
          credentialError instanceof Error
            ? credentialError.message
            : "모델 자격 증명을 해석하지 못했습니다.",
        );
        return;
      }
    }

    setAssistBusy(true);
    setAssistText("");
    clearStream("자료를 읽고 질문을 뽑는 중");
    setError(null);
    try {
      const existing = pairs
        .filter((p) => p.question.trim() && p.expectedAnswer.trim())
        .map((p) => ({ question: p.question.trim(), expectedAnswer: p.expectedAnswer.trim() }));
      const drafted = await assist.draft(
        material,
        existing,
        Math.min(assistCount, remaining),
        withActivityLog(client, "자료를 읽고 질문을 뽑는 중"),
        assist.difficulty ? assistDifficulty : undefined,
      );
      if (assistChoice !== "mock") {
        // 실패한 자격 증명이 기존의 정상 값을 덮지 않도록 성공한 뒤에만 저장한다.
        persistCredential(assistChoice, credentialFor(assistChoice));
      }
      if (drafted.length === 0) {
        setError("새 초안이 없습니다 — 모두 기존 질문과 중복이었습니다.");
        return;
      }
      setAssistText(
        drafted
          .map((d, n) => `${n + 1}. ${d.question}\n   ${d.expectedAnswer}`)
          .join("\n\n"),
      );
      appendStream(
        drafted
          .map((d, n) => {
            const cited = d.evidence ?? [];
            if (cited.length === 0) {
              return `${n + 1}. 근거 대목을 표시하지 않았습니다 — 확인할 때 자료와 대조해 보세요.`;
            }
            const missing = cited.filter((e) => !e.found).length;
            return missing === 0
              ? `${n + 1}. 인용한 ${cited.length}개 대목이 자료에 그대로 있습니다.`
              : `${n + 1}. 인용한 ${cited.length}개 중 ${missing}개를 자료에서 찾지 못했습니다 — 확인할 때 대조해 보세요.`;
          })
          .join(String.fromCharCode(10)),
        "인용한 대목이 자료에 실제로 있는지",
      );
      endStream(`초안 ${drafted.length}개를 만들었습니다`);
      // 빈 행부터 채우고, 모자라면 상한까지 행을 추가한다
      const next = [...pairs];
      for (const d of drafted) {
        const pair: CasePair = {
          question: d.question,
          expectedAnswer: d.expectedAnswer,
          provenance: "ai",
          needsConfirm: true,
          ...(d.evidence !== undefined ? { evidence: d.evidence } : {}),
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
      const credential = credentialFor(judgeChoice);
      if (!credential && !sharedAvailable(judgeChoice)) {
        setError(`${PROVIDER_LABEL[judgeChoice]} 자격 증명을 입력해 주세요.`);
        return;
      }
    }
    setSubmitting(true);
    try {
      if (entry!.needsModel && judgeChoice !== "mock") {
        const credential = credentialFor(judgeChoice);
        if (credential) {
          await testByoConnection(judgeChoice, credential, judgeModel.trim() || JUDGE_MODEL[judgeChoice]);
          // 실패한 자격 증명이 기존의 정상 값을 덮지 않도록 성공한 뒤에만 저장한다.
          persistCredential(judgeChoice, credential);
        } else {
          // 키를 비워 뒀고 관리자 공유 키가 있는 경우 — 그 경로도 승인 전에 한 번 확인한다.
          await testSharedConnection(judgeChoice as SharedProvider, JUDGE_MODEL[judgeChoice]);
        }
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
    <div className="wizard">
      <div className={`wizard-grid${isLast ? " is-wide" : ""}`}>
        <div className="wizard-main route-swap" key={step}>
          <div className="wizard-tags">
            <span className="eyebrow">
              {step + 1}단계 · {ROLE_LABEL[q.role]}
            </span>
            {entry.devSample ? (
              <button
                type="button"
                className="dev-fill"
                title="개발 서버에서만 보입니다"
                onClick={() => {
                  setError(null);
                  // 지금 단계의 답만 채운다 — 어떻게 채워지는지 보고 직접 넘길 수 있어야 한다
                  const sample = entry.devSample as Record<string, DraftValue>;
                  if (!(q.id in sample)) return;
                  setDraft((d) => ({ ...d, [q.id]: sample[q.id] }));
                }}
                disabled={!(q.id in (entry.devSample as Record<string, DraftValue>))}
              >
                이 단계 예시 채우기
              </button>
            ) : null}
          </div>

          <h2 className="q-big">{q.label}</h2>
          {q.help ? <p className="q-help">{q.help}</p> : null}

          <form id="wizard-form" onSubmit={onSubmit}>
            <div className="field">
              {q.type === "caseList" ? (
                <>
                  <WizardCaseList
                    pairs={Array.isArray(draft[q.id]) ? (draft[q.id] as CasePair[]) : []}
                    minPairs={q.min ?? CASE_MIN_DEFAULT}
                    maxPairs={q.max ?? CASE_MAX_DEFAULT}
                    onChange={onChange}
                  />
                  {entry.caseAssist ? (
                    <div className="assist">
                      <div className="assist-line">
                        <span>자료에서 초안을 뽑아 드립니다</span>
                        <button
                          type="button"
                          className="primary assist-go"
                          disabled={busy}
                          onClick={onDraftCases}
                        >
                          {assistBusy ? "초안 만드는 중…" : `AI 초안 ${assistEffective}개 넣기`}
                        </button>
                      </div>
                      <details className="assist-more">
                        <summary>초안 설정</summary>
                        <div style={{ display: "grid", gap: 6, fontSize: 14 }}>
                          {(["mock", "gemini", "vertex", "openai"] as const).map((choice) => (
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
                              {PROVIDER_OPTION_LABEL[choice]}
                            </label>
                          ))}
                        </div>
                        {assistChoice !== "mock" ? (
                          <div style={{ marginTop: 8 }}>
                            <ProviderCredentialInput
                              provider={assistChoice}
                              value={credentialDrafts[assistChoice]}
                              storedCredential={
                                assistChoice === "vertex" ? storedVertexCredential : null
                              }
                              idPrefix="assist"
                              disabled={busy}
                              onChange={(value) => {
                                setCredentialDrafts((current) => ({
                                  ...current,
                                  [assistChoice]: value,
                                }));
                                setError(null);
                              }}
                              onDelete={() => deleteCredential(assistChoice)}
                              onError={setError}
                            />
                          </div>
                        ) : null}
                        <div
                          style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10 }}
                        >
                          <label htmlFor="assist-count" style={{ margin: 0, fontSize: 13 }}>
                            한 번에 만들 초안
                          </label>
                          <input
                            id="assist-count"
                            type="range"
                            min={1}
                            max={assistSliderMax}
                            step={1}
                            value={assistEffective}
                            disabled={assistSliderMax <= 1}
                            style={{ width: 140, padding: 0 }}
                            onChange={(e) => setAssistCount(Number(e.target.value))}
                          />
                          <span className="badge muted">{assistEffective}개</span>
                        </div>
                        {entry.caseAssist.difficulty ? (
                          <>
                            <div
                              style={{
                                marginTop: 8,
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                              }}
                            >
                              <label htmlFor="assist-difficulty" style={{ margin: 0, fontSize: 13 }}>
                                {entry.caseAssist.difficulty.label}
                              </label>
                              <input
                                id="assist-difficulty"
                                type="range"
                                min={entry.caseAssist.difficulty.min}
                                max={entry.caseAssist.difficulty.max}
                                step={1}
                                value={assistDifficulty}
                                style={{ width: 140, padding: 0 }}
                                onChange={(e) => setAssistDifficulty(Number(e.target.value))}
                              />
                              <span className="badge muted">
                                {entry.caseAssist.difficulty.describe(assistDifficulty)}
                              </span>
                            </div>
                            <div className="hint" style={{ marginTop: 4 }}>
                              {entry.caseAssist.difficulty.hint}
                            </div>
                          </>
                        ) : null}
                      </details>
                      <div className="hint">
                        {entry.caseAssist.nudge} 이 호출은 클릭당 1회이며 실행 비용 예산과
                        별개입니다. 초안은 각 쌍의 확인 버튼을 눌러야만 제출에 포함됩니다.
                      </div>
                    </div>
                  ) : null}
                </>
              ) : q.type === "textarea" ? (
                <>
                  {/* 문서를 쓰는 면처럼 보이게 한다 — 빈 칸 하나보다 손이 덜 무겁다 */}
                  <div className="paper">
                    <div className="paper-top">
                      {q.shortLabel ?? q.label}
                      <span className="right">
                        <span>
                          {(typeof draft[q.id] === "string"
                            ? (draft[q.id] as string)
                            : ""
                          ).length.toLocaleString()}
                          자
                        </span>
                        {q.maxChars !== undefined ? (
                          <CharRing
                            filled={
                              (typeof draft[q.id] === "string" ? (draft[q.id] as string) : "").length
                            }
                            max={q.maxChars}
                          />
                        ) : null}
                      </span>
                    </div>
                    <textarea
                      id={`q-${q.id}`}
                      rows={10}
                      value={typeof draft[q.id] === "string" ? (draft[q.id] as string) : ""}
                      placeholder={q.placeholder}
                      autoFocus
                      onChange={(e) => onChange(e.target.value)}
                    />
                  </div>
                  {q.attachText ? (
                    <>
                      <label className="dropzone">
                        <input
                          type="file"
                          multiple
                          accept={FILE_ACCEPT}
                          disabled={busy}
                          onChange={onAttachFiles}
                        />
                        {attachBusy
                          ? "파일에서 글을 뽑는 중…"
                          : "눌러서 파일을 고르세요 · txt md pdf docx"}
                      </label>
                      {attached.length > 0 ? (
                        <div className="chips">
                          {attached.map((f) => (
                            <span key={f.name} className="chip">
                              <span aria-hidden="true">📄</span>
                              {f.name}
                              <span className="chip-size">{f.size}</span>
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <p className="hint">
                        파일 내용은 이 브라우저에서 추출되며 Harnest 서버에 업로드되지 않습니다.
                        AI 초안을 요청하면 선택한 모델 벤더에는 전송될 수 있습니다.
                      </p>
                    </>
                  ) : null}
                </>
              ) : q.type === "toggle" ? (
                <div className="models">
                  {(
                    [
                      { value: "true", name: "사용" },
                      { value: "false", name: "사용 안 함" },
                    ] as const
                  ).map((opt) => {
                    const current =
                      typeof draft[q.id] === "string" && draft[q.id] !== ""
                        ? (draft[q.id] as string)
                        : String(q.defaultValue ?? true);
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        className={`model${current === opt.value ? " is-on" : ""}`}
                        aria-pressed={current === opt.value}
                        onClick={() => onChange(opt.value)}
                      >
                        <b>{opt.name}</b>
                      </button>
                    );
                  })}
                </div>
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
            </div>

            {isLast && entry.needsModel ? (
              <div className="field judge-block">
                <label className="q-big" style={{ fontSize: "var(--t-h2)" }}>
                  무엇으로 채점할까요?
                </label>
                <p className="sub" style={{ marginBottom: 16 }}>
                  고른 모델은 판정 절차와 함께 잠깁니다. 바꾸려면 다시 승인해야 합니다.
                </p>
                <div className="models">
                  {PROVIDER_CHOICES.map((id) => {
                    const card = PROVIDER_CARD[id];
                    return (
                      <button
                        key={id}
                        type="button"
                        className={`model${judgeChoice === id ? " is-on" : ""}`}
                        aria-pressed={judgeChoice === id}
                        onClick={() => {
                          setJudgeChoice(id);
                          // 공급자를 바꾸면 이전 목록·선택은 의미가 없다
                          setModelList([]);
                          setJudgeModel("");
                          setModelNote(null);
                          setError(null);
                        }}
                      >
                        <b>{card.name}</b>
                        <div className="model-id">
                          {judgeChoice === id && judgeModel ? judgeModel : card.model}
                        </div>
                      </button>
                    );
                  })}
                </div>
                {judgeChoice !== "mock" ? (
                  <div style={{ marginTop: 8 }}>
                    <ProviderCredentialInput
                      provider={judgeChoice}
                      value={credentialDrafts[judgeChoice]}
                      storedCredential={
                        judgeChoice === "vertex" ? storedVertexCredential : null
                      }
                      sharedAvailable={sharedAvailable(judgeChoice)}
                      idPrefix="judge"
                      disabled={busy}
                      onChange={(value) => {
                        // 키 형식으로 회사를 알아낸다 — 카드를 먼저 고르지 않아도 된다
                        const found = detectByoCredential(value);
                        const target =
                          found.status === "detected" ? found.value.provider : judgeChoice;
                        if (target !== judgeChoice) {
                          setJudgeChoice(target);
                          setModelList([]);
                          setJudgeModel("");
                          setModelNote(null);
                        }
                        setCredentialDrafts((current) => ({ ...current, [target]: value }));
                        setError(null);
                      }}
                      onDelete={() => deleteCredential(judgeChoice)}
                      onError={setError}
                    />
                    <div className="hint">
                      {judgeChoice === "vertex" ? (
                        <>
                          private key는 localStorage에서 JWT 서명에만 쓰이고, 서명된 assertion은
                          Google OAuth로, 모델 요청은 Vertex AI로 직접 전송됩니다.
                        </>
                      ) : credentialDrafts[judgeChoice].trim() || !sharedAvailable(judgeChoice) ? (
                        <>
                          키는 이 브라우저(localStorage)에만 저장되고, 요청은{" "}
                          {judgeChoice === "openai" ? "OpenAI" : "Gemini"} API로 직접 전송됩니다.
                        </>
                      ) : (
                        <>
                          키를 비워 두면 관리자가 서버에 설정한 공유 키를 사용합니다. 이 경우
                          요청이 벤더로 직행하지 않고 Harnest 서버를 거칩니다(키 자체는 여전히
                          브라우저로 오지 않습니다).
                        </>
                      )}{" "}
                      승인 화면으로 이동하기 전에 선택한 모델로 1회 연결을 확인합니다.
                    </div>

                    <div className="model-pick">
                      <label htmlFor="judge-model">모델</label>
                      <ModelPicker
                        models={modelList}
                        value={judgeModel}
                        placeholder={JUDGE_MODEL[judgeChoice]}
                        busy={modelBusy}
                        disabled={busy}
                        onChange={(id) => {
                          setJudgeModel(id);
                          setError(null);
                        }}
                      />
                    </div>
                    <div className="hint">
                      {modelNote
                        ? modelNote
                        : modelList.length > 0
                          ? `${modelList.length}개 중에서 고르거나, 이름을 직접 적어도 됩니다.`
                          : "이름을 직접 적어도 됩니다."}
                    </div>
                  </div>
                ) : null}

                <div className="judge-escape">
                  <button
                    type="button"
                    className={judgeChoice === "mock" ? "primary" : ""}
                    disabled={busy}
                    onClick={() => {
                      setJudgeChoice("mock");
                      setModelList([]);
                      setJudgeModel("");
                      setModelNote(null);
                      setError(null);
                    }}
                  >
                    {judgeChoice === "mock" ? "모의 모델로 진행합니다" : "키 없이 모의 모델로 둘러보기"}
                  </button>
                  <span className="hint" style={{ marginTop: 0 }}>
                    외부 호출 없이 화면만 확인합니다. 실제 채점은 일어나지 않습니다.
                  </span>
                </div>
              </div>
            ) : null}

            {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}

            <div className="wizard-nav">
              {isLast ? (
                <button type="submit" className="primary wizard-go-wide" disabled={busy}>
                  {submitting
                    ? judgeChoice === "mock"
                      ? "확인 중…"
                      : "모델 연결 확인 중…"
                    : (q.nextLabel ?? "작성 완료 — 승인 화면으로")}
                </button>
              ) : null}
              {step > 0 ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setError(null);
                    setStep(step - 1);
                  }}
                >
                  이전 단계로
                </button>
              ) : null}
            </div>
          </form>
        </div>

        {isLast ? null : (
          <div className="wizard-side">
            <WizardBlueprint entry={entry} answers={liveAnswers} judge={judge} />
            <button
              type="submit"
              form="wizard-form"
              className="primary wizard-go"
              disabled={busy}
            >
              {q.nextLabel ?? "다음"}
            </button>
            {q.type === "caseList" && entry.caseAssist ? (
              <ActivityConsole
                model={assistChoice === "mock" ? "모의 모델" : JUDGE_MODEL[assistChoice]}
                empty="AI 초안을 요청하면 어떤 사실을 교차해 질문을 만들었는지 여기에 흐릅니다."
                height={420}
              />
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
