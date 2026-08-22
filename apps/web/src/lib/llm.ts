/** LLM 클라이언트 — BYO 원칙: 키는 이 브라우저(localStorage)에만 머물고,
 *  요청은 벤더 API로 직행한다. 우리 서버로는 키도 본문도 가지 않는다 (SPEC §3 원칙 1). */

import type { CaseDef } from "@harnest/contracts";
import type { HandoverProblem, LlmClient } from "@harnest/template-handover";

const KEY_STORAGE = "harnest.byo.gemini";

export function getByoKey(): string | null {
  return localStorage.getItem(KEY_STORAGE);
}

export function setByoKey(key: string | null): void {
  if (key) localStorage.setItem(KEY_STORAGE, key);
  else localStorage.removeItem(KEY_STORAGE);
}

export function createGeminiClient(apiKey: string, model = "gemini-3.7-flash"): LlmClient {
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
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
            { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, body },
          );
          if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
          const data = (await res.json()) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          };
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (typeof text !== "string") throw new Error("Gemini 응답에 텍스트 없음");
          return text;
        } catch (e) {
          lastError = e;
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
      throw lastError instanceof Error ? lastError : new Error("LLM 호출 실패");
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
