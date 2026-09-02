/** LLM 클라이언트 — 기본은 BYO 원칙: 자격 증명은 이 브라우저(localStorage)에만 머물고,
 *  요청은 벤더 API로 직행한다. 우리 서버로는 자격 증명도 본문도 가지 않는다 (SPEC §3 원칙 1).
 *  관리자가 서버에 공유 키를 설정했을 때만 예외로 /proxy/*를 거치는 보조 경로가
 *  있다 — createSharedOpenAIClient/createSharedGeminiClient, 아래쪽 참고. */

import type { CaseDef, JudgeProvider } from "@harnest/contracts";
import {
  DRAFT_CASES_MARKER,
  type HandoverProblem,
  type LlmClient,
} from "@harnest/template-handover";

/** 기존 UI가 이미 직접 렌더링하는 공급자. 새 자동 판별 UI가 합쳐질 때 제거할 호환 별칭이다. */
export type ByoProvider = Extract<JudgeProvider, "gemini" | "vertex" | "openai">;
/** 자격 증명 또는 로컬 endpoint로 직접 연결할 수 있는 전체 공급자. */
export type CredentialProvider = Exclude<JudgeProvider, "mock">;
export type SharedProvider = Extract<JudgeProvider, "gemini" | "openai">;

export const PROVIDER_LABEL: Record<JudgeProvider, string> = {
  gemini: "Gemini",
  vertex: "Vertex AI",
  openai: "OpenAI",
  anthropic: "Claude",
  openrouter: "OpenRouter",
  ollama: "Ollama",
  mock: "모의",
};

export function formatModelLabel(provider: JudgeProvider, model: string): string {
  return provider === "mock" ? "모의 모델" : `${PROVIDER_LABEL[provider]} · ${model}`;
}

/** 공급자별 기본 채점 모델 — 위저드와 빌더가 같은 값을 쓴다. */
export const DEFAULT_JUDGE_MODEL: Record<JudgeProvider, string> = {
  mock: "모의 모델",
  gemini: "gemini-3.8-flash",
  vertex: "gemini-3.8-flash",
  openai: "gpt-5.6-sol",
  anthropic: "claude-sonnet-4-5",
  openrouter: "openai/gpt-5.6-sol",
  ollama: "llama3.1",
};

const KEY_STORAGE: Record<CredentialProvider, string> = {
  gemini: "harnest.byo.gemini",
  vertex: "harnest.byo.vertex",
  openai: "harnest.byo.openai",
  anthropic: "harnest.byo.anthropic",
  openrouter: "harnest.byo.openrouter",
  ollama: "harnest.byo.ollama",
};
// 긴 문서 생성(분량 상한 최대 20,000자 → 출력 수만 토큰)은 수 분이 걸릴 수 있어 5분 여유를 둔다.
// 연결 테스트는 fail-fast 목적이라 별도의 짧은 상한(CONNECTION_TEST_TIMEOUT_MS)을 유지한다.
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_MS = 1_500;
const CONNECTION_TEST_TIMEOUT_MS = 15_000;

export interface LlmRequestOptions {
  requestTimeoutMs?: number;
  maxAttempts?: number;
  retryBaseMs?: number;
  /** Gemini 3 연결 확인처럼 추론량을 제한해야 하는 호출에서만 지정한다. */
  thinkingLevel?: "LOW" | "MEDIUM" | "HIGH";
}

export type GeminiClientOptions = LlmRequestOptions;
export type VertexClientOptions = LlmRequestOptions;
export type OpenAIClientOptions = LlmRequestOptions;
export type AnthropicClientOptions = LlmRequestOptions;
export type OpenRouterClientOptions = LlmRequestOptions;
export type OllamaClientOptions = LlmRequestOptions;

const CONNECTION_TEST_PROMPT = "연결 확인 요청입니다. OK라고만 응답하세요.";
const GOOGLE_OAUTH_TOKEN_URI = "https://oauth2.googleapis.com/token";
const GOOGLE_CLOUD_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const VERTEX_LOCATION = "global";

export function getByoCredential(provider: CredentialProvider): string | null {
  return localStorage.getItem(KEY_STORAGE[provider]);
}

export function setByoCredential(provider: CredentialProvider, credential: string | null): void {
  if (credential) localStorage.setItem(KEY_STORAGE[provider], credential);
  else localStorage.removeItem(KEY_STORAGE[provider]);
}

export interface VertexServiceAccountCredential {
  type: "service_account";
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  token_uri: typeof GOOGLE_OAUTH_TOKEN_URI;
}

function requiredString(value: Record<string, unknown>, field: string): string {
  const found = value[field];
  if (typeof found !== "string" || found.trim().length === 0) {
    throw new Error(`Vertex 서비스 계정 JSON의 ${field} 필드가 필요합니다.`);
  }
  return found.trim();
}

/** 외부 credential 설정의 임의 endpoint를 신뢰하지 않고 서비스 계정 JSON의 최소 필드만 보존한다. */
export function parseVertexServiceAccount(raw: string): VertexServiceAccountCredential {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Vertex 서비스 계정 JSON을 해석할 수 없습니다.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Vertex 서비스 계정 JSON은 객체여야 합니다.");
  }
  const value = parsed as Record<string, unknown>;
  if (value.type !== "service_account") {
    throw new Error("Vertex 자격 증명은 type이 service_account인 JSON이어야 합니다.");
  }
  const tokenUri = value.token_uri;
  if (tokenUri !== undefined && tokenUri !== GOOGLE_OAUTH_TOKEN_URI) {
    throw new Error("Vertex 서비스 계정 token_uri는 Google OAuth 공식 주소여야 합니다.");
  }
  const privateKey = requiredString(value, "private_key");
  if (!/^-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----$/.test(privateKey)) {
    throw new Error("Vertex 서비스 계정 private_key가 PKCS#8 PEM 형식이 아닙니다.");
  }
  return {
    type: "service_account",
    project_id: requiredString(value, "project_id"),
    private_key_id: requiredString(value, "private_key_id"),
    private_key: privateKey,
    client_email: requiredString(value, "client_email"),
    token_uri: GOOGLE_OAUTH_TOKEN_URI,
  };
}

export function normalizeVertexServiceAccount(raw: string): string {
  return JSON.stringify(parseVertexServiceAccount(raw));
}

export interface DetectedCredential {
  provider: CredentialProvider;
  /** Vertex는 최소 필드 JSON, Ollama는 정규화한 base URL, 나머지는 trim한 API 키다. */
  normalizedCredential: string;
}

export type CredentialDetection =
  | { status: "detected"; value: DetectedCredential }
  | { status: "unknown"; reason: string };

/** Ollama는 서버가 아니라 브라우저가 직접 접근한다. /api 경로는 클라이언트가 붙이므로 base URL만 보존한다. */
export function normalizeOllamaBaseUrl(raw: string): string {
  let candidate = raw.trim();
  if (/^ollama:\/\//i.test(candidate)) candidate = `http://${candidate.slice("ollama://".length)}`;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(candidate)) {
    candidate = `http://${candidate}`;
  }
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("Ollama 경로는 http://localhost:11434 같은 URL이어야 합니다.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Ollama 경로는 HTTP 또는 HTTPS URL이어야 합니다.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Ollama 경로에는 사용자 정보, 쿼리 또는 프래그먼트를 넣을 수 없습니다.");
  }
  const pathname = url.pathname.replace(/\/+$/, "").replace(/\/api$/i, "");
  url.pathname = pathname || "/";
  return url.toString().replace(/\/$/, "");
}

