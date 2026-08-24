/** 선택형 백엔드(FastAPI, :8000) 연동 — 서버 없이도 전 흐름이 완결되어야 한다. */

const BASE = "http://localhost:8000";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
export const MAX_EXPORT_BYTES = 1024 * 1024;
export const DEFAULT_EXPORT_REQUEST_TIMEOUT_MS = 10_000;

export interface SavedExport {
  id: string;
  storedAt: string;
  contentSha256: string;
  location: string;
}

export type ExportSaveStage = "preflight" | "post" | "verify";

export type ExportSaveErrorCode =
  | "payload_too_large"
  | "post_timeout"
  | "post_network"
  | "post_rejected"
  | "invalid_receipt"
  | "receipt_hash_mismatch"
  | "verification_timeout"
  | "verification_network"
  | "verification_rejected"
  | "verification_hash_mismatch"
  | "verification_body_mismatch";

/**
 * 저장 실패를 사용자에게 설명할 수 있는 오류. `serverMayHaveStored`가 true면 재시도 전에
 * `savedRecord` 조회나 서버 상태 확인이 필요하다. 같은 본문을 다시 POST하면 중복 행이 생길 수 있다.
 */
export class ExportSaveError extends Error {
  constructor(
    message: string,
    readonly code: ExportSaveErrorCode,
    readonly stage: ExportSaveStage,
    readonly serverMayHaveStored: boolean,
    readonly savedRecord: SavedExport | null = null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ExportSaveError";
  }
}

export interface SaveExportOptions {
  /** POST와 GET 각각에 적용되는 제한 시간. */
  requestTimeoutMs?: number;
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  // SharedArrayBuffer 가능성을 제거해 Web Crypto가 요구하는 ArrayBuffer를 넘긴다.
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  const hash = await crypto.subtle.digest("SHA-256", copy);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Utf8(value: string): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(value));
}

function savedExportResponse(value: unknown, location: string | null): SavedExport | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    !UUID_RE.test(record.id) ||
    typeof record.storedAt !== "string" ||
    Number.isNaN(Date.parse(record.storedAt)) ||
    typeof record.contentSha256 !== "string" ||
    !SHA256_RE.test(record.contentSha256) ||
    location !== `/exports/${record.id}`
  ) {
    return null;
  }
  return {
    id: record.id,
    storedAt: record.storedAt,
    contentSha256: record.contentSha256,
    location,
  };
}

export function savedExportUrl(record: SavedExport): string {
  return `${BASE}${record.location}`;
}

function timeoutMs(options: SaveExportOptions): number {
  const value = options.requestTimeoutMs ?? DEFAULT_EXPORT_REQUEST_TIMEOUT_MS;
  return Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : DEFAULT_EXPORT_REQUEST_TIMEOUT_MS;
}

async function withRequestTimeout<T>(
  stage: "post" | "verify",
  durationMs: number,
  savedRecord: SavedExport | null,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutCode: ExportSaveErrorCode =
    stage === "post" ? "post_timeout" : "verification_timeout";
  const timeoutMessage =
    stage === "post"
      ? "서버 기록 요청 시간이 초과되었습니다. 서버에는 이미 저장되었을 수 있습니다."
      : "서버 저장 후 확인 요청 시간이 초과되었습니다. 기록은 이미 저장되었을 수 있습니다.";
  const timeoutError = new ExportSaveError(
    timeoutMessage,
    timeoutCode,
    stage,
    true,
    savedRecord,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(timeoutError);
    }, durationMs);
  });

  try {
    return await Promise.race([operation(controller.signal), deadline]);
  } catch (error) {
    if (timedOut || error === timeoutError) throw timeoutError;
    if (error instanceof ExportSaveError) throw error;
    throw new ExportSaveError(
      stage === "post"
        ? "서버 기록 요청을 완료하지 못했습니다. 서버에는 이미 저장되었을 수 있습니다."
        : "서버 저장 후 기록을 다시 읽지 못했습니다. 기록은 이미 저장되었을 수 있습니다.",
      stage === "post" ? "post_network" : "verification_network",
      stage,
      true,
      savedRecord,
      { cause: error },
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** 같은 JSON 바이트를 저장한 뒤 GET으로 다시 읽어 해시와 본문을 모두 확인한다. */
export async function saveExport(
  serialized: string,
  options: SaveExportOptions = {},
): Promise<SavedExport> {
  const bytes = new TextEncoder().encode(serialized);
  if (bytes.byteLength > MAX_EXPORT_BYTES) {
    throw new ExportSaveError(
      "서버 기록은 UTF-8 기준 1 MiB를 넘을 수 없습니다. JSON 파일 내보내기는 계속 사용할 수 있습니다.",
      "payload_too_large",
      "preflight",
      false,
    );
  }
  const expectedHash = await sha256Bytes(bytes);
  const durationMs = timeoutMs(options);

  const post = await withRequestTimeout(
    "post",
    durationMs,
    null,
    async (signal) => {
      const response = await fetch(`${BASE}/exports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: serialized,
        signal,
      });
      if (response.status !== 201) return { response, receipt: null as unknown };
      try {
        return { response, receipt: (await response.json()) as unknown };
      } catch (error) {
        throw new ExportSaveError(
          "서버가 저장 영수증을 올바른 JSON으로 반환하지 않았습니다. 서버에는 이미 저장되었을 수 있습니다.",
          "invalid_receipt",
          "post",
          true,
          null,
          { cause: error },
        );
      }
    },
  );

  if (post.response.status !== 201) {
    throw new ExportSaveError(
      `서버가 기록을 거부했습니다(HTTP ${post.response.status}).`,
      "post_rejected",
      "post",
      false,
    );
  }
  const saved = savedExportResponse(post.receipt, post.response.headers.get("Location"));
  if (saved === null) {
    throw new ExportSaveError(
      "서버가 저장 영수증을 올바른 형식으로 반환하지 않았습니다. 서버에는 이미 저장되었을 수 있습니다.",
      "invalid_receipt",
      "post",
      true,
    );
  }
  if (saved.contentSha256 !== expectedHash) {
    throw new ExportSaveError(
      "서버 영수증의 SHA-256이 전송한 JSON과 다릅니다. 서버에는 이미 저장되었을 수 있습니다.",
      "receipt_hash_mismatch",
      "post",
      true,
      saved,
    );
  }

  const verification = await withRequestTimeout(
    "verify",
    durationMs,
    saved,
    async (signal) => {
      const response = await fetch(`${BASE}${saved.location}`, { signal });
      return { response, body: response.ok ? await response.text() : null };
    },
  );
  if (!verification.response.ok) {
    throw new ExportSaveError(
      `서버가 기록했지만 다시 읽어 확인하지 못했습니다(HTTP ${verification.response.status}).`,
      "verification_rejected",
      "verify",
      true,
      saved,
    );
  }
  if (verification.response.headers.get("X-Content-SHA256") !== expectedHash) {
    throw new ExportSaveError(
      "서버에서 다시 읽은 기록의 SHA-256이 전송한 JSON과 다릅니다.",
      "verification_hash_mismatch",
      "verify",
      true,
      saved,
    );
  }
  if (verification.body !== serialized) {
    throw new ExportSaveError(
      "서버에서 다시 읽은 JSON 본문이 전송한 기록과 다릅니다.",
      "verification_body_mismatch",
      "verify",
      true,
      saved,
    );
  }
  return saved;
}
