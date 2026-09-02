/** 모의 모델 회귀 테스트 — 관통 시나리오: 원샷은 부분 커버, 변이가 실패 케이스를 흡수해 등반.
 *  승인 전 요건(검증 배터리 → 차단 해제)도 같은 모의 모델로 관통한다. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { approvalBlockers, type CaseDef } from "@harnest/contracts";
import {
  compile,
  createGenerator,
  createInitial,
  createScorer,
  createStrategyPlanner,
  draftCases,
  LENGTH_POLICY,
  runExaminerBattery,
  scoreHoldout,
} from "@harnest/template-handover";
import type { HandoverProblem } from "@harnest/template-handover";
import {
  createAssistMockClient,
  createAnthropicClient,
  createDetectedByoClient,
  createGeminiClient,
  createMockClient,
  createOllamaClient,
  createOpenAIClient,
  createOpenRouterClient,
  createVertexClient,
  detectAndListModels,
  detectByoCredential,
  formatModelLabel,
  getByoCredential,
  listAvailableModels,
  normalizeVertexServiceAccount,
  normalizeOllamaBaseUrl,
  parseVertexServiceAccount,
  setByoCredential,
  testByoConnection,
  testDetectedByoConnection,
} from "./llm";
import type { StreamingLlmClient } from "./llm";

describe("AI 모델 표시 이름", () => {
  it("모의 모델은 공급자와 모델 이름을 중복해 표시하지 않는다", () => {
    expect(formatModelLabel("mock", "모의 모델")).toBe("모의 모델");
    expect(formatModelLabel("openai", "gpt-example")).toBe("OpenAI · gpt-example");
  });
});

const c = (id: string, q: string, a: string): CaseDef => ({ id, question: q, expectedAnswer: a });

const problem: HandoverProblem = {
  material: "저는 사내 배포 파이프라인을 관리합니다.",
  visibleCases: [
    c("case-1", "배포는 어떻게 시작하나요?", "매주 화요일 오전에 스테이징에서 deploy.sh를 먼저 실행합니다."),
    c("case-2", "배포가 실패하면 어떻게 롤백하나요?", "rollback.sh에 직전 릴리스 태그를 넘기면 이전 버전으로 돌아갑니다."),
    c("case-3", "마이그레이션은 누가 승인하나요?", "데이터팀 리드의 승인을 받아야 하며 금요일에는 실행하지 않습니다."),
    c("case-4", "모니터링 알림은 어디로 오나요?", "그라파나 경보가 슬랙 채널로 오고 심각도가 높으면 전화까지 연결됩니다."),
  ],
  guardCases: [],
  holdoutCases: [
    c("case-5", "비밀 키는 어디에 보관하나요?", "모든 비밀 키는 볼트에 저장하며 저장소에 넣는 것은 금지입니다."),
  ],
  lengthCap: 2000,
  lengthPolicy: LENGTH_POLICY,
  // 간결성 끔 — 이 파일의 관통 시나리오는 순수 커버리지 등반을 검증한다
  useConciseness: false,
};

describe("BYO 키 저장", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("각 공급자 자격 증명을 서로 다른 localStorage 슬롯에 보관한다", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });

    setByoCredential("gemini", "gemini-key");
    setByoCredential("vertex", "vertex-credential");
    setByoCredential("openai", "openai-key");
    setByoCredential("anthropic", "anthropic-key");
    setByoCredential("openrouter", "openrouter-key");
    setByoCredential("ollama", "http://localhost:11434");
    expect(getByoCredential("gemini")).toBe("gemini-key");
    expect(getByoCredential("vertex")).toBe("vertex-credential");
    expect(getByoCredential("openai")).toBe("openai-key");
    expect(getByoCredential("anthropic")).toBe("anthropic-key");
    expect(getByoCredential("openrouter")).toBe("openrouter-key");
    expect(getByoCredential("ollama")).toBe("http://localhost:11434");

    setByoCredential("openai", null);
    expect(getByoCredential("openai")).toBeNull();
    expect(getByoCredential("gemini")).toBe("gemini-key");
    expect(getByoCredential("vertex")).toBe("vertex-credential");
  });
});

describe("모의 모델 관통", () => {
  it("원샷은 부분 커버(0 < 기준선 < 100), 변이가 실패 케이스를 흡수해 엄격 개선한다", async () => {
    const llm = createMockClient(problem);
    const scorer = createScorer(problem, llm);
    const initial = createInitial(problem, llm);
    const planStrategy = createStrategyPlanner(problem, llm);
    const generate = createGenerator(problem, llm);

    const doc0 = await initial(() => 0);
    const s0 = await scorer(doc0);
    expect(s0.gateRejected).toBe(false);
    expect(s0.total).toBeGreaterThan(0);
    expect(s0.total).toBeLessThan(100);

    const feedback = {
      round: 1,
      championScore: s0.total,
      championViolations: s0.violations,
      recentPublicExperiments: [],
      blockedStrategyKeys: [],
    };
    const strategy = await planStrategy(doc0, () => 0, feedback);
    const doc1 = await generate(doc0, () => 0, feedback, strategy);
    expect(strategy.key).toBe("targeted_repair");
    const s1 = await scorer(doc1);
    expect(s1.total).toBeGreaterThan(s0.total);
  });

  it("홀드아웃은 문서에 없는 내용이라 낮게 나온다 — Generator가 홀드아웃을 본 적 없음의 방증", async () => {
    const llm = createMockClient(problem);
    const doc0 = await createInitial(problem, llm)(() => 0);
    const h = await scoreHoldout(problem, doc0, llm);
    expect(h.score).toBe(0);
    expect(h.perCase).toHaveLength(1);
  });

  it("승인 전 요건 관통: 검증 배터리 → 승인 차단 해제", async () => {
    // 같은 케이스로 compile해 다이제스트가 결속된 팩을 얻는다 (5케이스 → 가시 4 / 홀드아웃 1)
    const { problem: p, pack } = await compile(
      {
        schemaVersion: "skeleton-1",
        templateId: "handover",
        answers: {
          material: problem.material,
          cases: [...problem.visibleCases, ...problem.holdoutCases].map(
            ({ question, expectedAnswer }) => ({ question, expectedAnswer }),
          ),
          lengthCap: problem.lengthCap,
        },
      },
      { judgeProvider: "mock", judgeModel: "모의 모델" },
    );
    const llm = createMockClient(p);

    // 리포트가 없으면 승인이 차단된다
    expect(approvalBlockers(pack, null)).toHaveLength(1);

    const report = await runExaminerBattery(p, pack, llm);
    expect(report.forDigest).toBe(pack.definitionDigest);
    // 종합 "주의"의 출처까지 고정: 꼼수 내성(모의 grader가 오염 응답에 부분 점수) —
    // 정직 표기가 그대로 판정에 남는다
    expect(report.checks.map((c) => `${c.id}:${c.verdict}`)).toEqual([
      "stability:pass",
      "hack_resistance:warn",
    ]);
    expect(report.overall).toBe("warn");

    // warn은 승인을 허용한다 — 표기가 따라갈 뿐 차단하지 않는다
    expect(approvalBlockers(pack, report)).toEqual([]);
  });
});

describe("케이스 초안 보조 모의 클라이언트", () => {
  it("draftCases 관통 — 요청한 개수의 결정적 질답쌍을 돌려준다", async () => {
    const llm = createAssistMockClient();
    const result = await draftCases(llm, problem.material.repeat(3), [], 2);
    expect(result).toHaveLength(2);
    for (const pair of result) {
      expect(pair.question.length).toBeGreaterThan(0);
      expect(pair.expectedAnswer.length).toBeGreaterThan(0);
    }
  });

  it("초안 요청이 아닌 프롬프트는 오분기 조기 발견을 위해 거부한다", async () => {
    const llm = createAssistMockClient();
    await expect(llm.complete("아래 문서만을 근거로 답하세요")).rejects.toThrow(
      "초안 요청이 아닌 프롬프트",
    );
  });
});

const errorResponse = (status: number, body: string): Response =>
  ({
    ok: false,
    status,
    text: async () => body,
  }) as Response;

const successResponse = (text: string): Response =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
  }) as Response;

const openAISuccessResponse = (...texts: string[]): Response =>
  ({
    ok: true,
    status: 200,
    json: async () => ({
      status: "completed",
      output: [
        { type: "reasoning", content: [] },
        {
          type: "message",
          content: texts.map((text) => ({ type: "output_text", text })),
        },
      ],
    }),
  }) as Response;

const jsonResponse = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body }) as Response;

describe("자격 증명 공급자 자동 판별", () => {
  it.each([
    [`sk-proj-${"a".repeat(24)}`, "openai"],
    [`sk-ant-api03-${"b".repeat(24)}`, "anthropic"],
    [`sk-or-v1-${"c".repeat(24)}`, "openrouter"],
    [`AIza${"d".repeat(32)}`, "gemini"],
    ["ollama://localhost:11434", "ollama"],
    ["http://127.0.0.1:11434/api", "ollama"],
  ])("%s 형식을 %s로 판별한다", (credential, provider) => {
    const result = detectByoCredential(credential);
    expect(result.status).toBe("detected");
    if (result.status === "detected") expect(result.value.provider).toBe(provider);
  });

  it("알 수 없는 키는 여러 공급자에 전송하지 않고 판별 불가로 남긴다", () => {
    const result = detectByoCredential("vendor-neutral-secret");
    expect(result.status).toBe("unknown");
    if (result.status === "unknown") expect(result.reason).toContain("판별할 수 없습니다");
  });

  it("Ollama endpoint를 base URL로 정규화하고 위험한 URL 구성요소를 거부한다", () => {
    expect(normalizeOllamaBaseUrl("localhost:11434/api/")).toBe("http://localhost:11434");
    expect(() => normalizeOllamaBaseUrl("ftp://localhost:11434")).toThrow("HTTP 또는 HTTPS");
    expect(() => normalizeOllamaBaseUrl("http://user:pass@localhost:11434")).toThrow(
      "사용자 정보",
    );
  });
});

describe("공급자별 모델 버전 목록", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("자동 판별한 Claude 키로 접근 가능한 모델과 메타데이터를 조회한다", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({
        data: [
          {
            id: "claude-sonnet-test",
            display_name: "Claude Sonnet Test",
            created_at: "2026-01-01T00:00:00Z",
            max_input_tokens: 200_000,
            max_tokens: 64_000,
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await detectAndListModels(`sk-ant-api03-${"x".repeat(24)}`);
    expect(result.provider).toBe("anthropic");
    expect(result.models).toEqual([
      expect.objectContaining({
        id: "claude-sonnet-test",
        label: "Claude Sonnet Test",
        contextWindow: 200_000,
        maxOutputTokens: 64_000,
      }),
    ]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.anthropic.com/v1/models?limit=1000");
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      "x-api-key": `sk-ant-api03-${"x".repeat(24)}`,
      "anthropic-version": "2023-06-01",
    });
  });

  it("Gemini 목록에서 generateContent 지원 모델만 반환하고 resource prefix를 제거한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          models: [
            {
              name: "models/gemini-text-test",
              displayName: "Gemini Text Test",
              supportedGenerationMethods: ["generateContent"],
              inputTokenLimit: 1000,
            },
            {
              name: "models/embedding-test",
              displayName: "Embedding",
              supportedGenerationMethods: ["embedContent"],
            },
          ],
        }),
      ),
    );
    await expect(listAvailableModels("gemini", `AIza${"g".repeat(32)}`)).resolves.toEqual([
      expect.objectContaining({ id: "gemini-text-test", contextWindow: 1000 }),
    ]);
  });

  it("OpenAI·OpenRouter·Ollama 응답을 공통 모델 항목으로 변환한다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "gpt-test", owned_by: "openai" }] }))
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ id: "anthropic/claude-test", name: "Claude Test", context_length: 99 }] }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          models: [
            {
              model: "qwen:test",
              modified_at: "2026-01-01T00:00:00Z",
              details: { parameter_size: "7B", quantization_level: "Q4" },
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(listAvailableModels("openai", `sk-${"o".repeat(24)}`)).resolves.toEqual([
      expect.objectContaining({ id: "gpt-test", ownedBy: "openai" }),
    ]);
    await expect(
      listAvailableModels("openrouter", `sk-or-v1-${"r".repeat(24)}`),
    ).resolves.toEqual([
      expect.objectContaining({ id: "anthropic/claude-test", contextWindow: 99 }),
    ]);
    await expect(listAvailableModels("ollama", "http://localhost:11434")).resolves.toEqual([
      expect.objectContaining({ id: "qwen:test", label: "qwen:test (7B · Q4)" }),
    ]);
    expect(fetchMock.mock.calls[2][0]).toBe("http://localhost:11434/api/tags");
  });
});

describe("Claude·OpenRouter·Ollama 호출 어댑터", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("각 공급자 요청 형식과 텍스트 응답을 처리한다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ content: [{ type: "text", text: "Claude 응답" }] }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "Router 응답" } }] }))
      .mockResolvedValueOnce(jsonResponse({ message: { role: "assistant", content: "Ollama 응답" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createAnthropicClient("ant-key", "claude-test").complete("요청")).resolves.toBe(
      "Claude 응답",
    );
    await expect(createOpenRouterClient("or-key", "vendor/model").complete("요청")).resolves.toBe(
      "Router 응답",
    );
    await expect(createOllamaClient("ollama://localhost:11434", "qwen:test").complete("요청"))
      .resolves.toBe("Ollama 응답");

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://api.anthropic.com/v1/messages",
      "https://openrouter.ai/api/v1/chat/completions",
      "http://localhost:11434/api/chat",
    ]);
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      "x-api-key": "ant-key",
      "anthropic-dangerous-direct-browser-access": "true",
    });
    expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({ Authorization: "Bearer or-key" });
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toMatchObject({
      model: "qwen:test",
      stream: false,
      options: { num_predict: 8192 },
    });
  });

  it("자동 판별 클라이언트와 연결 테스트가 판별된 provider를 보존한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ choices: [{ message: { content: "OK" } }] })),
    );
    const key = `sk-or-v1-${"z".repeat(24)}`;
    const client = createDetectedByoClient(key, "openai/test");
    expect(client.providerId).toBe("openrouter");
    await expect(testDetectedByoConnection(key, "openai/test")).resolves.toBe("openrouter");
  });
});

async function vertexCredential(): Promise<string> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 1024,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  let binary = "";
  for (const byte of pkcs8) binary += String.fromCharCode(byte);
  const encoded = btoa(binary).match(/.{1,64}/g)?.join("\n") ?? "";
  return JSON.stringify({
    type: "service_account",
    project_id: "vertex-project",
    private_key_id: "key-id",
    private_key: `-----BEGIN PRIVATE KEY-----\n${encoded}\n-----END PRIVATE KEY-----`,
    client_email: "harnest@vertex-project.iam.gserviceaccount.com",
    token_uri: "https://oauth2.googleapis.com/token",
    client_x509_cert_url: "https://example.invalid/ignored",
  });
}

function decodeJwtPart(encoded: string): Record<string, unknown> {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  const binary = atob(padded);
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))) as Record<string, unknown>;
}

const tokenResponse = (accessToken = "vertex-token", expiresIn = 3600): Response =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ access_token: accessToken, expires_in: expiresIn, token_type: "Bearer" }),
  }) as Response;

describe("Vertex 서비스 계정 어댑터", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("서비스 계정 JSON을 엄격히 검증하고 필요한 필드만 정규화한다", async () => {
    const raw = await vertexCredential();
    const parsed = parseVertexServiceAccount(raw);
    expect(parsed.project_id).toBe("vertex-project");
    expect(parsed.client_email).toBe("harnest@vertex-project.iam.gserviceaccount.com");
    expect(normalizeVertexServiceAccount(raw)).not.toContain("client_x509_cert_url");
    const detection = detectByoCredential(raw);
    expect(detection.status).toBe("detected");
    if (detection.status === "detected") expect(detection.value.provider).toBe("vertex");
    await expect(listAvailableModels("vertex", raw)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "gemini-3.8-flash", source: "catalog" })]),
    );

    expect(() => parseVertexServiceAccount("not-json")).toThrow("해석할 수 없습니다");
    expect(() => parseVertexServiceAccount(JSON.stringify({ type: "authorized_user" }))).toThrow(
      "service_account",
    );
    expect(() =>
      parseVertexServiceAccount(
        JSON.stringify({ ...JSON.parse(raw), token_uri: "https://evil.invalid/token" }),
      ),
    ).toThrow("Google OAuth 공식 주소");
    expect(() =>
      parseVertexServiceAccount(JSON.stringify({ ...JSON.parse(raw), project_id: "" })),
    ).toThrow("project_id");
  });

  it("RS256 JWT를 OAuth 토큰으로 교환하고 global Vertex 요청에 Bearer 토큰을 쓴다", async () => {
    const raw = await vertexCredential();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(successResponse("Vertex 응답"))
      .mockResolvedValueOnce(successResponse("캐시 응답"));
    vi.stubGlobal("fetch", fetchMock);
    const client = createVertexClient(raw, "gemini-3.8-flash", { retryBaseMs: 0 });

    await expect(
      client.complete("요청 본문", { temperature: 0, maxOutputTokens: 64 }),
    ).resolves.toBe("Vertex 응답");
    await expect(client.complete("두 번째 요청")).resolves.toBe("캐시 응답");

    expect(client.providerId).toBe("vertex");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [oauthUrl, oauthInit] = fetchMock.mock.calls[0];
    expect(oauthUrl).toBe("https://oauth2.googleapis.com/token");
    expect(oauthInit?.headers).toEqual({ "Content-Type": "application/x-www-form-urlencoded" });
    const oauthBody = oauthInit?.body as URLSearchParams;
    expect(oauthBody.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const assertion = oauthBody.get("assertion")!;
    const [header, payload, signature] = assertion.split(".");
    expect(decodeJwtPart(header)).toMatchObject({ alg: "RS256", typ: "JWT", kid: "key-id" });
    expect(decodeJwtPart(payload)).toMatchObject({
      iss: "harnest@vertex-project.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
    });
    expect(signature.length).toBeGreaterThan(0);

    const [vertexUrl, vertexInit] = fetchMock.mock.calls[1];
    expect(vertexUrl).toBe(
      "https://aiplatform.googleapis.com/v1/projects/vertex-project/locations/global/publishers/google/models/gemini-3.8-flash:generateContent",
    );
    expect(vertexInit?.headers).toEqual({
      Authorization: "Bearer vertex-token",
      "Content-Type": "application/json",
    });
    const vertexBody = JSON.parse(String(vertexInit?.body));
    expect(vertexBody).toMatchObject({
      contents: [{ role: "user", parts: [{ text: "요청 본문" }] }],
      // 추론 토큰이 출력 한도를 나눠 쓰므로 64는 바닥(4096)으로 올라간다
      generationConfig: { maxOutputTokens: 4096, thinkingConfig: { thinkingLevel: "MEDIUM" } },
    });
    expect(vertexBody.generationConfig.temperature).toBeUndefined();
  });

  it("여러 텍스트 part를 합치고 공개된 thinking part는 답변에서 제외한다", async () => {
    const raw = await vertexCredential();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  { text: "내부 생각", thought: true },
                  { thoughtSignature: "서명만 있는 part" },
                  { text: "최종" },
                  { text: " 응답" },
                ],
              },
              finishReason: "STOP",
            },
          ],
        }),
      } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const client = createVertexClient(raw, "gemini-3.8-flash", { retryBaseMs: 0 });
    await expect(client.complete("요청")).resolves.toBe("최종 응답");
  });

  it("thinking이 출력 한도를 소진하면 Vertex 종료 사유를 보존한다", async () => {
    const raw = await vertexCredential();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [] }, finishReason: "MAX_TOKENS" }],
          usageMetadata: { thoughtsTokenCount: 16 },
        }),
      } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const client = createVertexClient(raw, "gemini-3.8-flash", { retryBaseMs: 0 });
    await expect(client.complete("요청")).rejects.toThrow(
      "출력 토큰 한도에 도달해 텍스트를 만들지 못했습니다 (thinking 16 tokens)",
    );
  });

  it("만료 60초 전에는 access token을 갱신한다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T00:00:00Z"));
    const raw = await vertexCredential();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse("token-1", 120))
      .mockResolvedValueOnce(successResponse("첫 응답"))
      .mockResolvedValueOnce(tokenResponse("token-2", 120))
      .mockResolvedValueOnce(successResponse("둘째 응답"));
    vi.stubGlobal("fetch", fetchMock);
    const client = createVertexClient(raw, "gemini-test", { retryBaseMs: 0 });

    await client.complete("첫 요청");
    vi.setSystemTime(new Date("2026-08-25T00:01:01Z"));
    await client.complete("둘째 요청");

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[3][1]?.headers).toMatchObject({ Authorization: "Bearer token-2" });
  });

  it("OAuth와 Vertex 권한 오류를 연결 테스트에서 구분한다", async () => {
    const raw = await vertexCredential();
    const oauthFailure = vi.fn(async () => errorResponse(400, "invalid_grant"));
    vi.stubGlobal("fetch", oauthFailure);
    await expect(testByoConnection("vertex", raw, "gemini-test")).rejects.toThrow(
      "토큰 발급 실패(HTTP 400)",
    );
    expect(oauthFailure).toHaveBeenCalledTimes(1);

    const permissionFailure = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(errorResponse(403, "PERMISSION_DENIED"));
    vi.stubGlobal("fetch", permissionFailure);
    await expect(testByoConnection("vertex", raw, "gemini-test")).rejects.toThrow(
      "roles/aiplatform.user",
    );
  });
});

describe("Gemini 오류 분류", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("401은 응답 본문 앞 300자를 보여 주고 재시도 없이 즉시 실패한다", async () => {
    const body = "키가 잘못되었습니다." + "x".repeat(400);
    const fetchMock = vi.fn(async () => errorResponse(401, body));
    vi.stubGlobal("fetch", fetchMock);
    const client = createGeminiClient("bad-key", "gemini-test", { retryBaseMs: 0 });

    let caught: unknown;
    try {
      await client.complete("요청");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("Gemini HTTP 401");
    expect((caught as Error).message).toContain(body.slice(0, 300));
    expect((caught as Error).message).not.toContain(body.slice(0, 301));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([429, 503])("HTTP %s는 재시도해 다음 정상 응답을 반환한다", async (status) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(status, "잠시 후 다시 시도"))
      .mockResolvedValueOnce(successResponse("복구됨"));
    vi.stubGlobal("fetch", fetchMock);
    const client = createGeminiClient("key", "gemini-test", { retryBaseMs: 0 });

    await expect(client.complete("요청")).resolves.toBe("복구됨");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("네트워크 오류는 재시도하지만 응답 형식 오류는 즉시 실패한다", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(successResponse("네트워크 복구"));
    vi.stubGlobal("fetch", fetchMock);
    const client = createGeminiClient("key", "gemini-test", { retryBaseMs: 0 });
    await expect(client.complete("요청")).resolves.toBe("네트워크 복구");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const malformedFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [] }),
    }) as Response);
    vi.stubGlobal("fetch", malformedFetch);
    await expect(client.complete("요청")).rejects.toThrow("텍스트 없음");
    expect(malformedFetch).toHaveBeenCalledTimes(1);
  });

  it("요청 제한 시간을 넘기면 AbortController로 중단한다", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("중단됨", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createGeminiClient("key", "gemini-test", {
      requestTimeoutMs: 20,
      maxAttempts: 1,
      retryBaseMs: 0,
    });

    const assertion = expect(client.complete("요청")).rejects.toThrow("시간 초과 (20ms)");
    await vi.advanceTimersByTimeAsync(20);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("OpenAI Responses API 어댑터", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("실측한 브라우저 직행 요청 형식으로 호출하고 모든 output_text를 합친다", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        openAISuccessResponse("첫 문장", " + 둘째 문장"),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createOpenAIClient("openai-key", "gpt-5.6-sol", { retryBaseMs: 0 });

    await expect(
      client.complete("요청 본문", { temperature: 0, maxOutputTokens: 64 }),
    ).resolves.toBe("첫 문장 + 둘째 문장");

    expect(client.providerId).toBe("openai");
    expect(client.model).toBe("gpt-5.6-sol");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      Authorization: "Bearer openai-key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "gpt-5.6-sol",
      input: "요청 본문",
      reasoning: { effort: "medium" },
      max_output_tokens: 4096,
      store: false,
    });
  });

  it("401은 재시도하지 않고, 429는 재시도해 정상 응답을 반환한다", async () => {
    const unauthorized = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        errorResponse(401, "인증 실패"),
    );
    vi.stubGlobal("fetch", unauthorized);
    const client = createOpenAIClient("bad-key", "gpt-5.6-sol", { retryBaseMs: 0 });
    await expect(client.complete("요청")).rejects.toThrow("OpenAI HTTP 401: 인증 실패");
    expect(unauthorized).toHaveBeenCalledTimes(1);

    const throttled = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(429, "잠시 후 다시 시도"))
      .mockResolvedValueOnce(openAISuccessResponse("복구됨"));
    vi.stubGlobal("fetch", throttled);
    const retrying = createOpenAIClient("key", "gpt-5.6-sol", { retryBaseMs: 0 });
    await expect(retrying.complete("요청")).resolves.toBe("복구됨");
    expect(throttled).toHaveBeenCalledTimes(2);
  });

  it("브라우저가 숨긴 401을 포함한 fetch 실패는 인증·CORS·네트워크 합성 오류로 안내한다", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = createOpenAIClient("bad-key", "gpt-5.6-sol", {
      maxAttempts: 1,
      retryBaseMs: 0,
    });

    await expect(client.complete("요청")).rejects.toThrow(
      "OpenAI 네트워크/CORS 또는 인증 오류: Failed to fetch",
    );
  });

  it("응답 JSON과 텍스트 형식을 검증한다", async () => {
    const malformed = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => Promise.reject(new Error("bad json")),
        }) as unknown as Response,
    );
    vi.stubGlobal("fetch", malformed);
    const client = createOpenAIClient("key", "gpt-5.6-sol", { retryBaseMs: 0 });
    await expect(client.complete("요청")).rejects.toThrow("응답 JSON을 해석");

    const empty = vi.fn(
      async () =>
        ({ ok: true, status: 200, json: async () => ({ status: "completed", output: [] }) }) as Response,
    );
    vi.stubGlobal("fetch", empty);
    await expect(client.complete("요청")).rejects.toThrow("응답에 텍스트 없음");
  });
});

describe("승인 전 BYO 1콜 연결 테스트", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("선택한 OpenAI 모델을 재시도 없이 한 번 호출하고 성공한다", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => openAISuccessResponse("OK"),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(testByoConnection("openai", "key", "gpt-test")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "gpt-test",
      reasoning: { effort: "low" },
    });
  });

  it("Vertex 연결 테스트는 low 추론과 추론 여유가 있는 출력 한도를 쓴다", async () => {
    const raw = await vertexCredential();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(successResponse("OK"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      testByoConnection("vertex", raw, "gemini-3.8-flash"),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, vertexInit] = fetchMock.mock.calls[1];
    expect(JSON.parse(String(vertexInit?.body))).toMatchObject({
      generationConfig: {
        maxOutputTokens: 4096,
        thinkingConfig: { thinkingLevel: "LOW" },
      },
    });
  });

  it.each([
    [401, "API 키 인증 실패(HTTP 401)"],
    [403, "모델 접근 권한 없음(HTTP 403)"],
    [404, "모델을 찾을 수 없거나 접근할 수 없습니다(HTTP 404)"],
    [429, "요청 한도 초과(HTTP 429)"],
    [503, "서버 오류(HTTP 503)"],
  ])("읽을 수 있는 HTTP %s를 구분하고 재시도하지 않는다", async (status, expected) => {
    const fetchMock = vi.fn(async () => errorResponse(status, "오류 본문"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(testByoConnection("openai", "key", "gpt-test")).rejects.toThrow(expected);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("브라우저가 상태를 숨긴 fetch 실패는 401로 단정하지 않는다", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);

    let caught: unknown;
    try {
      await testByoConnection("openai", "bad-key", "gpt-test");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("인증·CORS·네트워크 오류");
    expect((caught as Error).message).not.toContain("401");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("15초를 넘긴 연결 테스트를 중단하고 시간 초과로 구분한다", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("중단됨", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const assertion = expect(testByoConnection("gemini", "key", "gemini-test")).rejects.toThrow(
      "Gemini 연결 테스트 시간 초과(15000ms)",
    );
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("추론 정책 — 모든 호출에 추론, 깊이는 effort", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const sseOnce = (line: string) =>
    vi.fn(async () =>
      new Response(`data: ${line}\n\ndata: [DONE]\n\n`, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
  const bodiesOf = (fetchMock: ReturnType<typeof vi.fn>) =>
    fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)));

  it("OpenAI: 채점(medium)과 생성(high) 모두 추론을 붙이고 temperature는 보내지 않는다", async () => {
    const fetchMock = sseOnce('{"type":"response.output_text.delta","delta":"x"}');
    vi.stubGlobal("fetch", fetchMock);

    const llm = createOpenAIClient("sk-test", "gpt-5.6-sol") as StreamingLlmClient;
    await llm.completeStream("채점", { temperature: 0, effort: "medium" }, () => {});
    await llm.completeStream("생성", { temperature: 0.7, effort: "high" }, () => {});

    const [grade, gen] = bodiesOf(fetchMock);
    expect(grade.temperature).toBeUndefined();
    expect(grade.reasoning).toEqual({ effort: "medium", summary: "detailed" });
    expect(gen.temperature).toBeUndefined();
    expect(gen.reasoning).toEqual({ effort: "high", summary: "detailed" });
  });

  it("Claude: adaptive thinking + output_config.effort, budget_tokens·temperature 없음", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ content: [{ type: "text", text: "ok" }] }))
      .mockResolvedValueOnce(
        new Response(
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\n',
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const llm = createAnthropicClient("sk-ant-test", "claude-opus-5") as StreamingLlmClient;
    await llm.complete("채점", { temperature: 0, effort: "medium", maxOutputTokens: 512 });
    await llm.completeStream("생성", { temperature: 0.7, effort: "high" }, () => {});

    const [json, stream] = bodiesOf(fetchMock);
    expect(json).toEqual({
      model: "claude-opus-5",
      messages: [{ role: "user", content: "채점" }],
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
    });
    expect(stream).toMatchObject({
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "high" },
      stream: true,
    });
    expect(stream.temperature).toBeUndefined();
    expect(stream.budget_tokens).toBeUndefined();
  });

  it("Gemini: thinkingLevel로 깊이를 정하고 스트리밍에서만 요약을 요청한다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(successResponse("ok"))
      .mockResolvedValueOnce(
        new Response(
          'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\n',
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const llm = createGeminiClient("AIzaTest", "gemini-3.8-flash") as StreamingLlmClient;
    await llm.complete("채점", { temperature: 0, effort: "medium" });
    await llm.completeStream("생성", { temperature: 0.7, effort: "high" }, () => {});

    const [json, stream] = bodiesOf(fetchMock);
    expect(json.generationConfig).toEqual({
      maxOutputTokens: 8192,
      thinkingConfig: { thinkingLevel: "MEDIUM" },
    });
    expect(stream.generationConfig).toEqual({
      maxOutputTokens: 8192,
      thinkingConfig: { thinkingLevel: "HIGH", includeThoughts: true },
    });
  });

  it("OpenRouter: reasoning.effort를 붙이고 temperature는 보내지 않는다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "ok" } }] }));
    vi.stubGlobal("fetch", fetchMock);

    await createOpenRouterClient("sk-or-v1-test", "openai/gpt-5.6-sol").complete("채점", {
      temperature: 0,
      effort: "low",
    });
    const [body] = bodiesOf(fetchMock);
    expect(body).toEqual({
      model: "openai/gpt-5.6-sol",
      messages: [{ role: "user", content: "채점" }],
      max_tokens: 8192,
      reasoning: { effort: "low" },
    });
  });

  it("스트림이 절단·실패를 알리면 잘린 산출물을 완성본으로 돌려주지 않는다", async () => {
    const sse = (...lines: string[]) =>
      new Response(lines.map((line) => `data: ${line}\n\n`).join("") + "data: [DONE]\n\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });

    // OpenAI: 일부 텍스트 뒤 max_output_tokens 절단
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sse(
          '{"type":"response.output_text.delta","delta":"앞부분"}',
          '{"type":"response.incomplete","response":{"incomplete_details":{"reason":"max_output_tokens"}}}',
        ),
      ),
    );
    const openai = createOpenAIClient("sk-test", "gpt-5.6-sol") as StreamingLlmClient;
    await expect(openai.completeStream("생성", { effort: "high" }, () => {})).rejects.toThrow(
      "출력 토큰 한도",
    );

    // Claude: message_delta의 stop_reason=max_tokens
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sse(
          '{"type":"content_block_delta","delta":{"type":"text_delta","text":"앞부분"}}',
          '{"type":"message_delta","delta":{"stop_reason":"max_tokens"}}',
        ),
      ),
    );
    const claude = createAnthropicClient("sk-ant-test", "claude-opus-5") as StreamingLlmClient;
    await expect(claude.completeStream("생성", { effort: "high" }, () => {})).rejects.toThrow(
      "출력 토큰 한도",
    );

    // Gemini: finishReason=MAX_TOKENS
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sse(
          '{"candidates":[{"content":{"parts":[{"text":"앞부분"}]}}]}',
          '{"candidates":[{"content":{"parts":[]},"finishReason":"MAX_TOKENS"}]}',
        ),
      ),
    );
    const gemini = createGeminiClient("AIzaTest", "gemini-3.8-flash") as StreamingLlmClient;
    await expect(gemini.completeStream("생성", { effort: "high" }, () => {})).rejects.toThrow(
      "출력 토큰 한도",
    );

    // 정상 종료(STOP)는 실패가 아니다
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sse('{"candidates":[{"content":{"parts":[{"text":"완성"}]},"finishReason":"STOP"}]}'),
      ),
    );
    await expect(gemini.completeStream("생성", { effort: "high" }, () => {})).resolves.toBe("완성");
  });

  it("Vertex 토큰 발급이 멈추면 스트림 시간 한도로 함께 끊긴다", async () => {
    const raw = await vertexCredential();
    // 토큰 endpoint가 영원히 응답하지 않는 상황 — abort 신호가 오면 그때 거부한다
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createVertexClient(raw, "gemini-3.8-flash", {
      requestTimeoutMs: 30,
      maxAttempts: 1,
    }) as StreamingLlmClient;
    await expect(client.completeStream("요청", { effort: "low" }, () => {})).rejects.toThrow(
      /aborted|시간 초과/,
    );
    expect(fetchMock.mock.calls[0][0]).toBe("https://oauth2.googleapis.com/token");
  });

  it("effort를 생략하면 medium이다", async () => {
    const fetchMock = vi.fn(async () => openAISuccessResponse("ok"));
    vi.stubGlobal("fetch", fetchMock);
    await createOpenAIClient("sk-test", "gpt-5.6-sol").complete("요청");
    expect(bodiesOf(fetchMock)[0].reasoning).toEqual({ effort: "medium" });
  });
});