function looksLikeOllamaEndpoint(value: string): boolean {
  if (/^ollama:\/\//i.test(value)) return true;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(value)) return true;
  try {
    const url = new URL(value);
    return (
      url.port === "11434" ||
      url.hostname.toLowerCase().includes("ollama") ||
      /\/api\/?$/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

/**
 * 입력을 외부로 보내지 않고 형식만으로 공급자를 판별한다.
 * 접두사가 겹치거나 알려지지 않은 키는 여러 벤더에 시험 전송하지 않고 unknown으로 남긴다.
 */
export function detectByoCredential(raw: string): CredentialDetection {
  const value = raw.trim();
  if (!value) return { status: "unknown", reason: "자격 증명 또는 Ollama 경로가 비어 있습니다." };

  if (value.startsWith("{")) {
    try {
      return {
        status: "detected",
        value: { provider: "vertex", normalizedCredential: normalizeVertexServiceAccount(value) },
      };
    } catch (error) {
      return {
        status: "unknown",
        reason: error instanceof Error ? error.message : "Vertex 서비스 계정 JSON이 올바르지 않습니다.",
      };
    }
  }
  if (/^sk-or-v1-[A-Za-z0-9_-]{12,}$/.test(value)) {
    return { status: "detected", value: { provider: "openrouter", normalizedCredential: value } };
  }
  if (/^sk-ant-[A-Za-z0-9_-]{12,}$/.test(value)) {
    return { status: "detected", value: { provider: "anthropic", normalizedCredential: value } };
  }
  if (/^AIza[A-Za-z0-9_-]{20,}$/.test(value)) {
    return { status: "detected", value: { provider: "gemini", normalizedCredential: value } };
  }
  if (/^sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{12,}$/.test(value)) {
    return { status: "detected", value: { provider: "openai", normalizedCredential: value } };
  }
  if (looksLikeOllamaEndpoint(value)) {
    try {
      return {
        status: "detected",
        value: { provider: "ollama", normalizedCredential: normalizeOllamaBaseUrl(value) },
      };
    } catch (error) {
      return {
        status: "unknown",
        reason: error instanceof Error ? error.message : "Ollama 경로가 올바르지 않습니다.",
      };
    }
  }
  return {
    status: "unknown",
    reason: "지원하는 공급자의 고유한 키 형식 또는 Ollama 경로로 판별할 수 없습니다.",
  };
}

async function responseExcerpt(response: Response): Promise<string> {
  try {
    return (await response.text()).replace(/\s+/g, " ").trim().slice(0, 300);
  } catch {
    return "";
  }
}

// ── 실시간 스트리밍 ──────────────────────────────────────────────────────
// 모델이 글을 다 쓸 때까지 기다렸다가 한 덩어리로 받으면, 화면은 "다 끝난 뒤에
// 타자를 치는" 흉내밖에 낼 수 없다. 벤더들이 이미 토큰 단위로 흘려보내는 경로를
// 열어두고 있으므로 그것을 그대로 받는다 — 화면에 뜨는 속도가 곧 모델이 쓰는 속도다.
//
// BYO 원칙은 그대로다. 스트리밍도 브라우저에서 벤더로 직행하고, 우리 서버를 거치지 않는다.

/** 흘러오는 조각의 갈래.
 *  "thought"는 모델이 답을 내기 전에 스스로 정리하는 추론 요약,
 *  "output"은 최종 산출물, "notice"는 우리 쪽이 화면에 남기는 안내다.
 *  화면은 셋을 다르게 다룬다. */
export type StreamKind = "output" | "thought" | "notice";

const LINE_BREAK = String.fromCharCode(10);

/** 이 호출에 추론을 붙일지 — 새로 쓰는 호출에만 붙인다.
 *
 *  추론을 켠 호출에는 temperature를 함께 보낼 수 없다(벤더가 거부한다). 그래서 전
 *  호출에 붙이면 채점의 temperature 0까지 사라지고, 같은 산출물을 두 번 재도 점수가
 *  달라진다 — 곡선이 실행마다 달라지고 채택·기각이 운에 좌우된다.
 *
 *  새로 쓰는 호출(생성·변이)만 temperature를 올려 부르고 채점·검증은 0으로 부르므로,
 *  temperature가 0이 아닌 호출에만 추론을 붙이면 채점의 결정성이 지켜진다.
 *  덤으로 추론 토큰(출력 토큰으로 과금)이 실행 1회 40여 회 중 9회 안팎으로 줄어든다. */
function wantsThinking(opts: { temperature?: number } | undefined): boolean {
  return (opts?.temperature ?? 0.7) > 0;
}
export type StreamSink = (chunk: string, kind: StreamKind) => void;

export interface StreamingLlmClient extends LlmClient {
  completeStream(
    prompt: string,
    opts: { temperature?: number; maxOutputTokens?: number } | undefined,
    onChunk: StreamSink,
  ): Promise<string>;
}

export function isStreamingClient(llm: LlmClient): llm is StreamingLlmClient {
  return typeof (llm as Partial<StreamingLlmClient>).completeStream === "function";
}

interface StreamPlan {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  /** SSE는 "data:"로 시작하는 줄이, NDJSON은 줄 자체가 한 조각이다 */
  mode: "sse" | "ndjson";
  /** 조각 하나에서 새로 붙는 산출물 글자만 뽑는다. 붙는 글이 없으면 null */
  delta(payload: unknown): string | null;
  /** 같은 조각에서 추론 요약을 뽑는다. 이 벤더가 내주지 않으면 생략한다. */
  thought?(payload: unknown): string | null;
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/** 응답 본문을 줄 단위로 읽어 조각을 순서대로 넘긴다. */
async function readEventStream(
  res: Response,
  mode: "sse" | "ndjson",
  onPiece: (raw: string) => void,
): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("스트리밍 응답 본문을 읽을 수 없습니다.");
  const decoder = new TextDecoder();
  const emit = (line: string): void => {
    const trimmed = line.trim();
    if (trimmed === "") return;
    if (mode === "ndjson") {
      onPiece(trimmed);
      return;
    }
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (payload !== "" && payload !== "[DONE]") onPiece(payload);
  };

  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (;;) {
      const nl = buffer.indexOf("\n");
      if (nl < 0) break;
      emit(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  }
  emit(buffer);
}

/** 비스트리밍 클라이언트에 스트리밍 경로를 덧댄다.
 *
 *  스트리밍은 화면 효과다. 효과가 실패했다고 실행이 죽어서는 안 되므로,
 *  한 글자도 받지 못한 채 실패하면 조용히 기존 경로로 되돌아간다. */
function withStream(
  base: LlmClient,
  label: string,
  timeoutMs: number,
  /** relaxed = 추론 요약 요청을 뺀 판. 계정·모델이 요약을 내주지 않을 때 쓴다. */
  planFor: (
    prompt: string,
    opts: { temperature?: number; maxOutputTokens?: number } | undefined,
    relaxed: boolean,
  ) => StreamPlan | Promise<StreamPlan>,
): StreamingLlmClient {
  return {
    ...base,
    async completeStream(prompt, opts, onChunk) {
      let got = "";
      // 실제로 조각으로 흘러왔는지 재 둔다 — 한 번에 온 것과 구분이 안 되면
      // "왜 실시간이 아니냐"를 코드만 보고는 판정할 수 없다.
      const startedAt = Date.now();
      let outputPieces = 0;
      let thoughtPieces = 0;
      let firstPieceAt = 0;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const attempt = async (relaxed: boolean): Promise<void> => {
        const plan = await planFor(prompt, opts, relaxed);
        const res = await fetch(plan.url, {
          method: "POST",
          headers: { Accept: "text/event-stream", ...plan.headers },
          body: JSON.stringify(plan.body),
          signal: controller.signal,
        });
        if (!res.ok) {
          const excerpt = await responseExcerpt(res);
          const failure = new Error(`${label} HTTP ${res.status}${excerpt ? `: ${excerpt}` : ""}`);
          // 요약을 못 내주는 계정·모델이면 요약만 빼고 한 번 더 — 흐르는 화면까지
          // 통째로 잃지 않게 한다. 그래도 안 되면 바깥에서 기존 경로로 되돌아간다.
          if (!relaxed && res.status >= 400 && res.status < 500) {
            // 조용히 넘어가면 "생각이 왜 안 나오지"로만 보인다 — 이유를 남긴다
            onChunk(
              `${label}가 추론 요약을 내주지 않아 요약 없이 다시 요청합니다 (HTTP ${res.status}).`,
              "notice",
            );
            await attempt(true);
            return;
          }
          throw failure;
        }
        await readEventStream(res, plan.mode, (raw) => {
          let payload: unknown;
          try {
            payload = JSON.parse(raw);
          } catch {
            return;
          }
          if (firstPieceAt === 0) firstPieceAt = Date.now();
          const thinking = plan.thought?.(payload) ?? null;
          if (thinking !== null && thinking !== "") {
            thoughtPieces += 1;
            onChunk(thinking, "thought");
          }
          const piece = plan.delta(payload);
          if (piece !== null && piece !== "") {
            outputPieces += 1;
            got += piece;
            onChunk(piece, "output");
          }
        });
      };

      try {
        await attempt(false);
      } catch (error) {
        clearTimeout(timeout);
        if (got !== "") throw error;
        // 조용히 되돌아가면 "왜 실시간이 아니지"로만 보인다 — 이유를 남긴다
        onChunk(
          `${label} 스트리밍이 열리지 않아 한 번에 받아옵니다 — ${
            error instanceof Error ? error.message : String(error)
          }`,
          "notice",
        );
        const whole = await base.complete(prompt, opts);
        onChunk(whole, "output");
        return whole;
      }
      clearTimeout(timeout);
      if (import.meta.env.DEV) {
        const total = ((Date.now() - startedAt) / 1000).toFixed(1);
        const wait = ((firstPieceAt - startedAt) / 1000).toFixed(1);
        onChunk(
          `[측정] ${label} · 산출물 조각 ${outputPieces}개 · 생각 조각 ${thoughtPieces}개 · ` +
            `첫 조각까지 ${wait}초 · 전체 ${total}초`,
          "notice",
        );
      }
      if (got === "") {
        onChunk(`${label} 스트림이 비어 있어 한 번에 받아옵니다.`, "notice");
        const whole = await base.complete(prompt, opts);
        onChunk(whole, "output");
        return whole;
      }
      return got;
    },
  };
}

/** Gemini·Vertex 공통 — 조각마다 parts가 새로 온다.
 *  thought: true가 붙은 part가 모델이 스스로 정리한 추론 요약이다. */
function googlePart(payload: unknown, wantThought: boolean): string | null {
  const candidates = field(payload, "candidates");
  const first = Array.isArray(candidates) ? candidates[0] : undefined;
  const parts = field(field(first, "content"), "parts");
  if (!Array.isArray(parts)) return null;
  const text = parts
    .filter((p) => (field(p, "thought") === true) === wantThought)
    .map((p) => (typeof field(p, "text") === "string" ? String(field(p, "text")) : ""))
    .join("");
  return text === "" ? null : text;
}

const googleDelta = (payload: unknown): string | null => googlePart(payload, false);
const googleThought = (payload: unknown): string | null => googlePart(payload, true);

function wait(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: unknown; thought?: unknown }> };
    finishReason?: unknown;
  }>;
  promptFeedback?: { blockReason?: unknown };
  usageMetadata?: { thoughtsTokenCount?: unknown };
};

/** 텍스트 part가 여러 개인 응답을 합치고, 정상 HTTP 응답 안의 중단 사유를 보존한다. */
function geminiOutputText(data: GeminiResponse, label: string): string {
  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .filter((part) => part.thought !== true && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("");
  if (text.length > 0) return text;

  const finishReason =
    typeof candidate?.finishReason === "string" ? candidate.finishReason : null;
  const thoughtsTokenCount =
    typeof data.usageMetadata?.thoughtsTokenCount === "number"
      ? data.usageMetadata.thoughtsTokenCount
      : null;
  if (finishReason === "MAX_TOKENS") {
    throw new Error(
      `${label} 응답이 출력 토큰 한도에 도달해 텍스트를 만들지 못했습니다` +
        `${thoughtsTokenCount === null ? "" : ` (thinking ${thoughtsTokenCount} tokens)`}`,
    );
  }
  if (finishReason !== null) {
    throw new Error(`${label} 응답이 텍스트 없이 중단되었습니다 (${finishReason})`);
  }
  const blockReason = data.promptFeedback?.blockReason;
  if (typeof blockReason === "string") {
    throw new Error(`${label} 프롬프트가 차단되었습니다 (${blockReason})`);
  }
  throw new Error(`${label} 응답에 텍스트 없음`);
}

function geminiGenerationConfig(
  temperature: number,
  maxOutputTokens: number,
  thinkingLevel?: LlmRequestOptions["thinkingLevel"],
): Record<string, unknown> {
  return {
    temperature,
    maxOutputTokens,
    ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
  };
}

export function createGeminiClient(
  apiKey: string,
  model = "gemini-3.8-flash",
  options: GeminiClientOptions = {},
): LlmClient {
  const timeoutMs = Math.max(1, options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
  const retryBaseMs = Math.max(0, options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS);

  const base: LlmClient = {
    providerId: "gemini",
    model,
    async complete(prompt, opts) {
      const body = JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: geminiGenerationConfig(
          opts?.temperature ?? 0.7,
          opts?.maxOutputTokens ?? 8192,
          options.thinkingLevel,
        ),
      });
      let lastError: Error = new Error("LLM 호출 실패");
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        let res: Response;
        try {
          res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
              body,
              signal: controller.signal,
            },
          );
        } catch (e) {
          lastError = controller.signal.aborted
            ? new Error(`Gemini 요청 시간 초과 (${timeoutMs}ms)`)
            : new Error(`Gemini 네트워크 오류: ${e instanceof Error ? e.message : String(e)}`);
          clearTimeout(timeout);
          if (attempt + 1 >= maxAttempts) throw lastError;
          await wait(retryBaseMs * (attempt + 1));
          continue;
        }

        if (!res.ok) {
          const excerpt = await responseExcerpt(res);
          clearTimeout(timeout);
          lastError = new Error(`Gemini HTTP ${res.status}${excerpt ? `: ${excerpt}` : ""}`);
          const retryable = res.status === 429 || (res.status >= 500 && res.status <= 599);
          if (!retryable || attempt + 1 >= maxAttempts) throw lastError;
          await wait(retryBaseMs * (attempt + 1));
          continue;
        }

        let data: GeminiResponse;
        try {
          data = (await res.json()) as GeminiResponse;
        } catch {
          clearTimeout(timeout);
          if (controller.signal.aborted) {
            lastError = new Error(`Gemini 요청 시간 초과 (${timeoutMs}ms)`);
            if (attempt + 1 >= maxAttempts) throw lastError;
            await wait(retryBaseMs * (attempt + 1));
            continue;
          }
          throw new Error("Gemini 응답 JSON을 해석할 수 없습니다.");
        }
        clearTimeout(timeout);
        return geminiOutputText(data, "Gemini");
      }
      throw lastError;
    },
  };

  return withStream(base, "Gemini", timeoutMs, (prompt, opts) => ({
    url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        ...geminiGenerationConfig(
          opts?.temperature ?? 0.7,
          opts?.maxOutputTokens ?? 8192,
          options.thinkingLevel,
        ),
        thinkingConfig: {
          ...(options.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
          includeThoughts: true,
        },
      },
    },
    mode: "sse",
    delta: googleDelta,
    thought: googleThought,
  }));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function pemBytes(pem: string): ArrayBuffer {
  const encoded = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  try {
    return Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)).buffer as ArrayBuffer;
  } catch {
    throw new Error("Vertex 서비스 계정 private_key의 base64를 해석할 수 없습니다.");
  }
}

