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
  createSharedGeminiClient,
  createSharedOpenAIClient,
  createVertexClient,
  detectAndListModels,
  detectByoCredential,
  formatModelLabel,
  getByoCredential,
  hasSharedKey,
  listAvailableModels,
  loadSharedProviders,
  normalizeVertexServiceAccount,
  normalizeOllamaBaseUrl,
  parseVertexServiceAccount,
  setByoCredential,
  sharedModelsFor,
  StreamReportedFailure,
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
      // 추론 토큰이 출력 한도를 나눠 쓰므로 64는 medium 바닥(8192)으로 올라간다
      generationConfig: { maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: "MEDIUM" } },
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
    // 절단 문구는 스트림 판정(googleFailure)과 같고, 추론이 예산을 잠식한 단서는 그대로 붙는다
    await expect(client.complete("요청")).rejects.toThrow(
      "Vertex AI 출력 토큰 한도에 도달해 산출물이 잘렸습니다 (thinking 16 tokens)",
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
      // 64는 medium 바닥(8192)으로 올라간다 — 추론 토큰이 같은 한도를 쓴다
      max_output_tokens: 8192,
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

  const sseOnce = (...lines: string[]) =>
    vi.fn(async () =>
      new Response(lines.map((line) => `data: ${line}\n\n`).join("") + "data: [DONE]\n\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
  const bodiesOf = (fetchMock: ReturnType<typeof vi.fn>) =>
    fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)));

  it("OpenAI: 채점(medium)과 생성(high) 모두 추론을 붙이고 temperature는 보내지 않는다", async () => {
    const fetchMock = sseOnce(
      '{"type":"response.output_text.delta","delta":"x"}',
      '{"type":"response.completed"}',
    );
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
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\n' +
            'data: {"type":"message_stop"}\n\n',
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
      max_tokens: 8192,
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
          'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]},"finishReason":"STOP"}]}\n\n',
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
      // high는 바닥이 16384 — 깊은 추론이 본문 예산을 잠식하지 않게
      maxOutputTokens: 16384,
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

  it("Vertex 토큰 발급이 멈추면 스트림 유휴 한도로 함께 끊기고 한국어로 안내한다", async () => {
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
      "Vertex AI 0.03초 동안 응답이 없어 중단했습니다 (스트림 유휴 시간 초과 30ms)",
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

const sse = (...lines: string[]): Response =>
  new Response(lines.map((line) => `data: ${line}\n\n`).join("") + "data: [DONE]\n\n", {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
const bodyOf = (call: unknown[]): Record<string, unknown> =>
  JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>;

describe("출력 상한 바닥은 effort별이다", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["low", 4096],
    ["medium", 8192],
    ["high", 16384],
  ] as const)("%s 추론은 본문 예산 512를 %s으로 올린다", async (effort, floor) => {
    const fetchMock = vi.fn(async () => openAISuccessResponse("ok"));
    vi.stubGlobal("fetch", fetchMock);
    await createOpenAIClient("sk-test", "gpt-5.6-sol").complete("전략", {
      effort,
      maxOutputTokens: 512,
    });
    expect(bodyOf(fetchMock.mock.calls[0]).max_output_tokens).toBe(floor);
  });

  it("본문 예산이 바닥보다 크면 그대로 쓴다", async () => {
    const fetchMock = vi.fn(async () => openAISuccessResponse("ok"));
    vi.stubGlobal("fetch", fetchMock);
    await createOpenAIClient("sk-test", "gpt-5.6-sol").complete("생성", {
      effort: "high",
      maxOutputTokens: 40_000,
    });
    expect(bodyOf(fetchMock.mock.calls[0]).max_output_tokens).toBe(40_000);
  });
});

describe("비스트리밍 응답도 절단·실패를 알리면 잘린 산출물을 돌려주지 않는다", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("Gemini: 텍스트가 있어도 finishReason이 STOP이 아니면 오류다", async () => {
    const gemini = createGeminiClient("AIzaTest", "gemini-3.8-flash", { retryBaseMs: 0 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          candidates: [{ content: { parts: [{ text: "앞부분" }] }, finishReason: "MAX_TOKENS" }],
        }),
      ),
    );
    await expect(gemini.complete("생성", { effort: "high" })).rejects.toThrow(
      "Gemini 출력 토큰 한도에 도달해 산출물이 잘렸습니다",
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          candidates: [{ content: { parts: [{ text: "앞부분" }] }, finishReason: "SAFETY" }],
        }),
      ),
    );
    await expect(gemini.complete("생성")).rejects.toThrow("정상 종료되지 않았습니다 (SAFETY)");

    // STOP이나 finishReason 없음은 정상이다
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          candidates: [{ content: { parts: [{ text: "완성" }] }, finishReason: "STOP" }],
        }),
      ),
    );
    await expect(gemini.complete("생성")).resolves.toBe("완성");
    vi.stubGlobal("fetch", vi.fn(async () => successResponse("완성")));
    await expect(gemini.complete("생성")).resolves.toBe("완성");
  });

  it("OpenAI: status가 incomplete·failed면 텍스트가 있어도 오류다", async () => {
    const openai = createOpenAIClient("sk-test", "gpt-5.6-sol", { retryBaseMs: 0 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          output: [{ type: "message", content: [{ type: "output_text", text: "앞부분" }] }],
        }),
      ),
    );
    await expect(openai.complete("생성", { effort: "high" })).rejects.toThrow(
      "OpenAI 출력 토큰 한도에 도달해 산출물이 잘렸습니다",
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          status: "failed",
          error: { message: "server_error" },
          output: [{ type: "message", content: [{ type: "output_text", text: "앞부분" }] }],
        }),
      ),
    );
    await expect(openai.complete("생성")).rejects.toThrow("OpenAI 응답 실패: server_error");
  });

  it("Claude: 컨텍스트 창 절단·알 수 없는 종료 사유도 텍스트가 있어도 오류다 (허용 목록: end_turn·stop_sequence)", async () => {
    const claude = createAnthropicClient("sk-ant-test", "claude-opus-5", { retryBaseMs: 0 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          content: [{ type: "text", text: "앞부분" }],
          stop_reason: "model_context_window_exceeded",
        }),
      ),
    );
    await expect(claude.complete("생성", { effort: "high" })).rejects.toThrow(
      "Claude 컨텍스트 창 한도에 도달해 산출물이 잘렸습니다 (model_context_window_exceeded)",
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ content: [{ type: "text", text: "앞부분" }], stop_reason: "pause_turn" }),
      ),
    );
    await expect(claude.complete("생성")).rejects.toThrow("응답이 정상 종료되지 않았습니다 (pause_turn)");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ content: [{ type: "text", text: "완성" }], stop_reason: "stop_sequence" }),
      ),
    );
    await expect(claude.complete("생성")).resolves.toBe("완성");

    // 스트림의 message_delta도 같은 판정이다
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sse(
          '{"type":"content_block_delta","delta":{"type":"text_delta","text":"앞부분"}}',
          '{"type":"message_delta","delta":{"stop_reason":"model_context_window_exceeded"}}',
          '{"type":"message_stop"}',
        ),
      ),
    );
    await expect(
      (claude as StreamingLlmClient).completeStream("생성", { effort: "high" }, () => {}),
    ).rejects.toThrow("컨텍스트 창 한도에 도달해 산출물이 잘렸습니다");
  });

  it("OpenRouter: finish_reason이 content_filter·error면 텍스트가 있어도 오류, stop만 정상이다", async () => {
    const openrouter = createOpenRouterClient("or-key", "openai/gpt-5.6-sol", { retryBaseMs: 0 });
    for (const reason of ["content_filter", "error"]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          jsonResponse({ choices: [{ message: { content: "앞부분" }, finish_reason: reason }] }),
        ),
      );
      await expect(openrouter.complete("생성")).rejects.toThrow(
        `OpenRouter 응답이 정상 종료되지 않았습니다 (${reason})`,
      );
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ choices: [{ message: { content: "완성" }, finish_reason: "stop" }] }),
      ),
    );
    await expect(openrouter.complete("생성")).resolves.toBe("완성");

    // Ollama의 done_reason도 stop만 정상이다
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ message: { content: "앞부분" }, done: true, done_reason: "abort" }),
      ),
    );
    await expect(
      createOllamaClient("http://localhost:11434", "llama3.1", { retryBaseMs: 0 }).complete("생성"),
    ).rejects.toThrow("Ollama 응답이 정상 종료되지 않았습니다 (abort)");
  });

  it("Claude: stop_reason이 max_tokens·refusal이면 오류, end_turn은 정상이다", async () => {
    const claude = createAnthropicClient("sk-ant-test", "claude-opus-5", { retryBaseMs: 0 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ content: [{ type: "text", text: "앞부분" }], stop_reason: "max_tokens" }),
      ),
    );
    await expect(claude.complete("생성", { effort: "high" })).rejects.toThrow(
      "Claude 출력 토큰 한도에 도달해 산출물이 잘렸습니다",
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ content: [], stop_reason: "refusal" })),
    );
    await expect(claude.complete("생성")).rejects.toThrow("모델이 요청을 거부했습니다 (refusal)");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ content: [{ type: "text", text: "완성" }], stop_reason: "end_turn" }),
      ),
    );
    await expect(claude.complete("생성")).resolves.toBe("완성");
  });

  it("OpenRouter finish_reason=length · Ollama done_reason=length도 오류다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ choices: [{ message: { content: "앞부분" }, finish_reason: "length" }] }),
      ),
    );
    await expect(
      createOpenRouterClient("or-key", "openai/gpt-5.6-sol", { retryBaseMs: 0 }).complete("생성"),
    ).rejects.toThrow("OpenRouter 출력 토큰 한도에 도달해 산출물이 잘렸습니다");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ message: { content: "앞부분" }, done: true, done_reason: "length" }),
      ),
    );
    await expect(
      createOllamaClient("http://localhost:11434", "llama3.1", { retryBaseMs: 0 }).complete("생성"),
    ).rejects.toThrow("Ollama 출력 토큰 한도에 도달해 산출물이 잘렸습니다");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ message: { content: "완성" }, done: true, done_reason: "stop" }),
      ),
    );
    await expect(
      createOllamaClient("http://localhost:11434", "llama3.1", { retryBaseMs: 0 }).complete("생성"),
    ).resolves.toBe("완성");
  });

  it("공유 키 경로(항상 비스트리밍)도 같은 판정을 받는다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          output: [{ type: "message", content: [{ type: "output_text", text: "앞부분" }] }],
        }),
      ),
    );
    await expect(
      createSharedOpenAIClient("gpt-5.6-sol", { apiBase: "http://api.test", retryBaseMs: 0 }).complete(
        "생성",
      ),
    ).rejects.toThrow("OpenAI(공유) 출력 토큰 한도에 도달해 산출물이 잘렸습니다");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          candidates: [{ content: { parts: [{ text: "앞부분" }] }, finishReason: "MAX_TOKENS" }],
        }),
      ),
    );
    await expect(
      createSharedGeminiClient("gemini-3.8-flash", { apiBase: "http://api.test", retryBaseMs: 0 }).complete(
        "생성",
      ),
    ).rejects.toThrow("Gemini(공유) 출력 토큰 한도에 도달해 산출물이 잘렸습니다");
  });

  it("스트림이 열리지 않아 폴백한 비스트리밍 응답도 절단이면 거부한다", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(
        jsonResponse({ content: [{ type: "text", text: "앞부분" }], stop_reason: "max_tokens" }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const claude = createAnthropicClient("sk-ant-test", "claude-opus-5", {
      maxAttempts: 1,
      retryBaseMs: 0,
    }) as StreamingLlmClient;
    const notices: string[] = [];
    await expect(
      claude.completeStream("생성", { effort: "high" }, (chunk, kind) => {
        if (kind === "notice") notices.push(chunk);
      }),
    ).rejects.toThrow("출력 토큰 한도에 도달해 산출물이 잘렸습니다");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(notices.some((n) => n.includes("스트리밍이 열리지 않아 한 번에 받아옵니다"))).toBe(true);
  });
});

