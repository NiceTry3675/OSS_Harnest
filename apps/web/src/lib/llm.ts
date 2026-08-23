/** LLM 클라이언트 — BYO 원칙: 키는 이 브라우저(localStorage)에만 머물고,
 *  요청은 벤더 API로 직행한다. 우리 서버로는 키도 본문도 가지 않는다 (SPEC §3 원칙 1). */

import type { CaseDef } from "@harnest/contracts";
import type { HandoverProblem, LlmClient } from "@harnest/template-handover";

const KEY_STORAGE = "harnest.byo.gemini";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_MS = 1_500;

export interface GeminiClientOptions {
  requestTimeoutMs?: number;
  maxAttempts?: number;
  retryBaseMs?: number;
}

export function getByoKey(): string | null {
  return localStorage.getItem(KEY_STORAGE);
}

export function setByoKey(key: string | null): void {
  if (key) localStorage.setItem(KEY_STORAGE, key);
  else localStorage.removeItem(KEY_STORAGE);
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
      // responder: 문서에 정답의 핵심 토큰이 있으면 그 답을, 없으면 "문서에 없음"
      if (prompt.includes("아래 문서만을 근거로")) {
        const doc = prompt.split("## 문서")[1]?.split("## 질문")[0] ?? "";
        const q = (prompt.split("## 질문")[1] ?? "").trim();
        const found = allCases.find(
          (c) => q.includes(c.question.slice(0, 12)) && doc.includes(keyToken(c.expectedAnswer)),
        );
        return found ? found.expectedAnswer : "문서에 없음";
      }
      // grader: 응답이 참조 답의 핵심 토큰을 담으면 1, "문서에 없음"이면 0
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