async function serviceAccountAssertion(
  credential: VertexServiceAccountCredential,
): Promise<string> {
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "pkcs8",
      pemBytes(credential.private_key),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Vertex 서비스 계정")) throw error;
    throw new Error("Vertex 서비스 계정 private_key로 JWT 서명 키를 만들 수 없습니다.");
  }
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64UrlJson({ alg: "RS256", typ: "JWT", kid: credential.private_key_id })}.${base64UrlJson({
    iss: credential.client_email,
    scope: GOOGLE_CLOUD_SCOPE,
    aud: GOOGLE_OAUTH_TOKEN_URI,
    iat: now,
    exp: now + 3600,
  })}`;
  let signature: ArrayBuffer;
  try {
    signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key,
      new TextEncoder().encode(unsigned),
    );
  } catch {
    throw new Error("Vertex 서비스 계정 JWT 서명에 실패했습니다.");
  }
  return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
}

type VertexTokenResponse = {
  access_token?: unknown;
  expires_in?: unknown;
};

/** Vertex AI 브라우저 직행 어댑터. 서비스 계정 private key는 서명에만 사용하고,
 *  Google OAuth에는 서명된 assertion, Vertex에는 단기 access token만 전송한다. */
export function createVertexClient(
  rawCredential: string | VertexServiceAccountCredential,
  model = "gemini-3.8-flash",
  options: VertexClientOptions = {},
): LlmClient {
  const credential =
    typeof rawCredential === "string"
      ? parseVertexServiceAccount(rawCredential)
      : parseVertexServiceAccount(JSON.stringify(rawCredential));
  const timeoutMs = Math.max(1, options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
  const retryBaseMs = Math.max(0, options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS);
  let accessToken: { value: string; expiresAt: number } | null = null;

  const issueAccessToken = async (signal: AbortSignal): Promise<string> => {
    if (accessToken !== null && accessToken.expiresAt - Date.now() > 60_000) {
      return accessToken.value;
    }
    const assertion = await serviceAccountAssertion(credential);
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    });
    const response = await fetch(GOOGLE_OAUTH_TOKEN_URI, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal,
    });
    if (!response.ok) {
      const excerpt = await responseExcerpt(response);
      throw new Error(`Vertex OAuth HTTP ${response.status}${excerpt ? `: ${excerpt}` : ""}`);
    }
    let data: VertexTokenResponse;
    try {
      data = (await response.json()) as VertexTokenResponse;
    } catch {
      throw new Error("Vertex OAuth 토큰 응답 JSON을 해석할 수 없습니다.");
    }
    if (typeof data.access_token !== "string" || data.access_token.length === 0) {
      throw new Error("Vertex OAuth 응답에 access_token이 없습니다.");
    }
    const expiresIn =
      typeof data.expires_in === "number" && Number.isFinite(data.expires_in)
        ? Math.max(1, data.expires_in)
        : 3600;
    accessToken = { value: data.access_token, expiresAt: Date.now() + expiresIn * 1000 };
    return accessToken.value;
  };

  const base: LlmClient = {
    providerId: "vertex",
    model,
    async complete(prompt, opts) {
      const body = JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: geminiGenerationConfig(
          opts?.temperature ?? 0.7,
          opts?.maxOutputTokens ?? 8192,
          options.thinkingLevel,
        ),
      });
      const project = encodeURIComponent(credential.project_id);
      const modelId = encodeURIComponent(model);
      const url = `https://aiplatform.googleapis.com/v1/projects/${project}/locations/${VERTEX_LOCATION}/publishers/google/models/${modelId}:generateContent`;
      let lastError: Error = new Error("LLM 호출 실패");

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        let res: Response;
        try {
          const token = await issueAccessToken(controller.signal);
          res = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body,
            signal: controller.signal,
          });
        } catch (error) {
          clearTimeout(timeout);
          lastError = controller.signal.aborted
            ? new Error(`Vertex AI 요청 시간 초과 (${timeoutMs}ms)`)
            : error instanceof Error && error.message.startsWith("Vertex")
              ? error
              : new Error(
                  `Vertex AI 네트워크 오류: ${error instanceof Error ? error.message : String(error)}`,
                );
          const status = Number(lastError.message.match(/HTTP (\d{3})/)?.[1] ?? 0);
          const retryable = status === 0 || status === 429 || status >= 500;
          if (!retryable || attempt + 1 >= maxAttempts) throw lastError;
          await wait(retryBaseMs * (attempt + 1));
          continue;
        }

        if (!res.ok) {
          const excerpt = await responseExcerpt(res);
          clearTimeout(timeout);
          lastError = new Error(`Vertex AI HTTP ${res.status}${excerpt ? `: ${excerpt}` : ""}`);
          if (res.status === 401) accessToken = null;
          const retryable = res.status === 401 || res.status === 429 || res.status >= 500;
          if (!retryable || attempt + 1 >= maxAttempts) throw lastError;
          await wait(retryBaseMs * (attempt + 1));
          continue;
        }

        let data: GeminiResponse;
        try {
          data = (await res.json()) as GeminiResponse;
        } catch {
          clearTimeout(timeout);
          if (controller.signal.aborted) {
            lastError = new Error(`Vertex AI 요청 시간 초과 (${timeoutMs}ms)`);
            if (attempt + 1 >= maxAttempts) throw lastError;
            await wait(retryBaseMs * (attempt + 1));
            continue;
          }
          throw new Error("Vertex AI 응답 JSON을 해석할 수 없습니다.");
        }
        clearTimeout(timeout);
        return geminiOutputText(data, "Vertex AI");
      }
      throw lastError;
    },
  };

  return withStream(base, "Vertex AI", timeoutMs, async (prompt, opts) => {
    const project = encodeURIComponent(credential.project_id);
    const modelId = encodeURIComponent(model);
    const token = await issueAccessToken(new AbortController().signal);
    return {
      url: `https://aiplatform.googleapis.com/v1/projects/${project}/locations/${VERTEX_LOCATION}/publishers/google/models/${modelId}:streamGenerateContent?alt=sse`,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          ...geminiGenerationConfig(
            opts?.temperature ?? 0.7,
            opts?.maxOutputTokens ?? 8192,
            options.thinkingLevel,
          ),
          thinkingConfig: {
            ...(options.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
            includeThoughts: true,
          },
        },
      },
      mode: "sse" as const,
      delta: googleDelta,
      thought: googleThought,
    };
  });
}