describe("직접(BYO) 비스트리밍 경로의 시간 초과 — 재전송하지 않는다", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** abort 신호가 오기 전까지 응답하지 않는 fetch */
  const hanging = (init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("The user aborted a request.", "AbortError")),
      );
    });
  const timeoutOptions = { requestTimeoutMs: 10, maxAttempts: 3, retryBaseMs: 0 };

  it.each([
    ["OpenAI", () => createOpenAIClient("sk-test", "gpt-5.6-sol", timeoutOptions)],
    ["Gemini", () => createGeminiClient("AIzaTest", "gemini-3.8-flash", timeoutOptions)],
    ["Claude", () => createAnthropicClient("sk-ant-test", "claude-opus-5", timeoutOptions)],
    ["OpenRouter", () => createOpenRouterClient("or-key", "openai/gpt-5.6-sol", timeoutOptions)],
  ])("%s: 응답이 없어 시간 초과되면 maxAttempts가 남아도 fetch는 한 번뿐이다", async (label, make) => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => hanging(init));
    vi.stubGlobal("fetch", fetchMock);
    await expect(make().complete("생성", { effort: "low" })).rejects.toThrow(
      `${label} 요청 시간 초과 (10ms) — 벤더가 이미 받아들인 요청일 수 있어 다시 보내지 않습니다.`,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Vertex AI: 토큰 발급이 멈춰 시간 초과돼도 다시 보내지 않는다", async () => {
    const raw = await vertexCredential();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => hanging(init));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      createVertexClient(raw, "gemini-3.8-flash", timeoutOptions).complete("생성", { effort: "low" }),
    ).rejects.toThrow("Vertex AI 요청 시간 초과 (10ms) — 벤더가 이미 받아들인 요청일 수 있어 다시 보내지 않습니다.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("응답 본문(JSON)을 읽는 도중 시간 초과돼도 다시 보내지 않는다", async () => {
    // HTTP 200은 왔지만 본문이 끝나지 않는 응답 — 벤더가 받아들여 생성 중인 요청이다
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const response = {
        ok: true,
        status: 200,
        json: () =>
          new Promise<never>((_, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("The user aborted a request.", "AbortError")),
            );
          }),
      };
      return response as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      createOpenAIClient("sk-test", "gpt-5.6-sol", timeoutOptions).complete("생성", { effort: "low" }),
    ).rejects.toThrow("OpenAI 요청 시간 초과 (10ms) — 벤더가 이미 받아들인 요청일 수 있어 다시 보내지 않습니다.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("네트워크 오류(응답 없음)는 여전히 백오프 재시도한다", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(openAISuccessResponse("복구됨"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      createOpenAIClient("sk-test", "gpt-5.6-sol", { retryBaseMs: 0 }).complete("생성"),
    ).resolves.toBe("복구됨");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("스트림 완료 신호 — 없이 끝난 스트림은 부분 산출물이다", () => {
  afterEach(() => vi.unstubAllGlobals());
  const ndjson = (...lines: string[]) =>
    new Response(lines.join("\n") + "\n", {
      status: 200,
      headers: { "Content-Type": "application/x-ndjson" },
    });

  const cases: Array<{
    label: string;
    make: () => StreamingLlmClient;
    stream: (...lines: string[]) => Response;
    pieces: string[];
    terminal: string;
  }> = [
    {
      label: "OpenAI",
      make: () => createOpenAIClient("sk-test", "gpt-5.6-sol", { retryBaseMs: 0 }) as StreamingLlmClient,
      stream: sse,
      pieces: ['{"type":"response.output_text.delta","delta":"앞부분"}'],
      terminal: '{"type":"response.completed"}',
    },
    {
      label: "Gemini",
      make: () => createGeminiClient("AIzaTest", "gemini-3.8-flash", { retryBaseMs: 0 }) as StreamingLlmClient,
      stream: sse,
      pieces: ['{"candidates":[{"content":{"parts":[{"text":"앞부분"}]}}]}'],
      terminal: '{"candidates":[{"content":{"parts":[{"text":""}]},"finishReason":"STOP"}]}',
    },
    {
      label: "Claude",
      make: () =>
        createAnthropicClient("sk-ant-test", "claude-opus-5", { retryBaseMs: 0 }) as StreamingLlmClient,
      stream: sse,
      pieces: [
        '{"type":"content_block_delta","delta":{"type":"text_delta","text":"앞부분"}}',
        '{"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
      ],
      terminal: '{"type":"message_stop"}',
    },
    {
      label: "OpenRouter",
      make: () =>
        createOpenRouterClient("or-key", "openai/gpt-5.6-sol", { retryBaseMs: 0 }) as StreamingLlmClient,
      stream: sse,
      pieces: ['{"choices":[{"delta":{"content":"앞부분"},"finish_reason":null}]}'],
      terminal: '{"choices":[{"delta":{},"finish_reason":"stop"}]}',
    },
    {
      label: "Ollama",
      make: () =>
        createOllamaClient("http://localhost:11434", "llama3.1", { retryBaseMs: 0 }) as StreamingLlmClient,
      stream: ndjson,
      pieces: ['{"message":{"role":"assistant","content":"앞부분"},"done":false}'],
      terminal: '{"message":{"role":"assistant","content":""},"done":true,"done_reason":"stop"}',
    },
  ];

  it.each(cases)(
    "$label: 완료 신호 없이 본문이 닫히면 오류이며 비스트리밍으로 다시 보내지 않는다",
    async ({ make, stream, pieces }) => {
      const fetchMock = vi.fn(async () => stream(...pieces));
      vi.stubGlobal("fetch", fetchMock);
      const notices: string[] = [];
      await expect(
        make().completeStream("생성", { effort: "high" }, (chunk, kind) => {
          if (kind === "notice") notices.push(chunk);
        }),
      ).rejects.toThrow("스트림이 완료 신호 없이 끝났습니다 (3자 수신)");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(notices.some((n) => n.includes("한 번에"))).toBe(false);
    },
  );

  it.each(cases)("$label: 완료 신호가 있으면 정상 산출물이다", async ({ make, stream, pieces, terminal }) => {
    vi.stubGlobal("fetch", vi.fn(async () => stream(...pieces, terminal)));
    await expect(make().completeStream("생성", { effort: "high" }, () => {})).resolves.toBe("앞부분");
  });
});

