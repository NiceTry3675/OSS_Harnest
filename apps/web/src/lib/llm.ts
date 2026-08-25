/** LLM 클라이언트 — 기본은 BYO 원칙: 키는 이 브라우저(localStorage)에만 머물고,
 *  요청은 벤더 API로 직행한다. 우리 서버로는 키도 본문도 가지 않는다 (SPEC §3 원칙 1).
 *  관리자가 서버에 공유 키를 설정했을 때만 예외로 /proxy/*를 거치는 보조 경로가
 *  있다 — createSharedOpenAIClient/createSharedGeminiClient, 아래쪽 참고. */

import type { CaseDef, JudgeProvider } from "@harnest/contracts";
import { DRAFT_CASES_MARKER, type HandoverProblem, type LlmClient } from "@harnest/template-handover";

export type ByoProvider = Exclude<JudgeProvider, "mock">;

export const PROVIDER_LABEL: Record<JudgeProvider, string> = {
  gemini: "Gemini",
  openai: "OpenAI",
  mock: "모의",
};

const KEY_STORAGE: Record<ByoProvider, string> = {
  gemini: "harnest.byo.gemini",
  openai: "harnest.byo.openai",
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
}

export type GeminiClientOptions = LlmRequestOptions;
export type OpenAIClientOptions = LlmRequestOptions;

const CONNECTION_TEST_PROMPT = "연결 확인 요청입니다. OK라고만 응답하세요.";

export function getByoKey(provider: ByoProvider): string | null {
  return localStorage.getItem(KEY_STORAGE[provider]);
}

export function setByoKey(provider: ByoProvider, key: string | null): void {
  if (key) localStorage.setItem(KEY_STORAGE[provider], key);
  else localStorage.removeItem(KEY_STORAGE[provider]);
}

async function responseExcerpt(response: Response): Promise<string> {
  try {
    return (await response.text()).replace(/\s+/g, " ").trim().slice(0, 300);
  } catch {
    return "";
  }
}