type OpenAIResponse = {
  status?: string;
  error?: { code?: string | null; message?: string | null } | null;
  incomplete_details?: { reason?: string | null } | null;
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

function openAIOutputText(data: OpenAIResponse): string {
  return (data.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text" && typeof part.text === "string")
    .map((part) => part.text!)
    .join("");
}

/** OpenAI Responses API 브라우저 직행 어댑터 — 2026-08-24 Chrome CORS 실측 go.
 *  401 응답은 CORS 허용 Origin 없이 반환되어 브라우저가 상태·본문을 숨길 수 있으므로,
 *  fetch 실패는 인증·CORS·네트워크 가능성을 합쳐 안내한다(SPEC §8). */
export function createOpenAIClient(
  apiKey: string,
  model = "gpt-5.6-sol",
  options: OpenAIClientOptions = {},
): LlmClient {
  const timeoutMs = Math.max(1, options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
  const retryBaseMs = Math.max(0, options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS);

  const base: LlmClient = {
    providerId: "openai",
    model,
    async complete(prompt, opts) {
      const body = JSON.stringify({
        model,
        input: prompt,
        reasoning: { effort: "none" },
        temperature: opts?.temperature ?? 0.7,
        max_output_tokens: opts?.maxOutputTokens ?? 8192,
        store: false,
      });
      let lastError: Error = new Error("LLM 호출 실패");
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        let res: Response;
        try {
          res = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body,
            signal: controller.signal,
          });
        } catch (e) {
          clearTimeout(timeout);
          lastError = controller.signal.aborted
            ? new Error(`OpenAI 요청 시간 초과 (${timeoutMs}ms)`)
            : new Error(
                `OpenAI 네트워크/CORS 또는 인증 오류: ${e instanceof Error ? e.message : String(e)}`,
              );
          if (attempt + 1 >= maxAttempts) throw lastError;
          await wait(retryBaseMs * (attempt + 1));
          continue;
        }

        if (!res.ok) {
          const excerpt = await responseExcerpt(res);
          clearTimeout(timeout);
          lastError = new Error(`OpenAI HTTP ${res.status}${excerpt ? `: ${excerpt}` : ""}`);
          const retryable = res.status === 429 || (res.status >= 500 && res.status <= 599);
          if (!retryable || attempt + 1 >= maxAttempts) throw lastError;
          await wait(retryBaseMs * (attempt + 1));
          continue;
        }

        let data: OpenAIResponse;
        try {
          data = (await res.json()) as OpenAIResponse;
        } catch {
          clearTimeout(timeout);
          if (controller.signal.aborted) {
            lastError = new Error(`OpenAI 요청 시간 초과 (${timeoutMs}ms)`);
            if (attempt + 1 >= maxAttempts) throw lastError;
            await wait(retryBaseMs * (attempt + 1));
            continue;
          }
          throw new Error("OpenAI 응답 JSON을 해석할 수 없습니다.");
        }
        clearTimeout(timeout);

        const text = openAIOutputText(data);
        if (text.length > 0) return text;
        if (data.error?.message) {
          throw new Error(`OpenAI 응답 실패: ${data.error.message}`);
        }
        if (data.status === "incomplete") {
          throw new Error(
            `OpenAI 응답이 완료되지 않았습니다${data.incomplete_details?.reason ? `: ${data.incomplete_details.reason}` : ""}`,
          );
        }
        throw new Error("OpenAI 응답에 텍스트 없음");
      }
      throw lastError;
    },
  };

  return withStream(base, "OpenAI", timeoutMs, (prompt, opts, relaxed) => ({
    url: "https://api.openai.com/v1/responses",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: {
      model,
      input: prompt,
      // 추론 요약을 받으려면 effort가 none이 아니어야 한다.
      // 화면에 흐르는 "생각"은 여기서 나온다 — 지어낸 문구가 아니라 모델의 것이다.
      //
      // summary는 이미 한 생각을 얼마나 풀어 쓸지만 정한다. detailed로 올려도
      // 추론 토큰은 늘지 않으므로, 화면에 흐르는 양만 늘리는 쪽을 택한다.
      ...(wantsThinking(opts) && !relaxed
        ? { reasoning: { effort: "low", summary: "detailed" } }
        : { reasoning: { effort: "none" }, temperature: opts?.temperature ?? 0.7 }),
      max_output_tokens: opts?.maxOutputTokens ?? 8192,
      store: false,
      stream: true,
    },
    mode: "sse",
    delta: (payload) =>
      field(payload, "type") === "response.output_text.delta" &&
      typeof field(payload, "delta") === "string"
        ? String(field(payload, "delta"))
        : null,
    thought: (payload) => {
      const kind = field(payload, "type");
      if (kind === "response.reasoning_summary_part.added") return LINE_BREAK + LINE_BREAK;
      return kind === "response.reasoning_summary_text.delta" &&
        typeof field(payload, "delta") === "string"
        ? String(field(payload, "delta"))
        : null;
    },
  }));
}

type DirectJsonRequest = {
  url: string;
  headers: Record<string, string>;
  body: unknown;
};