describe("공유 키 경로의 재시도", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("504(상류 시간 초과)는 재시도하지 않는다 — 벤더 쪽 생성은 계속돼 중복 과금이 된다", async () => {
    const openaiFetch = vi.fn(async () => errorResponse(504, "upstream timeout"));
    vi.stubGlobal("fetch", openaiFetch);
    await expect(
      createSharedOpenAIClient("gpt-5.6-sol", { apiBase: "http://api.test", retryBaseMs: 0 }).complete(
        "생성",
      ),
    ).rejects.toThrow("OpenAI(공유) HTTP 504: upstream timeout");
    expect(openaiFetch).toHaveBeenCalledTimes(1);

    const geminiFetch = vi.fn(async () => errorResponse(504, "upstream timeout"));
    vi.stubGlobal("fetch", geminiFetch);
    await expect(
      createSharedGeminiClient("gemini-3.8-flash", { apiBase: "http://api.test", retryBaseMs: 0 }).complete(
        "생성",
      ),
    ).rejects.toThrow("Gemini(공유) HTTP 504");
    expect(geminiFetch).toHaveBeenCalledTimes(1);
  });

  it("클라이언트 시간 초과(abort)도 재시도하지 않는다 — 시간 초과된 생성은 벤더 쪽에서 완주·과금된다", async () => {
    /** abort 신호가 오기 전까지 응답하지 않는 fetch — 실제 브라우저처럼 AbortError로 거부된다 */
    const hanging = (init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("The user aborted a request.", "AbortError")),
        );
      });
    const openaiFetch = vi.fn(async (_url: string, init?: RequestInit) => hanging(init));
    vi.stubGlobal("fetch", openaiFetch);
    await expect(
      createSharedOpenAIClient("gpt-5.6-sol", {
        apiBase: "http://api.test",
        requestTimeoutMs: 10,
        retryBaseMs: 0,
      }).complete("생성"),
    ).rejects.toThrow("OpenAI(공유) 요청 시간 초과 (10ms) — 같은 요청을 다시 보내면 관리자 비용만 반복되니 재시도하지 않습니다");
    expect(openaiFetch).toHaveBeenCalledTimes(1);

    const geminiFetch = vi.fn(async (_url: string, init?: RequestInit) => hanging(init));
    vi.stubGlobal("fetch", geminiFetch);
    await expect(
      createSharedGeminiClient("gemini-3.8-flash", {
        apiBase: "http://api.test",
        requestTimeoutMs: 10,
        retryBaseMs: 0,
      }).complete("생성"),
    ).rejects.toThrow("Gemini(공유) 요청 시간 초과 (10ms)");
    expect(geminiFetch).toHaveBeenCalledTimes(1);
  });

  it("기본 한도는 서버 읽기 한도 상한(780초) + 60초에서 멈춘다 — edge 유휴 한도(900초)보다 먼저 끊지 않고, 출력 상한이 커도 그 이상 기다리지 않는다", async () => {
    vi.useFakeTimers();
    const hanging = (init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("The user aborted a request.", "AbortError")),
        );
      });
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => hanging(init));
    vi.stubGlobal("fetch", fetchMock);
    // 64,000토큰 × 30ms = 1,920초 — 상한 없이는 edge(900초)가 먼저 끊어 시간 초과 안내가 닿지 않는다
    const assertion = expect(
      createSharedOpenAIClient("gpt-5.6-sol", { apiBase: "http://api.test", retryBaseMs: 0 }).complete(
        "생성",
        { maxOutputTokens: 64_000 },
      ),
    ).rejects.toThrow("OpenAI(공유) 요청 시간 초과 (840000ms)");
    await vi.advanceTimersByTimeAsync(839_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("네트워크 단절도 재시도하지 않는다 — 서버가 받아 벤더에 쓴 뒤 edge가 끊은 경우와 구분할 수 없다", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(openAISuccessResponse("복구됨"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      createSharedOpenAIClient("gpt-5.6-sol", { apiBase: "http://api.test", retryBaseMs: 0 }).complete(
        "생성",
      ),
    ).rejects.toThrow("OpenAI(공유) 네트워크 오류: Failed to fetch — 서버가 이미 받아 처리 중일 수 있어 자동으로 다시 보내지 않습니다");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const geminiFetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", geminiFetch);
    await expect(
      createSharedGeminiClient("gemini-3.8-flash", { apiBase: "http://api.test", retryBaseMs: 0 }).complete(
        "생성",
      ),
    ).rejects.toThrow("Gemini(공유) 네트워크 오류");
    expect(geminiFetch).toHaveBeenCalledTimes(1);
  });

  it("그 밖의 5xx·429는 여전히 재시도한다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(503, "잠시 후"))
      .mockResolvedValueOnce(errorResponse(429, "한도"))
      .mockResolvedValueOnce(openAISuccessResponse("복구됨"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      createSharedOpenAIClient("gpt-5.6-sol", { apiBase: "http://api.test", retryBaseMs: 0 }).complete(
        "생성",
      ),
    ).resolves.toBe("복구됨");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe("http://api.test/proxy/openai");
  });
});