function wait(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

export function createGeminiClient(
  apiKey: string,
  model = "gemini-3.7-flash",
  options: GeminiClientOptions = {},
): LlmClient {
  const timeoutMs = Math.max(1, options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
  const retryBaseMs = Math.max(0, options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS);

  return {
    providerId: "gemini",
    model,
    async complete(prompt, opts) {
      const body = JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: opts?.temperature ?? 0.7,
          maxOutputTokens: opts?.maxOutputTokens ?? 8192,
        },
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

        let data: {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        try {
          data = (await res.json()) as typeof data;
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
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (typeof text !== "string") throw new Error("Gemini 응답에 텍스트 없음");
        return text;
      }
      throw lastError;
    },
  };
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
): Promise<Partial<Record<ByoProvider, boolean>>> {
  try {
    const res = await fetch(`${resolveApiBase(apiBase)}/config`);
    if (!res.ok) return {};
    const data = (await res.json()) as {
      sharedProviders?: Partial<Record<ByoProvider, boolean>>;
    };
    return data.sharedProviders ?? {};
  } catch {
    return {};
  }
}

let sharedProvidersCache: Partial<Record<ByoProvider, boolean>> = {};

/** 앱 시작 시, 그리고 위저드가 열릴 때 다시 불러 캐시를 채운다. createLlm()은
 *  동기 함수라 호출 시점에 이 캐시를 그대로 읽는다 — 최신 값을 보장하지는
 *  않지만, 위저드를 거쳐야 그 지점에 도달하므로 실질적으로는 늦지 않는다. */
export async function loadSharedProviders(
  apiBase?: string,
): Promise<Partial<Record<ByoProvider, boolean>>> {
  sharedProvidersCache = await fetchSharedProviders(apiBase);
  return sharedProvidersCache;
}

export function hasSharedKey(provider: ByoProvider): boolean {
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
  model = "gemini-3.7-flash",
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
        generationConfig: {
          temperature: opts?.temperature ?? 0.7,
          maxOutputTokens: opts?.maxOutputTokens ?? 8192,
        },
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

        let data: {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        try {
          data = (await res.json()) as typeof data;
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
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (typeof text !== "string") throw new Error("Gemini(공유) 응답에 텍스트 없음");
        return text;
      }
      throw lastError;
    },
  };
}

function connectionTestError(provider: ByoProvider, error: unknown): Error {
  const label = PROVIDER_LABEL[provider];
  const detail = error instanceof Error ? error.message : String(error);
  const statusMatch = detail.match(/HTTP (\d{3})/);
  const status = statusMatch ? Number(statusMatch[1]) : null;

  if (status === 401) {
    return new Error(`${label} API 키 인증 실패(HTTP 401). 키를 확인해 주세요.`);
  }
  if (status === 403) {
    return new Error(`${label} 모델 접근 권한 없음(HTTP 403). 계정과 모델 권한을 확인해 주세요.`);
  }
  if (status === 404) {
    return new Error(
      `${label} 모델을 찾을 수 없거나 접근할 수 없습니다(HTTP 404). 모델 ID와 권한을 확인해 주세요.`,
    );
  }
  if (status === 429) {
    return new Error(`${label} 요청 한도 초과(HTTP 429). 쿼터와 결제 상태를 확인해 주세요.`);
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

/** 승인 전 BYO fail-fast. 재시도 없이 정확히 한 번만 호출하며, 성공한 키만 저장 대상으로 삼는다.
 *  OpenAI 401의 상태가 CORS로 가려지는 경우에는 인증 실패로 단정하지 않는다(SPEC §8). */
export async function testByoConnection(
  provider: ByoProvider,
  apiKey: string,
  model: string,
): Promise<void> {
  const options: LlmRequestOptions = {
    requestTimeoutMs: CONNECTION_TEST_TIMEOUT_MS,
    maxAttempts: 1,
    retryBaseMs: 0,
  };
  const client =
    provider === "openai"
      ? createOpenAIClient(apiKey, model, options)
      : createGeminiClient(apiKey, model, options);

  try {
    await client.complete(CONNECTION_TEST_PROMPT, { temperature: 0, maxOutputTokens: 16 });
  } catch (error) {
    throw connectionTestError(provider, error);
  }
}

/** 케이스 초안 보조 전용 모의 클라이언트 — 케이스 입력 스텝에는 아직 compiled problem이
 *  없어 createMockClient를 쓸 수 없다. 초안 프롬프트의 마커와 "생성 개수: N"을 읽어
 *  결정적 질답쌍 N개를 돌려준다. 초안 요청이 아닌 프롬프트는 오분기 조기 발견을 위해 거부. */
export function createAssistMockClient(): LlmClient {
  return {
    providerId: "mock",
    model: "모의 모델 (결정적)",
    async complete(prompt) {
      if (!prompt.includes(DRAFT_CASES_MARKER)) {
        throw new Error("모의 초안 클라이언트에 초안 요청이 아닌 프롬프트가 들어왔습니다.");
      }
      const count = Math.max(1, Number(prompt.match(/생성 개수: (\d+)/)?.[1] ?? 1));
      const pairs = Array.from({ length: count }, (_, i) => ({
        question: `모의 초안 질문 ${i + 1}: 참고 자료의 핵심 절차 ${i + 1}은 무엇인가요?`,
        expectedAnswer: `모의 초안 답 ${i + 1}: 자료에 적힌 절차 ${i + 1}을 따르면 됩니다.`,
      }));
      return JSON.stringify(pairs);
    },
  };
}

/** 공유 키 fail-fast — BYO와 같은 원칙(SPEC §8)을 공유 키 경로에도 적용한다.
 *  관리자 키가 만료·소진됐을 수 있으므로, 승인 화면으로 넘어가기 전에 한 번 확인한다. */
export async function testSharedConnection(
  provider: ByoProvider,
  model: string,
  apiBase?: string,
): Promise<void> {
  const options: SharedProxyOptions = {
    requestTimeoutMs: CONNECTION_TEST_TIMEOUT_MS,
    maxAttempts: 1,
    retryBaseMs: 0,
    apiBase,
  };
  const client =
    provider === "openai"
      ? createSharedOpenAIClient(model, options)
      : createSharedGeminiClient(model, options);

  try {
    await client.complete(CONNECTION_TEST_PROMPT, { temperature: 0, maxOutputTokens: 16 });
  } catch (error) {
    throw connectionTestError(provider, error);
  }
}

/** 모의 모델 — 키 없이 파이프라인·데모를 돌리기 위한 결정적 대역.
 *  problem을 알지만 responder 경로는 "문서에 포함됐는가"만 본다 — 문서 밖 지식으로
 *  답하지 않게 해 case_answering 불변식을 시뮬레이션한다. 명시적으로 "모의"로 표기할 것. */
export function createMockClient(problem: HandoverProblem): LlmClient {
  const allCases: CaseDef[] = [...problem.visibleCases, ...problem.holdoutCases];
  // 문자·숫자로만 된 단어 중 최장을 고른다 — 구두점 섞인 단어("deploy.sh를")를 정제해
  // 고르면 원문과 불일치해 항상 "문서에 없음"이 되는 버그가 있었다
  const keyToken = (text: string): string => {
    const pure = text
      .split(/\s+/)
      .filter((w) => w.length >= 4 && /^[\p{L}\p{N}]+$/u.test(w))
      .sort((a, b) => b.length - a.length);
    return pure[0] ?? text.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 6);
  };

  return {
    providerId: "mock",
    model: "모의 모델 (결정적)",
    async complete(prompt) {
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
  };
}
