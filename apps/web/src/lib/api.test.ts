import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ExportSaveError,
  MAX_EXPORT_BYTES,
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

  it("명시적 오류 타입은 UI가 메시지와 커밋 가능성을 구분할 수 있다", () => {
    const error = new ExportSaveError("표시할 메시지", "post_network", "post", true);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("표시할 메시지");
    expect(error.serverMayHaveStored).toBe(true);
  });
});