describe("스트림 실패 시 폴백 규칙", () => {
  afterEach(() => vi.unstubAllGlobals());

  const collect = () => {
    const notices: string[] = [];
    const onChunk = (chunk: string, kind: string) => {
      if (kind === "notice") notices.push(chunk);
    };
    return { notices, onChunk };
  };

  it("텍스트 없이 max_tokens로 끝난 스트림은 fetch 1회로 끝나고 절단 사유로 거부된다", async () => {
    const fetchMock = vi.fn(async () =>
      sse('{"type":"message_delta","delta":{"stop_reason":"max_tokens"}}'),
    );
    vi.stubGlobal("fetch", fetchMock);
    const claude = createAnthropicClient("sk-ant-test", "claude-opus-5") as StreamingLlmClient;
    const { notices, onChunk } = collect();
    let caught: unknown;
    try {
      await claude.completeStream("생성", { effort: "high" }, onChunk);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(StreamReportedFailure);
    expect((caught as Error).message).toBe("Claude 출력 토큰 한도에 도달해 산출물이 잘렸습니다");
    // 비스트리밍으로 다시 보내지 않는다 — 추론 비용만 두 배다
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(notices.some((n) => n.includes("한 번에 받아옵니다"))).toBe(false);
  });

  it.each([401, 403, 404])("HTTP %s 스트림은 안내 없이 fetch 1회로 즉시 실패한다", async (status) => {
    const fetchMock = vi.fn(async () => errorResponse(status, "거절"));
    vi.stubGlobal("fetch", fetchMock);
    const openai = createOpenAIClient("sk-test", "gpt-5.6-sol") as StreamingLlmClient;
    const { notices, onChunk } = collect();
    await expect(openai.completeStream("생성", { effort: "high" }, onChunk)).rejects.toThrow(
      `OpenAI HTTP ${status}: 거절`,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(notices).toEqual([]);
  });

  it.each([429, 503, 529])(
    "HTTP %s 스트림은 일시 거절이라 안내 후 비스트리밍 폴백의 백오프 재시도로 정상 응답을 돌려준다",
    async (status) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(errorResponse(status, "잠시 후"))
        .mockResolvedValueOnce(errorResponse(status, "잠시 후"))
        .mockResolvedValueOnce(openAISuccessResponse("복구됨"));
      vi.stubGlobal("fetch", fetchMock);
      const openai = createOpenAIClient("sk-test", "gpt-5.6-sol", {
        retryBaseMs: 0,
      }) as StreamingLlmClient;
      const { notices, onChunk } = collect();
      await expect(openai.completeStream("생성", { effort: "high" }, onChunk)).resolves.toBe("복구됨");
      // 스트림 1회 → 비스트리밍 경로가 같은 본문(stream 없음)으로 재시도해 복구한다
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(bodyOf(fetchMock.mock.calls[0]).stream).toBe(true);
      expect(bodyOf(fetchMock.mock.calls[1]).stream).toBeUndefined();
      expect(bodyOf(fetchMock.mock.calls[2]).stream).toBeUndefined();
      expect(notices.some((n) => n.includes(`HTTP ${status}`) && n.includes("다시 시도"))).toBe(true);
    },
  );

  it("스트림이 열린 뒤 끊기면 산출물이 없어도 재전송하지 않는다 — 벤더는 이미 처리 중이다", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"response.created"}\n\n'));
        controller.error(new Error("socket hang up"));
      },
    });
    const fetchMock = vi.fn(
      async () =>
        new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const openai = createOpenAIClient("sk-test", "gpt-5.6-sol", { retryBaseMs: 0 }) as StreamingLlmClient;
    const { notices, onChunk } = collect();
    await expect(openai.completeStream("생성", { effort: "high" }, onChunk)).rejects.toThrow(
      /스트림이 시작된 뒤 끊겼습니다.*socket hang up/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(notices.some((n) => n.includes("한 번에"))).toBe(false);
  });

  it("정상 종료했지만 산출물이 없는 스트림은 오류이며 재전송하지 않는다", async () => {
    const fetchMock = vi.fn(async () =>
      sse('{"type":"response.created"}', '{"type":"response.completed"}'),
    );
    vi.stubGlobal("fetch", fetchMock);
    const openai = createOpenAIClient("sk-test", "gpt-5.6-sol", { retryBaseMs: 0 }) as StreamingLlmClient;
    const { notices, onChunk } = collect();
    await expect(openai.completeStream("생성", { effort: "high" }, onChunk)).rejects.toThrow(
      "스트림이 산출물 없이 끝났습니다",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(notices.some((n) => n.includes("한 번에"))).toBe(false);
  });

  it("일시 거절 폴백도 비스트리밍 경로의 재시도 한도를 넘기면 HTTP 상태를 그대로 던진다", async () => {
    const fetchMock = vi.fn(async () => errorResponse(429, "한도"));
    vi.stubGlobal("fetch", fetchMock);
    const openai = createOpenAIClient("sk-test", "gpt-5.6-sol", {
      retryBaseMs: 0,
      maxAttempts: 2,
    }) as StreamingLlmClient;
    const { onChunk } = collect();
    await expect(openai.completeStream("생성", { effort: "high" }, onChunk)).rejects.toThrow(
      "OpenAI HTTP 429: 한도",
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("HTTP 400은 relaxed로 본문이 실제 바뀌는 벤더만 한 번 더 — OpenAI는 summary를 뺀다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(400, "reasoning.summary not supported"))
      .mockResolvedValueOnce(
        sse('{"type":"response.output_text.delta","delta":"완성"}', '{"type":"response.completed"}'),
      );
    vi.stubGlobal("fetch", fetchMock);
    const openai = createOpenAIClient("sk-test", "gpt-5.6-sol") as StreamingLlmClient;
    const { notices, onChunk } = collect();
    await expect(openai.completeStream("생성", { effort: "high" }, onChunk)).resolves.toBe("완성");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchMock.mock.calls[0]).reasoning).toEqual({ effort: "high", summary: "detailed" });
    expect(bodyOf(fetchMock.mock.calls[1]).reasoning).toEqual({ effort: "high" });
    expect(notices.some((n) => n.includes("추론 옵션 없이 다시 요청합니다 (HTTP 400)"))).toBe(true);
  });

  it("본문이 같은 벤더(Gemini)의 400은 재시도 없이 즉시 던진다", async () => {
    const fetchMock = vi.fn(async () => errorResponse(400, "INVALID_ARGUMENT"));
    vi.stubGlobal("fetch", fetchMock);
    const gemini = createGeminiClient("AIzaTest", "gemini-3.8-flash") as StreamingLlmClient;
    const { notices, onChunk } = collect();
    await expect(gemini.completeStream("생성", { effort: "high" }, onChunk)).rejects.toThrow(
      "Gemini HTTP 400: INVALID_ARGUMENT",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(notices).toEqual([]);
  });

  it("Ollama: think를 거절당하면 think만 빼고 다시 흘려받아 스트리밍을 잃지 않는다", async () => {
    const ndjson = (...lines: string[]) =>
      new Response(lines.join("\n") + "\n", {
        status: 200,
        headers: { "Content-Type": "application/x-ndjson" },
      });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(400, '"llama3.1" does not support thinking'))
      .mockResolvedValueOnce(
        ndjson(
          '{"message":{"role":"assistant","content":"안녕"},"done":false}',
          '{"message":{"role":"assistant","content":"하세요"},"done":false}',
          '{"message":{"role":"assistant","content":""},"done":true,"done_reason":"stop"}',
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const ollama = createOllamaClient("http://localhost:11434", "llama3.1") as StreamingLlmClient;
    const outputs: string[] = [];
    const notices: string[] = [];
    await expect(
      ollama.completeStream("생성", { effort: "low" }, (chunk, kind) => {
        if (kind === "output") outputs.push(chunk);
        if (kind === "notice") notices.push(chunk);
      }),
    ).resolves.toBe("안녕하세요");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchMock.mock.calls[0])).toMatchObject({ think: true, stream: true });
    const relaxed = bodyOf(fetchMock.mock.calls[1]);
    expect(relaxed).not.toHaveProperty("think");
    expect(relaxed.stream).toBe(true);
    expect(outputs).toEqual(["안녕", "하세요"]);
    expect(notices.some((n) => n.includes("한 번에 받아옵니다"))).toBe(false);
  });

  it("응답을 받지 못한 네트워크 오류만 비스트리밍으로 되돌아간다", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(openAISuccessResponse("한 번에"));
    vi.stubGlobal("fetch", fetchMock);
    const openai = createOpenAIClient("sk-test", "gpt-5.6-sol", { maxAttempts: 1 }) as StreamingLlmClient;
    const { notices, onChunk } = collect();
    await expect(openai.completeStream("생성", { effort: "high" }, onChunk)).resolves.toBe("한 번에");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(notices.some((n) => n.includes("스트리밍이 열리지 않아 한 번에 받아옵니다"))).toBe(true);
  });
});

