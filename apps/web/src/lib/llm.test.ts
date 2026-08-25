/** 모의 모델 회귀 테스트 — 관통 시나리오: 원샷은 부분 커버, 변이가 실패 케이스를 흡수해 등반.
 *  승인 전 요건(검증 배터리 → 캘리브레이션 → 차단 해제)도 같은 모의 모델로 관통한다. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { approvalBlockers, judgeCalibration, type CaseDef } from "@harnest/contracts";
import {
  buildCalibrationPairs,
  compile,
  createGenerator,
  createInitial,
  createScorer,
  draftCases,
  runExaminerBattery,
  scoreHoldout,
} from "@harnest/template-handover";
import type { HandoverProblem } from "@harnest/template-handover";
import {
  createAssistMockClient,
  createGeminiClient,
  createMockClient,
  createOpenAIClient,
  createVertexClient,
  getByoCredential,
  normalizeVertexServiceAccount,
  parseVertexServiceAccount,
  setByoCredential,
  testByoConnection,
} from "./llm";

const c = (id: string, q: string, a: string): CaseDef => ({ id, question: q, expectedAnswer: a });

const problem: HandoverProblem = {
  material: "저는 사내 배포 파이프라인을 관리합니다.",
  visibleCases: [
    c("case-1", "배포는 어떻게 시작하나요?", "매주 화요일 오전에 스테이징에서 deploy.sh를 먼저 실행합니다."),
    c("case-2", "배포가 실패하면 어떻게 롤백하나요?", "rollback.sh에 직전 릴리스 태그를 넘기면 이전 버전으로 돌아갑니다."),
    c("case-3", "마이그레이션은 누가 승인하나요?", "데이터팀 리드의 승인을 받아야 하며 금요일에는 실행하지 않습니다."),
    c("case-4", "모니터링 알림은 어디로 오나요?", "그라파나 경보가 슬랙 채널로 오고 심각도가 높으면 전화까지 연결됩니다."),
  ],
  holdoutCases: [
    c("case-5", "비밀 키는 어디에 보관하나요?", "모든 비밀 키는 볼트에 저장하며 저장소에 넣는 것은 금지입니다."),
  ],
  lengthCap: 2000,
};

describe("BYO 키 저장", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("Gemini·Vertex·OpenAI 자격 증명을 서로 다른 localStorage 슬롯에 보관한다", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });

    setByoCredential("gemini", "gemini-key");
    setByoCredential("vertex", "vertex-credential");
    setByoCredential("openai", "openai-key");
    expect(getByoCredential("gemini")).toBe("gemini-key");
    expect(getByoCredential("vertex")).toBe("vertex-credential");
    expect(getByoCredential("openai")).toBe("openai-key");

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
    const generate = createGenerator(problem, llm);

    const doc0 = await initial(() => 0);
    const s0 = await scorer(doc0);
    expect(s0.gateRejected).toBe(false);
    expect(s0.total).toBeGreaterThan(0);
    expect(s0.total).toBeLessThan(100);

    const doc1 = await generate(doc0, () => 0, {
      round: 1,
      championScore: s0.total,
      championViolations: s0.violations,
    });
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

  it("승인 전 요건 관통: 검증 배터리 → 캘리브레이션(꼼수 쌍 포함) → 승인 차단 해제", async () => {
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

    const run = await runExaminerBattery(p, pack, llm);
    expect(run.report.forDigest).toBe(pack.definitionDigest);
    // 종합 "주의"의 출처까지 고정: 순서(절단본 0 = 빈 문서 0 동점)와 꼼수 내성(모의 grader가
    // 오염 응답에 부분 점수) — 정직 표기가 그대로 판정에 남는다
    expect(run.report.checks.map((c) => `${c.id}:${c.verdict}`)).toEqual([
      "ordering:warn",
      "discrimination:pass",
      "stability:pass",
      "hack_resistance:warn",
    ]);
    expect(run.report.overall).toBe("warn");

    const pairs = buildCalibrationPairs(run, pack);
    expect(pairs.length).toBeGreaterThanOrEqual(2);
    expect(pairs[0].kind).toBe("hack_probe");

    // 승인 요건: 리포트만으로는 부족하고, 사용자 판정이 모두 모여야 차단이 풀린다
    expect(approvalBlockers(pack, run.report, null)).toHaveLength(1);
    const calibration = judgeCalibration(
      pairs,
      pairs.map((s) => s.examinerChoice),
      pack,
      run.report,
    );
    expect(calibration.verdict).toBe("pass");
    expect(approvalBlockers(pack, run.report, calibration)).toEqual([]);

    // 검증을 다시 실행하면(새 리포트 인스턴스) 이전 캘리브레이션은 자동 무효
    // (리포트 인스턴스 결속 규칙 자체는 contracts/examiner.test.ts가 결정적으로 검증)
    expect(
      approvalBlockers(
        pack,
        { ...run.report, ranAt: "2026-08-23T23:59:59.000Z" },
        calibration,
      ).some((b) => b.includes("검증이 다시 실행")),
    ).toBe(true);
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
    const client = createVertexClient(raw, "gemini-3.7-flash", { retryBaseMs: 0 });

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
      "https://aiplatform.googleapis.com/v1/projects/vertex-project/locations/global/publishers/google/models/gemini-3.7-flash:generateContent",
    );
    expect(vertexInit?.headers).toEqual({
      Authorization: "Bearer vertex-token",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(vertexInit?.body))).toMatchObject({
      contents: [{ role: "user", parts: [{ text: "요청 본문" }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 64 },
    });
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
      reasoning: { effort: "none" },
      temperature: 0,
      max_output_tokens: 64,
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
      temperature: 0,
      max_output_tokens: 16,
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
