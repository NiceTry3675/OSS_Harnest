import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ExportSaveError,
  MAX_EXPORT_BYTES,
  plainTextExcerpt,
  REJECTION_EXCERPT_MAX_CHARS,
  saveExport,
  savedExportUrl,
  sha256Utf8,
} from "./api";

const id = "123e4567-e89b-42d3-a456-426614174000";
const location = `/exports/${id}`;
const serialized = '{"kind":"harnest.project-export","한글":true}\n';

afterEach(() => vi.unstubAllGlobals());

function postResponse(hash: string): Response {
  return new Response(
    JSON.stringify({ id, storedAt: "2026-08-24T12:00:00+00:00", contentSha256: hash }),
    { status: 201, headers: { "Content-Type": "application/json", Location: location } },
  );
}

function getResponse(body: string, hash: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/json", "X-Content-SHA256": hash },
  });
}

describe("선택형 서버 기록", () => {
  it("POST 응답을 검증하고 GET 본문·해시가 보낸 JSON과 같을 때만 성공한다", async () => {
    const hash = await sha256Utf8(serialized);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(postResponse(hash))
      .mockResolvedValueOnce(getResponse(serialized, hash));
    vi.stubGlobal("fetch", fetchMock);

    const saved = await saveExport(serialized);

    expect(saved?.contentSha256).toBe(hash);
    expect(saved && savedExportUrl(saved)).toBe(`http://localhost:8000${location}`);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: serialized,
    });
  });

  it("응답 해시나 저장 후 읽은 본문이 다르면 성공으로 보고하지 않는다", async () => {
    const hash = await sha256Utf8(serialized);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(postResponse("0".repeat(64))));
    await expect(saveExport(serialized)).rejects.toMatchObject({
      name: "ExportSaveError",
      code: "receipt_hash_mismatch",
      stage: "post",
      serverMayHaveStored: true,
      savedRecord: { id },
    });

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(postResponse(hash))
        .mockResolvedValueOnce(getResponse(`${serialized}변조`, hash)),
    );
    await expect(saveExport(serialized)).rejects.toMatchObject({
      code: "verification_body_mismatch",
      stage: "verify",
      serverMayHaveStored: true,
      savedRecord: { id },
    });
  });

  it("형식이 다른 2xx 응답도 저장 성공으로 캐스팅하지 않는다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 201, headers: { Location: "/wrong" } }),
      ),
    );
    await expect(saveExport(serialized)).rejects.toMatchObject({
      code: "invalid_receipt",
      stage: "post",
      serverMayHaveStored: true,
    });
  });

  it("UTF-8 1 MiB 경계는 허용하고 멀티바이트 초과는 요청 전에 거부한다", async () => {
    const exact = "a".repeat(MAX_EXPORT_BYTES);
    const exactHash = await sha256Utf8(exact);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(postResponse(exactHash))
      .mockResolvedValueOnce(getResponse(exact, exactHash));
    vi.stubGlobal("fetch", fetchMock);

    await expect(saveExport(exact)).resolves.toMatchObject({ id });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const unicodeOver = "한".repeat(Math.floor(MAX_EXPORT_BYTES / 3) + 1);
    expect(unicodeOver.length).toBeLessThan(MAX_EXPORT_BYTES);
    expect(new TextEncoder().encode(unicodeOver).byteLength).toBeGreaterThan(MAX_EXPORT_BYTES);
    fetchMock.mockClear();

    await expect(saveExport(unicodeOver)).rejects.toMatchObject({
      code: "payload_too_large",
      stage: "preflight",
      serverMayHaveStored: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("응답하지 않는 POST를 중단하고 저장 여부가 불확실한 timeout 오류를 낸다", async () => {
    const fetchMock = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>(() => {
          expect(init?.signal).toBeInstanceOf(AbortSignal);
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const promise = saveExport(serialized, { requestTimeoutMs: 10 });
    await expect(promise).rejects.toMatchObject({
      code: "post_timeout",
      stage: "post",
      serverMayHaveStored: true,
      savedRecord: null,
    });
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
  });

  it("커밋 영수증 뒤 응답하지 않는 GET을 별도 검증 timeout으로 구분한다", async () => {
    const hash = await sha256Utf8(serialized);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(postResponse(hash))
      .mockImplementationOnce(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>(() => {
            expect(init?.signal).toBeInstanceOf(AbortSignal);
          }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const promise = saveExport(serialized, { requestTimeoutMs: 10 });
    await expect(promise).rejects.toMatchObject({
      code: "verification_timeout",
      stage: "verify",
      serverMayHaveStored: true,
      savedRecord: { id },
    });
    expect((fetchMock.mock.calls[1][1] as RequestInit).signal?.aborted).toBe(true);
  });

  it("거부 응답의 서버 detail을 메시지에 싣고 429·507은 별도 코드로 구분한다", async () => {
    const detail = "project.loopSpec.feedbackMode 값이 허용 목록 밖입니다: everything";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ detail }), {
          status: 422,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    await expect(saveExport(serialized)).rejects.toMatchObject({
      code: "post_rejected",
      stage: "post",
      serverMayHaveStored: false,
      message: `서버가 기록을 거부했습니다(HTTP 422): ${detail}`,
    });

    const limited = "서버 기록이 시간당 30회를 넘었습니다. 잠시 후 다시 시도하거나 JSON 내보내기로 보관해 주세요.";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ detail: limited }), { status: 429 })),
    );
    await expect(saveExport(serialized)).rejects.toMatchObject({
      code: "post_rate_limited",
      serverMayHaveStored: false,
      message: `${limited} (HTTP 429)`,
    });

    const full = "서버 저장 공간이 가득 차 기록할 수 없습니다. 관리자에게 알리고, 지금은 JSON 내보내기로 보관해 주세요.";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ detail: full }), { status: 507 })),
    );
    await expect(saveExport(serialized)).rejects.toMatchObject({
      code: "post_storage_full",
      message: `${full} (HTTP 507)`,
    });

    // detail이 없거나 JSON이 아니어도 상태 코드는 남긴다
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("", { status: 503 })));
    await expect(saveExport(serialized)).rejects.toMatchObject({
      code: "post_rejected",
      message: "서버가 기록을 거부했습니다(HTTP 503).",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response("<html>Bad Gateway</html>", { status: 502 })),
    );
    await expect(saveExport(serialized)).rejects.toMatchObject({
      message: "서버가 기록을 거부했습니다(HTTP 502): Bad Gateway",
    });
  });

  it("JSON이 아닌 거부 본문은 태그를 걷어낸 글만 200자 이내로 싣고, 글이 없으면 상태 코드 문구만 남긴다", async () => {
    const page =
      "<!DOCTYPE html><html><head><title>502 Bad Gateway</title><style>body{color:red}</style>" +
      "<script>alert('x')</script></head><body><center><h1>502 Bad Gateway</h1></center>" +
      `<hr><center>nginx</center><p>${"긴 설명 ".repeat(80)}</p><!-- 주석 --></body></html>`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(page, { status: 502 })));
    const error = await saveExport(serialized).catch((e: unknown) => e as ExportSaveError);
    expect(error).toBeInstanceOf(ExportSaveError);
    const { message } = error as ExportSaveError;
    expect(message.startsWith("서버가 기록을 거부했습니다(HTTP 502): 502 Bad Gateway 502 Bad Gateway nginx 긴 설명")).toBe(true);
    expect(message).not.toMatch(/[<>]/);
    expect(message).not.toContain("alert");
    expect(message).not.toContain("color:red");
    expect(message).not.toContain("주석");
    const detail = message.slice("서버가 기록을 거부했습니다(HTTP 502): ".length);
    expect(detail.length).toBeLessThanOrEqual(REJECTION_EXCERPT_MAX_CHARS);
    expect(detail.endsWith("…")).toBe(true);

    // 태그뿐인 본문은 사유가 없는 것과 같다
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response("<html><body></body></html>", { status: 502 })),
    );
    await expect(saveExport(serialized)).rejects.toMatchObject({
      code: "post_rejected",
      message: "서버가 기록을 거부했습니다(HTTP 502).",
    });
  });

  it("plainTextExcerpt는 엔티티를 풀고 공백을 접으며 상한을 넘기면 말줄임한다", () => {
    expect(plainTextExcerpt("<p>a &amp; b\n\n  &lt;c&gt;</p>", 200)).toBe("a & b <c>");
    expect(plainTextExcerpt("   <br/>  ", 200)).toBeNull();
    expect(plainTextExcerpt("가나다라마", 3)).toBe("가나…");
    expect(plainTextExcerpt("가나다", 3)).toBe("가나다");
  });

  it("명시적 오류 타입은 UI가 메시지와 커밋 가능성을 구분할 수 있다", () => {
    const error = new ExportSaveError("표시할 메시지", "post_network", "post", true);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("표시할 메시지");
    expect(error.serverMayHaveStored).toBe(true);
  });
});