describe("시간 한도 — 스트리밍은 유휴, 비스트리밍은 출력 상한에 비례", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** abort 신호에 반응하는 스트림 응답 — 실제 브라우저처럼 fetch가 중단되면 read()가 거부된다 */
  const streamResponse = (
    init: RequestInit | undefined,
    start: (ctrl: ReadableStreamDefaultController<Uint8Array>) => void,
  ): Response => {
    const body = new ReadableStream<Uint8Array>({
      start(ctrl) {
        init?.signal?.addEventListener("abort", () => {
          try {
            ctrl.error(new DOMException("The user aborted a request.", "AbortError"));
          } catch {
            /* 이미 닫힘 */
          }
        });
        start(ctrl);
      },
    });
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  };

  it("바이트가 유휴 한도보다 오래 끊기면 한국어 유휴 시간 초과로 중단한다", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      streamResponse(init, (ctrl) => {
        ctrl.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"앞"}\n\n'));
        // 이후 영원히 조용하다
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const openai = createOpenAIClient("sk-test", "gpt-5.6-sol", {
      requestTimeoutMs: 1_000,
    }) as StreamingLlmClient;
    const assertion = expect(
      openai.completeStream("생성", { effort: "high" }, () => {}),
    ).rejects.toThrow("OpenAI 1초 동안 응답이 없어 중단했습니다 (스트림 유휴 시간 초과 1000ms)");
    await vi.advanceTimersByTimeAsync(1_100);
    await assertion;
    // 이미 산출물을 받았으므로 비스트리밍으로 다시 보내지 않는다
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("스트리밍 기본 유휴 한도는 600초다 — 추론 요약 없이 조용한 추론 단계를 3분에 끊지 않는다", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      streamResponse(init, (ctrl) => {
        // 스트림은 열렸지만(ping 한 줄) 추론 요약을 못 내주는 계정이라 이후 오래 조용하다
        ctrl.enqueue(new TextEncoder().encode(": ping\n\n"));
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const openai = createOpenAIClient("sk-test", "gpt-5.6-sol") as StreamingLlmClient;
    let settled: string | null = null;
    const call = openai.completeStream("생성", { effort: "high" }, () => {}).catch((error: Error) => {
      settled = error.message;
      return "";
    });
    await vi.advanceTimersByTimeAsync(181_000);
    expect(settled).toBeNull(); // 예전 180초 유휴 한도에서는 여기서 끊겼다
    await vi.advanceTimersByTimeAsync(419_000);
    await call;
    expect(settled).toBe(
      "OpenAI 600초 동안 응답이 없어 중단했습니다 (스트림 유휴 시간 초과 600000ms).",
    );
    // 스트림이 이미 열렸으므로 비스트리밍으로 다시 보내지 않는다
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("바이트가 계속 도착하는 한 총 시간이 유휴 한도를 아무리 넘어도 끊지 않는다", async () => {
    vi.useFakeTimers();
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      streamResponse(init, (ctrl) => {
        let sent = 0;
        const tick = () => {
          sent += 1;
          // 의미 없는 ping 줄도 바이트다 — 조각이 아니라 바이트로 유휴를 잰다
          const line = sent % 2 === 0 ? ": ping\n\n" : 'data: {"type":"response.output_text.delta","delta":"x"}\n\n';
          ctrl.enqueue(encoder.encode(line));
          if (sent < 20) {
            setTimeout(tick, 60);
          } else {
            ctrl.enqueue(encoder.encode('data: {"type":"response.completed"}\n\n'));
            ctrl.close();
          }
        };
        setTimeout(tick, 60);
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const openai = createOpenAIClient("sk-test", "gpt-5.6-sol", {
      requestTimeoutMs: 100, // 유휴 100ms, 전체 1,200ms
    }) as StreamingLlmClient;
    const result = openai.completeStream("생성", { effort: "high" }, () => {});
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(result).resolves.toBe("x".repeat(10));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("비스트리밍 기본 절대 한도는 출력 상한에 비례한다 (40,000토큰 → 20분)", async () => {
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
    const openai = createOpenAIClient("sk-test", "gpt-5.6-sol", { maxAttempts: 1, retryBaseMs: 0 });
    let settled = false;
    const call = openai
      .complete("생성", { effort: "high", maxOutputTokens: 40_000 })
      .catch((error: Error) => {
        settled = true;
        return error.message;
      });
    await vi.advanceTimersByTimeAsync(300_000);
    expect(settled).toBe(false); // 예전 5분 절대 한도에서는 여기서 끊겼다
    await vi.advanceTimersByTimeAsync(900_000);
    await expect(call).resolves.toBe(
      "OpenAI 요청 시간 초과 (1200000ms) — 벤더가 이미 받아들인 요청일 수 있어 다시 보내지 않습니다.",
    );
  });

  it("짧은 본문 예산은 5분 바닥을 유지하고, 명시한 requestTimeoutMs는 그대로 쓴다", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("중단됨", "AbortError")));
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const floor = expect(
      createOpenAIClient("sk-test", "gpt-5.6-sol", { maxAttempts: 1 }).complete("짧게", {
        effort: "low",
        maxOutputTokens: 16,
      }),
    ).rejects.toThrow("OpenAI 요청 시간 초과 (300000ms)");
    await vi.advanceTimersByTimeAsync(300_000);
    await floor;

    const explicit = expect(
      createOpenAIClient("sk-test", "gpt-5.6-sol", { maxAttempts: 1, requestTimeoutMs: 50 }).complete(
        "생성",
        { effort: "high", maxOutputTokens: 40_000 },
      ),
    ).rejects.toThrow("OpenAI 요청 시간 초과 (50ms)");
    await vi.advanceTimersByTimeAsync(50);
    await explicit;
  });
});

describe("/config의 공유 키·허용 모델", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sharedProviders와 sharedModels를 함께 캐시한다", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      jsonResponse({
        sharedProviders: { openai: true, gemini: false },
        sharedModels: { openai: ["gpt-5.6-sol", "gpt-5.6-mini", 7, ""], gemini: [] },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadSharedProviders("http://api.test")).resolves.toEqual({ openai: true });
    expect(fetchMock.mock.calls[0][0]).toBe("http://api.test/config");
    expect(hasSharedKey("openai")).toBe(true);
    expect(hasSharedKey("gemini")).toBe(false);
    expect(sharedModelsFor("openai")).toEqual(["gpt-5.6-sol", "gpt-5.6-mini"]);
    expect(sharedModelsFor("gemini")).toEqual([]);
  });

  it("서버가 sharedModels를 아직 주지 않거나 /config가 실패하면 빈 배열이다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ sharedProviders: { gemini: true } })));
    await expect(loadSharedProviders("http://api.test")).resolves.toEqual({ gemini: true });
    expect(sharedModelsFor("gemini")).toEqual([]);
    expect(sharedModelsFor("openai")).toEqual([]);

    vi.stubGlobal("fetch", vi.fn(async () => errorResponse(500, "down")));
    await expect(loadSharedProviders("http://api.test")).resolves.toEqual({});
    expect(hasSharedKey("gemini")).toBe(false);
    expect(sharedModelsFor("gemini")).toEqual([]);
  });
});
