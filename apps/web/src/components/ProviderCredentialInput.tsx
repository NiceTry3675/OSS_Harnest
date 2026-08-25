import type { ChangeEvent } from "react";
import {
  parseVertexServiceAccount,
  PROVIDER_LABEL,
  type CredentialProvider,
} from "../lib/llm";

interface ProviderCredentialInputProps {
  provider: CredentialProvider;
  value: string;
  storedCredential?: string | null;
  sharedAvailable?: boolean;
  idPrefix: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onDelete: () => void;
  onError?: (message: string) => void;
}

function vertexSummary(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const credential = parseVertexServiceAccount(raw);
    return `${credential.client_email} · ${credential.project_id}`;
  } catch {
    return "저장된 서비스 계정 JSON이 유효하지 않습니다.";
  }
}

export function ProviderCredentialInput({
  provider,
  value,
  storedCredential,
  sharedAvailable = false,
  idPrefix,
  disabled = false,
  onChange,
  onDelete,
  onError,
}: ProviderCredentialInputProps) {
  const stored = storedCredential?.trim() ? storedCredential : null;

  if (provider !== "vertex") {
    return (
      <div style={{ display: "grid", gap: 8 }}>
        <input
          id={`${idPrefix}-credential`}
          type="password"
          value={value}
          disabled={disabled}
          placeholder={`${PROVIDER_LABEL[provider]} API 키${sharedAvailable ? " (선택 — 비우면 관리자 공유 키 사용)" : ""}`}
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
        />
        {value.trim() ? (
          <button type="button" disabled={disabled} onClick={onDelete} style={{ width: "fit-content" }}>
            저장된 API 키 삭제
          </button>
        ) : null}
      </div>
    );
  }

  const draftSummary = vertexSummary(value.trim() || null);
  const storedSummary = vertexSummary(stored);
  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      parseVertexServiceAccount(text);
      onChange(text);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "서비스 계정 JSON 파일을 읽지 못했습니다.");
    }
  };

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {stored ? (
        <div className="hint" style={{ margin: 0 }}>
          저장된 서비스 계정: <strong>{storedSummary}</strong>
        </div>
      ) : null}
      <textarea
        id={`${idPrefix}-credential`}
        rows={5}
        value={value}
        disabled={disabled}
        placeholder={stored ? "새 서비스 계정 JSON을 붙여넣어 교체" : "서비스 계정 JSON 붙여넣기"}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
      <input
        type="file"
        accept="application/json,.json"
        disabled={disabled}
        style={{ width: "auto" }}
        onChange={(event) => void onFile(event)}
      />
      {value.trim() ? (
        <div className={draftSummary?.startsWith("저장된") ? "error" : "hint"} style={{ margin: 0 }}>
          {draftSummary ?? "서비스 계정 JSON을 확인해 주세요."}
        </div>
      ) : null}
      {stored ? (
        <button type="button" disabled={disabled} onClick={onDelete} style={{ width: "fit-content" }}>
          저장된 서비스 계정 즉시 삭제
        </button>
      ) : null}
      <div className="hint" style={{ margin: 0 }}>
        private key는 이 브라우저의 localStorage에 남아 페이지 스크립트가 접근할 수 있습니다.
        Vertex AI 전용 최소 권한 계정을 사용하고, 사용 후 삭제하세요.
      </div>
    </div>
  );
}