function createDirectJsonClient(
  providerId: CredentialProvider,
  label: string,
  model: string,
  options: LlmRequestOptions,
  requestFor: (
    prompt: string,
    completeOptions?: { temperature?: number; maxOutputTokens?: number },
  ) => DirectJsonRequest,
  outputText: (data: unknown) => string | null,
  /** 같은 요청을 흘려받는 경로 — 없으면 스트리밍을 지원하지 않는 클라이언트가 된다 */
  streamOf?: (request: DirectJsonRequest, relaxed: boolean) => Omit<StreamPlan, "url" | "headers">,
): LlmClient {
  const timeoutMs = Math.max(1, options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
  const retryBaseMs = Math.max(0, options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS);

  const base: LlmClient = {
    providerId,
    model,
    async complete(prompt, completeOptions) {
      const request = requestFor(prompt, completeOptions);
      let lastError: Error = new Error("LLM 호출 실패");
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        let response: Response;
        try {
          response = await fetch(request.url, {
            method: "POST",
            headers: request.headers,
            body: JSON.stringify(request.body),
            signal: controller.signal,
          });
        } catch (error) {
          clearTimeout(timeout);
          lastError = controller.signal.aborted
            ? new Error(`${label} 요청 시간 초과 (${timeoutMs}ms)`)
            : new Error(
                `${label} 네트워크/CORS 오류: ${error instanceof Error ? error.message : String(error)}`,
              );
          if (attempt + 1 >= maxAttempts) throw lastError;
          await wait(retryBaseMs * (attempt + 1));
          continue;
        }
        if (!response.ok) {
          const excerpt = await responseExcerpt(response);
          clearTimeout(timeout);
          lastError = new Error(`${label} HTTP ${response.status}${excerpt ? `: ${excerpt}` : ""}`);
          const retryable = response.status === 429 || response.status >= 500;
          if (!retryable || attempt + 1 >= maxAttempts) throw lastError;
          await wait(retryBaseMs * (attempt + 1));
          continue;
        }

        let data: unknown;
        try {
          data = await response.json();
        } catch {
          clearTimeout(timeout);
          if (controller.signal.aborted) {
            lastError = new Error(`${label} 요청 시간 초과 (${timeoutMs}ms)`);
            if (attempt + 1 >= maxAttempts) throw lastError;
            await wait(retryBaseMs * (attempt + 1));
            continue;
          }
          throw new Error(`${label} 응답 JSON을 해석할 수 없습니다.`);
        }
        clearTimeout(timeout);
        const text = outputText(data);
        if (typeof text === "string" && text.length > 0) return text;
        throw new Error(`${label} 응답에 텍스트가 없습니다.`);
      }
      throw lastError;
    },
  };

  if (!streamOf) return base;
  return withStream(base, label, timeoutMs, (prompt, completeOptions, relaxed) => {
    const request = requestFor(prompt, completeOptions);
    return { url: request.url, headers: request.headers, ...streamOf(request, relaxed) };
  });
}

/** Claude 스트리밍 조각 — 본문과 사고가 같은 이벤트 이름으로 오고 delta의 종류만 다르다 */
const ANTHROPIC_DELTAS = {
  mode: "sse" as const,
  delta: (payload: unknown) =>
    field(payload, "type") === "content_block_delta" &&
    typeof field(field(payload, "delta"), "text") === "string"
      ? String(field(field(payload, "delta"), "text"))
      : null,
  thought: (payload: unknown) =>
    field(payload, "type") === "content_block_delta" &&
    typeof field(field(payload, "delta"), "thinking") === "string"
      ? String(field(field(payload, "delta"), "thinking"))
      : null,
};

/** Claude Messages API 브라우저 직행 어댑터. 키는 Anthropic 이외의 호스트로 전송하지 않는다. */
export function createAnthropicClient(
  apiKey: string,
  model: string,
  options: AnthropicClientOptions = {},
): LlmClient {
  return createDirectJsonClient(
    "anthropic",
    "Claude",
    model,
    options,
    (prompt, completeOptions) => ({
      url: "https://api.anthropic.com/v1/messages",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: {
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: completeOptions?.temperature ?? 0.7,
        max_tokens: completeOptions?.maxOutputTokens ?? 8192,
      },
    }),
    (data) => {
      const content = (data as { content?: Array<{ type?: string; text?: string }> }).content ?? [];
      const text = content
        .filter((part) => part.type === "text" && typeof part.text === "string")
        .map((part) => part.text!)
        .join("");
      return text || null;
    },
    (request, relaxed) => {
      const body = request.body as Record<string, unknown>;
      const budget = 1024;
      const asked = typeof body.max_tokens === "number" ? body.max_tokens : 8192;
      const thinking =
        !relaxed && wantsThinking({ temperature: body.temperature as number | undefined });
      // 확장 사고를 켜면 temperature를 지정할 수 없고, max_tokens는 사고 예산보다 커야 한다
      const { temperature: _dropped, ...rest } = body;
      void _dropped;
      if (!thinking) return { body: { ...body, stream: true }, ...ANTHROPIC_DELTAS };
      return {
        body: {
          ...rest,
          max_tokens: Math.max(asked, budget + 2048),
          thinking: { type: "enabled", budget_tokens: budget },
          stream: true,
        },
        ...ANTHROPIC_DELTAS,
      };
    },
  );
}

/** OpenRouter의 OpenAI 호환 Chat Completions 경로. */
export function createOpenRouterClient(
  apiKey: string,
  model: string,
  options: OpenRouterClientOptions = {},
): LlmClient {
  return createDirectJsonClient(
    "openrouter",
    "OpenRouter",
    model,
    options,
    (prompt, completeOptions) => ({
      url: "https://openrouter.ai/api/v1/chat/completions",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: {
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: completeOptions?.temperature ?? 0.7,
        max_tokens: completeOptions?.maxOutputTokens ?? 8192,
      },
    }),
    (data) => {
      const content = (data as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]
        ?.message?.content;
      return typeof content === "string" ? content : null;
    },
    (request, relaxed) => ({
      body: {
        ...(request.body as Record<string, unknown>),
        ...(!relaxed &&
        wantsThinking({
          temperature: (request.body as Record<string, unknown>).temperature as number | undefined,
        })
          ? { reasoning: { effort: "low" } }
          : {}),
        stream: true,
      },
      mode: "sse",
      delta: (payload) => {
        const choices = field(payload, "choices");
        const first = Array.isArray(choices) ? choices[0] : undefined;
        const piece = field(field(first, "delta"), "content");
        return typeof piece === "string" && piece !== "" ? piece : null;
      },
      thought: (payload) => {
        const choices = field(payload, "choices");
        const first = Array.isArray(choices) ? choices[0] : undefined;
        const piece = field(field(first, "delta"), "reasoning");
        return typeof piece === "string" && piece !== "" ? piece : null;
      },
    }),
  );
}

/** 로컬 Ollama Chat API. endpoint는 사용자 브라우저에서 직접 호출되고 Harnest 서버를 거치지 않는다. */
export function createOllamaClient(
  endpoint: string,
  model: string,
  options: OllamaClientOptions = {},
): LlmClient {
  const baseUrl = normalizeOllamaBaseUrl(endpoint);
  return createDirectJsonClient(
    "ollama",
    "Ollama",
    model,
    options,
    (prompt, completeOptions) => ({
      url: `${baseUrl}/api/chat`,
      headers: { "Content-Type": "application/json" },
      body: {
        model,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        options: {
          temperature: completeOptions?.temperature ?? 0.7,
          num_predict: completeOptions?.maxOutputTokens ?? 8192,
        },
      },
    }),
    (data) => {
      const content = (data as { message?: { content?: unknown } }).message?.content;
      return typeof content === "string" ? content : null;
    },
    (request) => ({
      // 사고를 지원하지 않는 모델이면 요청이 거절되고, 그때는 기존 경로로 되돌아간다
      body: { ...(request.body as Record<string, unknown>), think: true, stream: true },
      mode: "ndjson",
      delta: (payload) => {
        const piece = field(field(payload, "message"), "content");
        return typeof piece === "string" && piece !== "" ? piece : null;
      },
      thought: (payload) => {
        const piece = field(field(payload, "message"), "thinking");
        return typeof piece === "string" && piece !== "" ? piece : null;
      },
    }),
  );
}

// ── 공유 키 판정(관리자가 서버에 둔 키) ──────────────────────────────────
// BYO가 기본 경로다. 관리자가 자기 키를 Lambda에 설정했을 때만, 사용자가 키를
// 안 넣어도 그 벤더를 쓸 수 있게 하는 보조 경로다. 이 경로는 요청이 벤더로
// 직행하지 않고 Harnest 서버(/proxy/*)를 거친다 — 키가 서버에만 있기 때문이다.

function resolveApiBase(apiBase?: string): string {
  if (apiBase) return apiBase;
  const configured = import.meta.env.VITE_API_BASE;
  if (typeof configured === "string" && configured.trim()) return configured.trim();
  return import.meta.env.PROD ? "https://api.harnest.p-e.kr" : "http://localhost:8000";
}

export async function fetchSharedProviders(
  apiBase?: string,
): Promise<Partial<Record<SharedProvider, boolean>>> {
  try {
    const res = await fetch(`${resolveApiBase(apiBase)}/config`);
    if (!res.ok) return {};
    const data = (await res.json()) as {
      sharedProviders?: Partial<Record<SharedProvider, boolean>>;
    };
    return data.sharedProviders ?? {};
  } catch {
    return {};
  }
}

let sharedProvidersCache: Partial<Record<SharedProvider, boolean>> = {};

/** 앱 시작 시, 그리고 위저드가 열릴 때 다시 불러 캐시를 채운다. createLlm()은
 *  동기 함수라 호출 시점에 이 캐시를 그대로 읽는다 — 최신 값을 보장하지는
 *  않지만, 위저드를 거쳐야 그 지점에 도달하므로 실질적으로는 늦지 않는다. */
export async function loadSharedProviders(
  apiBase?: string,
): Promise<Partial<Record<SharedProvider, boolean>>> {
  sharedProvidersCache = await fetchSharedProviders(apiBase);
  return sharedProvidersCache;
}

