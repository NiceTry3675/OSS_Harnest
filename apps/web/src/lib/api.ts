/** 백엔드(FastAPI, :8000) 연동 — 스켈레톤에서는 있으면 기록, 없으면 조용히 건너뛴다.
 *  Lite의 본체는 브라우저다: 서버 없이도 전 흐름이 완결되어야 한다 (SPEC §3 원칙 1). */

const BASE = "http://localhost:8000";

async function tryFetch(path: string, init?: RequestInit): Promise<unknown | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function saveProject(body: unknown): Promise<string | null> {
  const data = (await tryFetch("/projects", { method: "POST", body: JSON.stringify(body) })) as
    | { id: string }
    | null;
  return data?.id ?? null;
}

export async function uploadResult(projectId: string, body: unknown): Promise<boolean> {
  const data = await tryFetch(`/projects/${projectId}/results`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return data !== null;
}