export function hasSharedKey(provider: SharedProvider): boolean {
  return sharedProvidersCache[provider] === true;
}

export interface SharedProxyOptions extends LlmRequestOptions {
  apiBase?: string;
}

export function createSharedOpenAIClient(
  model = "gpt-5.6-sol",
  options: SharedProxyOptions = {},
): LlmClient {
  const timeoutMs = Math.max(1, options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
  const retryBaseMs = Math.max(0, options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS);
  const base = resolveApiBase(options.apiBase);

  return {
    providerId: "openai",
    model,
    async complete(prompt, opts) {
      const body = JSON.stringify({
        model,
        input: prompt,
        reasoning: { effort: "none" },
        temperature: opts?.temperature ?? 0.7,
        max_output_tokens: opts?.maxOutputTokens ?? 8192,
        store: false,
      });
      let lastError: Error = new Error("LLM 호출 실패");
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        let res: Response;
        try {
          res = await fetch(`${base}/proxy/openai`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            signal: controller.signal,
          });
        } catch (e) {
          clearTimeout(timeout);
          lastError = controller.signal.aborted
            ? new Error(`OpenAI(공유) 요청 시간 초과 (${timeoutMs}ms)`)
            : new Error(
                `OpenAI(공유) 네트워크 오류: ${e instanceof Error ? e.message : String(e)}`,
              );
          if (attempt + 1 >= maxAttempts) throw lastError;
          await wait(retryBaseMs * (attempt + 1));
          continue;
        }

        if (!res.ok) {
          const excerpt = await responseExcerpt(res);
          clearTimeout(timeout);
          lastError = new Error(`OpenAI(공유) HTTP ${res.status}${excerpt ? `: ${excerpt}` : ""}`);
          const retryable = res.status === 429 || (res.status >= 500 && res.status <= 599);
          if (!retryable || attempt + 1 >= maxAttempts) throw lastError;
          await wait(retryBaseMs * (attempt + 1));
          continue;
        }

        let data: OpenAIResponse;
        try {
          data = (await res.json()) as OpenAIResponse;
        } catch {
          clearTimeout(timeout);
          if (controller.signal.aborted) {
            lastError = new Error(`OpenAI(공유) 요청 시간 초과 (${timeoutMs}ms)`);
            if (attempt + 1 >= maxAttempts) throw lastError;
            await wait(retryBaseMs * (attempt + 1));
            continue;
          }
          throw new Error("OpenAI(공유) 응답 JSON을 해석할 수 없습니다.");
        }
        clearTimeout(timeout);

        const text = openAIOutputText(data);
        if (text.length > 0) return text;
        if (data.error?.message) {
          throw new Error(`OpenAI(공유) 응답 실패: ${data.error.message}`);
        }
        if (data.status === "incomplete") {
          throw new Error(
            `OpenAI(공유) 응답이 완료되지 않았습니다${data.incomplete_details?.reason ? `: ${data.incomplete_details.reason}` : ""}`,
          );
        }
        throw new Error("OpenAI(공유) 응답에 텍스트 없음");
      }
      throw lastError;
    },
  };
}

export function createSharedGeminiClient(
  model = "gemini-3.8-flash",
  options: SharedProxyOptions = {},
): LlmClient {
  const timeoutMs = Math.max(1, options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
  const retryBaseMs = Math.max(0, options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS);
  const base = resolveApiBase(options.apiBase);

  return {
    providerId: "gemini",
    model,
    async complete(prompt, opts) {
      const body = JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: geminiGenerationConfig(
          opts?.temperature ?? 0.7,
          opts?.maxOutputTokens ?? 8192,
          options.thinkingLevel,
        ),
      });
      let lastError: Error = new Error("LLM 호출 실패");
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        let res: Response;
        try {
          res = await fetch(`${base}/proxy/gemini/${model}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            signal: controller.signal,
          });
        } catch (e) {
          clearTimeout(timeout);
          lastError = controller.signal.aborted
            ? new Error(`Gemini(공유) 요청 시간 초과 (${timeoutMs}ms)`)
            : new Error(
                `Gemini(공유) 네트워크 오류: ${e instanceof Error ? e.message : String(e)}`,
              );
          if (attempt + 1 >= maxAttempts) throw lastError;
          await wait(retryBaseMs * (attempt + 1));
          continue;
        }

        if (!res.ok) {
          const excerpt = await responseExcerpt(res);
          clearTimeout(timeout);
          lastError = new Error(`Gemini(공유) HTTP ${res.status}${excerpt ? `: ${excerpt}` : ""}`);
          const retryable = res.status === 429 || (res.status >= 500 && res.status <= 599);
          if (!retryable || attempt + 1 >= maxAttempts) throw lastError;
          await wait(retryBaseMs * (attempt + 1));
          continue;
        }

        let data: GeminiResponse;
        try {
          data = (await res.json()) as GeminiResponse;
        } catch {
          clearTimeout(timeout);
          if (controller.signal.aborted) {
            lastError = new Error(`Gemini(공유) 요청 시간 초과 (${timeoutMs}ms)`);
            if (attempt + 1 >= maxAttempts) throw lastError;
            await wait(retryBaseMs * (attempt + 1));
            continue;
          }
          throw new Error("Gemini(공유) 응답 JSON을 해석할 수 없습니다.");
        }
        clearTimeout(timeout);
        return geminiOutputText(data, "Gemini(공유)");
      }
      throw lastError;
    },
  };
}

export interface AvailableModel {
  id: string;
  label: string;
  source: "api" | "catalog";
  createdAt?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  ownedBy?: string;
}

export interface DetectedModelCatalog {
  provider: CredentialProvider;
  models: AvailableModel[];
}

const VERTEX_MODEL_CATALOG: AvailableModel[] = [
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", source: "catalog" },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", source: "catalog" },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", source: "catalog" },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview", source: "catalog" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", source: "catalog" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", source: "catalog" },
];

async function fetchModelJson(
  url: string,
  headers: Record<string, string>,
  label: string,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, { headers, signal: controller.signal });
  } catch (error) {
    clearTimeout(timeout);
    if (controller.signal.aborted) throw new Error(`${label} 모델 목록 요청 시간 초과 (${timeoutMs}ms)`);
    throw new Error(
      `${label} 모델 목록 네트워크/CORS 오류: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    const excerpt = await responseExcerpt(response);
    clearTimeout(timeout);
    throw new Error(`${label} 모델 목록 HTTP ${response.status}${excerpt ? `: ${excerpt}` : ""}`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} 모델 목록 응답 JSON을 해석할 수 없습니다.`);
  } finally {
    clearTimeout(timeout);
  }
}

function cleanModels(models: AvailableModel[]): AvailableModel[] {
  const unique = new Map<string, AvailableModel>();
  for (const model of models) {
    const id = model.id.trim();
    if (id) unique.set(id, { ...model, id, label: model.label.trim() || id });
  }
  return [...unique.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** 자격 증명으로 접근 가능한 모델(버전) 목록을 조회한다. Vertex는 공개 API 목록 대신 검증된 카탈로그를 반환한다. */
export async function listAvailableModels(
  provider: CredentialProvider,
  credential: string,
  options: Pick<LlmRequestOptions, "requestTimeoutMs"> = {},
): Promise<AvailableModel[]> {
  const timeoutMs = Math.max(1, options.requestTimeoutMs ?? CONNECTION_TEST_TIMEOUT_MS);
  if (provider === "vertex") {
    parseVertexServiceAccount(credential);
    return VERTEX_MODEL_CATALOG.map((model) => ({ ...model }));
  }
  if (provider === "openai") {
    const data = (await fetchModelJson(
      "https://api.openai.com/v1/models",
      { Authorization: `Bearer ${credential}` },
      "OpenAI",
      timeoutMs,
    )) as { data?: Array<{ id?: unknown; created?: unknown; owned_by?: unknown }> };
    return cleanModels(
      (data.data ?? [])
        .filter((model) => typeof model.id === "string")
        .map((model) => ({
          id: String(model.id),
          label: String(model.id),
          source: "api" as const,
          ...(typeof model.created === "number"
            ? { createdAt: new Date(model.created * 1000).toISOString() }
            : {}),
          ...(typeof model.owned_by === "string" ? { ownedBy: model.owned_by } : {}),
        })),
    );
  }
  if (provider === "gemini") {
    const data = (await fetchModelJson(
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
      { "x-goog-api-key": credential },
      "Gemini",
      timeoutMs,
    )) as {
      models?: Array<{
        name?: unknown;
        displayName?: unknown;
        inputTokenLimit?: unknown;
        outputTokenLimit?: unknown;
        supportedGenerationMethods?: unknown;
      }>;
    };
    return cleanModels(
      (data.models ?? [])
        .filter(
          (model) =>
            typeof model.name === "string" &&
            Array.isArray(model.supportedGenerationMethods) &&
            model.supportedGenerationMethods.includes("generateContent"),
        )
        .map((model) => ({
          id: String(model.name).replace(/^models\//, ""),
          label: typeof model.displayName === "string" ? model.displayName : String(model.name),
          source: "api" as const,
          ...(typeof model.inputTokenLimit === "number"
            ? { contextWindow: model.inputTokenLimit }
            : {}),
          ...(typeof model.outputTokenLimit === "number"
            ? { maxOutputTokens: model.outputTokenLimit }
            : {}),
        })),
    );
  }
  if (provider === "anthropic") {
    const data = (await fetchModelJson(
      "https://api.anthropic.com/v1/models?limit=1000",
      {
        "x-api-key": credential,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      "Claude",
      timeoutMs,
    )) as {
      data?: Array<{
        id?: unknown;
        display_name?: unknown;
        created_at?: unknown;
        max_input_tokens?: unknown;
        max_tokens?: unknown;
      }>;
    };
    return cleanModels(
      (data.data ?? [])
        .filter((model) => typeof model.id === "string")
        .map((model) => ({
          id: String(model.id),
          label: typeof model.display_name === "string" ? model.display_name : String(model.id),
          source: "api" as const,
          ...(typeof model.created_at === "string" ? { createdAt: model.created_at } : {}),
          ...(typeof model.max_input_tokens === "number"
            ? { contextWindow: model.max_input_tokens }
            : {}),
          ...(typeof model.max_tokens === "number" ? { maxOutputTokens: model.max_tokens } : {}),
        })),
    );
  }
  if (provider === "openrouter") {
    const data = (await fetchModelJson(
      "https://openrouter.ai/api/v1/models",
      { Authorization: `Bearer ${credential}` },
      "OpenRouter",
      timeoutMs,
    )) as { data?: Array<{ id?: unknown; name?: unknown; context_length?: unknown; created?: unknown }> };
    return cleanModels(
      (data.data ?? [])
        .filter((model) => typeof model.id === "string")
        .map((model) => ({
          id: String(model.id),
          label: typeof model.name === "string" ? model.name : String(model.id),
          source: "api" as const,
          ...(typeof model.context_length === "number" ? { contextWindow: model.context_length } : {}),
          ...(typeof model.created === "number"
            ? { createdAt: new Date(model.created * 1000).toISOString() }
            : {}),
        })),
    );
  }

  const baseUrl = normalizeOllamaBaseUrl(credential);
  const data = (await fetchModelJson(`${baseUrl}/api/tags`, {}, "Ollama", timeoutMs)) as {
    models?: Array<{
      name?: unknown;
      model?: unknown;
      modified_at?: unknown;
      details?: { parameter_size?: unknown; quantization_level?: unknown };
    }>;
  };
  return cleanModels(
    (data.models ?? [])
      .filter((model) => typeof model.model === "string" || typeof model.name === "string")
      .map((model) => {
        const id = typeof model.model === "string" ? model.model : String(model.name);
        const details = [model.details?.parameter_size, model.details?.quantization_level]
          .filter((value): value is string => typeof value === "string")
          .join(" · ");
        return {
          id,
          label: details ? `${id} (${details})` : id,
          source: "api" as const,
          ...(typeof model.modified_at === "string" ? { createdAt: model.modified_at } : {}),
        };
      }),
  );
}

/** 공급자 선택 없이 자격 증명/경로를 판별하고 해당 모델 목록을 조회한다. */
export async function detectAndListModels(
  rawCredential: string,
  options: Pick<LlmRequestOptions, "requestTimeoutMs"> = {},
): Promise<DetectedModelCatalog> {
  const detection = detectByoCredential(rawCredential);
  if (detection.status === "unknown") throw new Error(detection.reason);
  const { provider, normalizedCredential } = detection.value;
  return {
    provider,
    models: await listAvailableModels(provider, normalizedCredential, options),
  };
}

export function createByoClient(
  provider: CredentialProvider,
  credential: string,
  model: string,
  options: LlmRequestOptions = {},
): LlmClient {
  if (provider === "openai") return createOpenAIClient(credential, model, options);
  if (provider === "vertex") return createVertexClient(credential, model, options);
  if (provider === "anthropic") return createAnthropicClient(credential, model, options);
  if (provider === "openrouter") return createOpenRouterClient(credential, model, options);
  if (provider === "ollama") return createOllamaClient(credential, model, options);
  return createGeminiClient(credential, model, options);
}

/** 공급자 선택 없이 판별한 자격 증명으로 선택 모델 클라이언트를 만든다. */
export function createDetectedByoClient(
  rawCredential: string,
  model: string,
  options: LlmRequestOptions = {},
): LlmClient {
  const detection = detectByoCredential(rawCredential);
  if (detection.status === "unknown") throw new Error(detection.reason);
  return createByoClient(
    detection.value.provider,
    detection.value.normalizedCredential,
    model,
    options,
  );
}

function connectionTestError(provider: CredentialProvider, error: unknown): Error {
  const label = PROVIDER_LABEL[provider];
  const detail = error instanceof Error ? error.message : String(error);
  const statusMatch = detail.match(/HTTP (\d{3})/);
  const status = statusMatch ? Number(statusMatch[1]) : null;

  if (status === 401) {
    return new Error(
      provider === "vertex"
        ? `${label} 서비스 계정 인증 실패(HTTP 401). 자격 증명을 확인해 주세요.`
        : `${label} API 키 인증 실패(HTTP 401). 키를 확인해 주세요.`,
    );
  }
  if (status === 403) {
    return new Error(
      provider === "vertex"
        ? `${label} 접근 권한 없음(HTTP 403). Vertex AI API와 roles/aiplatform.user 권한을 확인해 주세요.`
        : `${label} 모델 접근 권한 없음(HTTP 403). 계정과 모델 권한을 확인해 주세요.`,
    );
  }
  if (status === 404) {
    return new Error(
      `${label} 모델을 찾을 수 없거나 접근할 수 없습니다(HTTP 404). 모델 ID와 권한을 확인해 주세요.`,
    );
  }
  if (status === 429) {
    return new Error(`${label} 요청 한도 초과(HTTP 429). 쿼터와 결제 상태를 확인해 주세요.`);
  }
  if (provider === "vertex" && detail.includes("OAuth HTTP 400")) {
    return new Error(
      `${label} 서비스 계정 토큰 발급 실패(HTTP 400). 키 상태와 시스템 시각을 확인해 주세요.`,
    );
  }
  if (status !== null && status >= 500) {
    return new Error(`${label} 서버 오류(HTTP ${status}). 잠시 후 다시 시도해 주세요.`);
  }
  if (detail.includes("시간 초과")) {
    return new Error(`${label} 연결 테스트 시간 초과(${CONNECTION_TEST_TIMEOUT_MS}ms).`);
  }
  if (detail.includes("네트워크") || detail.includes("Failed to fetch")) {
    // OpenAI 401은 브라우저 CORS 계층에서 상태와 본문이 가려질 수 있다.
    return new Error(
      `${label} 인증·CORS·네트워크 오류. 브라우저가 상태 코드를 공개하지 않아 원인을 구분할 수 없습니다.`,
    );
  }
  return new Error(`${label} 연결 테스트 실패: ${detail}`);
}

/** 승인 전 BYO fail-fast. 재시도 없이 정확히 한 번만 호출하며, 성공한 자격 증명만 저장 대상으로 삼는다.
 *  OpenAI 401의 상태가 CORS로 가려지는 경우에는 인증 실패로 단정하지 않는다(SPEC §8). */
export async function testByoConnection(
  provider: CredentialProvider,
  credential: string,
  model: string,
): Promise<void> {
  const isGemini3 = provider !== "openai" && /^gemini-3(?:[.-]|$)/.test(model);
  const options: LlmRequestOptions = {
    requestTimeoutMs: CONNECTION_TEST_TIMEOUT_MS,
    maxAttempts: 1,
    retryBaseMs: 0,
    ...(isGemini3 ? { thinkingLevel: "LOW" as const } : {}),
  };
  const client = createByoClient(provider, credential, model, options);

  try {
    await client.complete(CONNECTION_TEST_PROMPT, {
      temperature: isGemini3 ? 1 : 0,
      maxOutputTokens: isGemini3 ? 1024 : 16,
    });
  } catch (error) {
    throw connectionTestError(provider, error);
  }
}

/** 공급자 선택 없이 판별한 뒤, 사용자가 선택한 모델로 1콜 연결 테스트를 수행한다. */
export async function testDetectedByoConnection(
  rawCredential: string,
  model: string,
): Promise<CredentialProvider> {
  const detection = detectByoCredential(rawCredential);
  if (detection.status === "unknown") throw new Error(detection.reason);
  await testByoConnection(
    detection.value.provider,
    detection.value.normalizedCredential,
    model,
  );
  return detection.value.provider;
}

/** 케이스 초안 보조 전용 모의 클라이언트 — 케이스 입력 스텝에는 아직 compiled problem이
 *  없어 createMockClient를 쓸 수 없다. 초안 프롬프트의 마커와 "생성 개수: N"을 읽어
 *  결정적 질답쌍 N개를 돌려준다. 초안 요청이 아닌 프롬프트는 오분기 조기 발견을 위해 거부. */
/** 모의 모델에도 흐르는 느낌을 준다 — 결정적 결과는 그대로 두고 내보내는 방식만 조각낸다 */
function withFakeStream(base: LlmClient): StreamingLlmClient {
  return {
    ...base,
    async completeStream(prompt, opts, onChunk) {
      const whole = await base.complete(prompt, opts);
      for (let at = 0; at < whole.length; at += 6) {
        onChunk(whole.slice(at, at + 6), "output");
        await wait(16);
      }
      return whole;
    },
  };
}

export function createAssistMockClient(): LlmClient {
  return withFakeStream({
    providerId: "mock",
    model: "모의 모델 (결정적)",
    async complete(prompt) {
      if (!prompt.includes(DRAFT_CASES_MARKER)) {
        throw new Error("모의 초안 클라이언트에 초안 요청이 아닌 프롬프트가 들어왔습니다.");
      }
      const count = Math.max(1, Number(prompt.match(/생성 개수: (\d+)/)?.[1] ?? 1));
      const hops = Math.max(1, Number(prompt.match(/교차 사실 수: (\d+)/)?.[1] ?? 1));
      // 멀티홉 데모용 근거 인용 — 프롬프트의 참고 자료에서 실제 대목을 잘라 실존 대조를 통과시킨다
      const material = prompt.match(/## 참고 자료\n([\s\S]*?)\n(?:## |설명·코드 펜스)/)?.[1] ?? "";
      const snippetAt = (fraction: number): string => {
        const start = Math.max(0, Math.floor(material.length * fraction) - 15);
        return material.slice(start, start + 30).trim() || "모의 근거 인용";
      };
      const pairs = Array.from({ length: count }, (_, i) => ({
        question: `모의 초안 질문 ${i + 1}: 참고 자료의 핵심 절차 ${i + 1}은 무엇인가요?`,
        expectedAnswer: `모의 초안 답 ${i + 1}: 자료에 적힌 절차 ${i + 1}을 따르면 됩니다.`,
        ...(hops >= 2
          ? { evidence: Array.from({ length: hops }, (_, k) => snippetAt((k + 1) / (hops + 1))) }
          : {}),
      }));
      return JSON.stringify(pairs);
    },
  });
}

/** 공유 키 fail-fast — BYO와 같은 원칙(SPEC §8)을 공유 키 경로에도 적용한다.
 *  관리자 키가 만료·소진됐을 수 있으므로, 승인 화면으로 넘어가기 전에 한 번 확인한다. */
export async function testSharedConnection(
  provider: SharedProvider,
  model: string,
  apiBase?: string,
): Promise<void> {
  const isGemini3 = provider === "gemini" && /^gemini-3(?:[.-]|$)/.test(model);
  const options: SharedProxyOptions = {
    requestTimeoutMs: CONNECTION_TEST_TIMEOUT_MS,
    maxAttempts: 1,
    retryBaseMs: 0,
    apiBase,
    ...(isGemini3 ? { thinkingLevel: "LOW" as const } : {}),
  };
  const client =
    provider === "openai"
      ? createSharedOpenAIClient(model, options)
      : createSharedGeminiClient(model, options);

  try {
    await client.complete(CONNECTION_TEST_PROMPT, {
      temperature: isGemini3 ? 1 : 0,
      maxOutputTokens: isGemini3 ? 1024 : 16,
    });
  } catch (error) {
    throw connectionTestError(provider, error);
  }
}

/** 모의 모델 — 키 없이 파이프라인·데모를 돌리기 위한 결정적 대역.
 *  problem을 알지만 responder 경로는 "문서에 포함됐는가"만 본다 — 문서 밖 지식으로
 *  답하지 않게 해 case_answering 불변식을 시뮬레이션한다. 명시적으로 "모의"로 표기할 것. */
export function createMockClient(problem: HandoverProblem): LlmClient {
  const allCases: CaseDef[] = [
    ...problem.visibleCases,
    ...problem.guardCases,
    ...problem.holdoutCases,
  ];
  // 문자·숫자로만 된 단어 중 최장을 고른다 — 구두점 섞인 단어("deploy.sh를")를 정제해
  // 고르면 원문과 불일치해 항상 "문서에 없음"이 되는 버그가 있었다
  const keyToken = (text: string): string => {
    const pure = text
      .split(/\s+/)
      .filter((w) => w.length >= 4 && /^[\p{L}\p{N}]+$/u.test(w))
      .sort((a, b) => b.length - a.length);
    return pure[0] ?? text.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 6);
  };

  return withFakeStream({
    providerId: "mock",
    model: "모의 모델 (결정적)",
    async complete(prompt) {
      // 전략 선택: 프롬프트에 실제로 나열된 첫 허용 전략을 고른다. 반복 실패로 차단된 키는
      // 선택 가능한 목록에서 이미 빠져 있으므로 모의 실행도 같은 전환 계약을 따른다.
      if (prompt.includes("수정 전략 하나만 결정하세요")) {
        const key = prompt.match(/^- ([a-z0-9][a-z0-9_-]*):/m)?.[1] ?? "targeted_repair";
        return JSON.stringify({ key, summary: `모의 전략 ${key}로 공개 실패 항목을 보강합니다.` });
      }
      // responder 배치: 질문 목록의 케이스마다, 문서에 정답의 핵심 토큰이 있으면 그 답을
      if (prompt.includes("아래 문서만을 근거로")) {
        const doc = prompt.split("## 문서")[1]?.split("## 질문 목록")[0] ?? "";
        const listBlock = prompt.split("## 질문 목록")[1] ?? "";
        const ids = [...listBlock.matchAll(/### 질문 \(([^)]+)\)/g)].map((m) => m[1]);
        const answers = ids.map((id) => {
          const found = allCases.find((c) => c.id === id);
          const covered = found && doc.includes(keyToken(found.expectedAnswer));
          return { caseId: id, answer: covered ? found.expectedAnswer : "문서에 없음" };
        });
        return JSON.stringify(answers);
      }
      // grader 배치: 케이스마다 응답이 참조 답의 핵심 토큰을 담으면 1, "문서에 없음"이면 0
      if (prompt.includes("## 채점 목록")) {
        const grades = prompt.split("### 케이스 (").slice(1).map((chunk) => {
          const caseId = chunk.split(")")[0];
          const expected =
            chunk.split("\n참조 답 (기록된 실제 답): ")[1]?.split("\n채점할 응답: ")[0] ?? "";
          const response = (chunk.split("\n채점할 응답: ")[1] ?? "")
            .split("\n\n엄격하게")[0]
            .trim();
          const score = response.includes("문서에 없음")
            ? 0
            : response.includes(keyToken(expected))
              ? 1
              : 0.5;
          return { caseId, score, why: "모의 채점 — 핵심 토큰 대조" };
        });
        return JSON.stringify(grades);
      }
      // grader 단건(시험관 오염 응답 프로브): 응답이 핵심 토큰을 담으면 1, "문서에 없음"이면 0
      if (prompt.includes("JSON만 출력")) {
        const expected = prompt.split("## 참조 답")[1]?.split("## 채점할 응답")[0] ?? "";
        // 루브릭 문구("문서에 없음" 포함)가 응답 구간에 딸려 오지 않게 "엄격하게" 앞에서 자른다
        const response = (prompt.split("## 채점할 응답")[1] ?? "").split("엄격하게")[0];
        const score = response.includes("문서에 없음")
          ? 0
          : response.includes(keyToken(expected))
            ? 1
            : 0.5;
        return `{"score": ${score}, "why": "모의 채점 — 핵심 토큰 대조"}`;
      }
      // 변이: 실패 목록의 케이스 답을 문서에 추가(교환 예산: 상한의 80%로 자름)
      if (prompt.includes("## 실패 목록")) {
        const doc = (prompt.split("## 현재 문서")[1] ?? "").split("## 실패 목록")[0]
          .replace(/\(점수[^)]*\)/, "")
          .trim();
        const failed = new Set(
          [...(prompt.split("## 실패 목록")[1] ?? "").matchAll(/case-\d+/g)].map((m) => m[0]),
        );
        const additions = problem.visibleCases
          .filter((c) => failed.has(c.id))
          .map((c) => `\n\n${c.question}에 대해: ${c.expectedAnswer}`)
          .join("");
        return (doc + additions).slice(0, Math.floor(problem.lengthCap * 0.8));
      }
      // 원샷: 자료 + 가시 케이스 절반의 답만 담은 불완전한 문서(기준선이 중간에서 시작)
      const half = problem.visibleCases.slice(0, Math.ceil(problem.visibleCases.length / 2));
      const doc =
        `# 인수인계 문서 (모의 생성)\n\n${problem.material}\n\n` +
        half.map((c) => `${c.question}에 대해: ${c.expectedAnswer}`).join("\n\n");
      return doc.slice(0, Math.floor(problem.lengthCap * 0.8));
    },
  });
}
