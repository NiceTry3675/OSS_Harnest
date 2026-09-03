/** 프로젝트 쓰기 잠금 — 같은 브라우저의 탭 두 개가 단일 키 스냅샷('current')과 체크포인트를
 *  번갈아 덮어쓰거나, 같은 일시정지 실행을 동시에 재개해 모델 호출을 겹치지 않게 한다.
 *  잠금을 얻지 못한 탭은 읽기 전용으로 동작한다(저장·시작·재개·승인 차단).
 *
 *  1순위는 Web Locks(navigator.locks)다 — 탭이 닫히면 자동 해제되므로 별도 해제 로직이 없고,
 *  잠금은 소유 탭이 닫혀도 이 탭에 자동으로 넘어오지 않는다(이어서 쓰려면 새로고침).
 *  Web Locks가 없는 환경(비보안 컨텍스트 http://, 구형 브라우저, jsdom)이나 요청 자체가 실패한
 *  경우는 localStorage 임대(lease)로 대신한다: 탭 ID와 만료 시각을 적고, 짧게 기다린 뒤 되읽어
 *  같은 순간 쓴 다른 탭에 밀렸는지 확인하며, 주기적으로 갱신한다. 갱신 중 다른 탭의 임대가 보이면
 *  소유권을 잃은 것으로 보고 onLost로 읽기 전용 전환을 요청한다. 체크포인트 저장소에는 판 번호
 *  비교가 없어, 잠금 없이 두 탭이 모두 소유자가 되면 같은 runId를 동시에 재개할 수 있기 때문이다.
 *  localStorage조차 없으면(저장 차단 등) 조정할 수단이 없으므로 잠금 없이 진행한다 — 이때
 *  스냅샷 덮어쓰기는 저장소의 판 번호 비교(SnapshotConflictError)가 마지막으로 막는다. */

export const PROJECT_LOCK_NAME = "harnest-project";
export const PROJECT_LEASE_KEY = "harnest.project.lease";
/** 임대 만료 — 소유 탭이 갱신 없이 이 시간이 지나면(닫힘·정지) 다른 탭이 가져갈 수 있다 */
export const LEASE_TTL_MS = 15_000;
export const LEASE_RENEW_MS = 5_000;
/** 쓰고 되읽기까지 기다리는 시간 — 같은 순간 임대를 쓴 두 탭 중 한쪽만 소유자가 되게 한다 */
export const LEASE_SETTLE_MS = 100;

/** navigator.locks의 최소 형태 — 테스트 대역을 끼우기 위한 좁은 타입 */
export interface LockManagerLike {
  request(
    name: string,
    options: { ifAvailable: true },
    callback: (lock: unknown) => Promise<unknown>,
  ): Promise<unknown>;
}

/** localStorage의 최소 형태 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Web Locks를 시도한다. 얻으면 true(탭 수명 동안 보유), 다른 탭이 쥐고 있으면 false,
 *  미지원(undefined)이거나 요청 자체가 실패하면 null(다른 수단이 필요). */
export function requestProjectLock(
  locks: LockManagerLike | undefined,
  name: string = PROJECT_LOCK_NAME,
): Promise<boolean | null> {
  if (locks === undefined) return Promise.resolve(null);
  return new Promise<boolean | null>((resolve) => {
    let settled = false;
    const done = (owned: boolean | null): void => {
      if (settled) return;
      settled = true;
      resolve(owned);
    };
    try {
      locks
        .request(name, { ifAvailable: true }, (lock) => {
          if (lock === null || lock === undefined) {
            done(false);
            return Promise.resolve();
          }
          done(true);
          // 콜백이 끝나면 잠금이 풀린다 — 탭이 닫힐 때까지 끝나지 않는 Promise로 붙든다
          return new Promise<never>(() => {});
        })
        .catch(() => done(null));
    } catch {
      done(null);
    }
  });
}

interface LeaseRecord {
  tabId: string;
  expiresAt: number;
}

export interface LeaseOptions {
  tabId: string;
  key?: string;
  now?: () => number;
  ttlMs?: number;
  renewMs?: number;
  settleMs?: number;
  /** 갱신 중 다른 탭의 임대가 보였을 때 — 이 탭은 더 이상 소유자가 아니다 */
  onLost?: () => void;
  /** 갱신 타이머 — 테스트에서 바꿔 끼운다. 반환값은 해제 함수 */
  schedule?: (fn: () => void, ms: number) => () => void;
  wait?: (ms: number) => Promise<void>;
}

function readLease(storage: StorageLike, key: string): LeaseRecord | null {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    const tabId = (parsed as { tabId?: unknown }).tabId;
    const expiresAt = (parsed as { expiresAt?: unknown }).expiresAt;
    if (typeof tabId !== "string" || typeof expiresAt !== "number") return null;
    return { tabId, expiresAt };
  } catch {
    return null;
  }
}

function writeLease(storage: StorageLike, key: string, record: LeaseRecord): boolean {
  try {
    storage.setItem(key, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

/** localStorage 임대를 시도한다. 얻으면 true(주기적으로 갱신), 다른 탭의 유효한 임대가 있거나
 *  같은 순간의 경합에서 밀리면 false, 저장소가 없거나 쓸 수 없으면 true(조정 수단 없음). */
export async function requestProjectLease(
  storage: StorageLike | undefined,
  options: LeaseOptions,
): Promise<boolean> {
  if (storage === undefined) return true;
  const key = options.key ?? PROJECT_LEASE_KEY;
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? LEASE_TTL_MS;
  const renewMs = options.renewMs ?? LEASE_RENEW_MS;
  const settleMs = options.settleMs ?? LEASE_SETTLE_MS;
  const wait = options.wait ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const schedule =
    options.schedule ??
    ((fn, ms) => {
      const id = setInterval(fn, ms);
      return () => clearInterval(id);
    });
  const mine = (record: LeaseRecord | null): boolean => record?.tabId === options.tabId;

  const existing = readLease(storage, key);
  if (existing !== null && !mine(existing) && existing.expiresAt > now()) return false;
  if (!writeLease(storage, key, { tabId: options.tabId, expiresAt: now() + ttlMs })) return true;
  // 되읽기 — 같은 순간 다른 탭도 썼다면 마지막에 쓴 쪽만 남는다. 밀린 쪽은 읽기 전용이다
  await wait(settleMs);
  if (!mine(readLease(storage, key))) return false;

  let stop: (() => void) | null = null;
  stop = schedule(() => {
    const current = readLease(storage, key);
    if (current !== null && !mine(current)) {
      // 만료를 보고 다른 탭이 가져갔다(이 탭이 오래 멈춰 있었다) — 소유권을 잃었다
      stop?.();
      options.onLost?.();
      return;
    }
    writeLease(storage, key, { tabId: options.tabId, expiresAt: now() + ttlMs });
  }, renewMs);
  return true;
}

/** 탭을 떠날 때 자기 임대만 지운다 — 다음 탭이 만료(15초)를 기다리지 않게 */
export function releaseProjectLease(
  storage: StorageLike | undefined,
  tabId: string,
  key: string = PROJECT_LEASE_KEY,
): void {
  if (storage === undefined) return;
  try {
    if (readLease(storage, key)?.tabId === tabId) storage.removeItem(key);
  } catch {
    /* 저장소 접근 불가 — 만료로 풀린다 */
  }
}

/** Web Locks를 먼저, 안 되면 localStorage 임대를 시도한다. 둘 다 없으면 잠금 없이 진행(true). */
export async function requestProjectOwnership(
  locks: LockManagerLike | undefined,
  storage: StorageLike | undefined,
  options: LeaseOptions,
): Promise<boolean> {
  const locked = await requestProjectLock(locks);
  if (locked !== null) return locked;
  return requestProjectLease(storage, options);
}

function newTabId(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c !== undefined && typeof c.randomUUID === "function") return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function browserStorage(): StorageLike | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

let acquisition: Promise<boolean> | null = null;

/** 페이지당 한 번만 요청한다 — StrictMode의 이중 이펙트나 Provider 재마운트가 자기 잠금에
 *  걸려 읽기 전용으로 떨어지지 않게 한다. onLost는 첫 호출의 것만 쓴다(임대 경로에서만 불린다). */
export function acquireProjectLock(onLost?: () => void): Promise<boolean> {
  if (acquisition === null) {
    const locks =
      typeof navigator === "undefined"
        ? undefined
        : (navigator as { locks?: LockManagerLike }).locks;
    const storage = browserStorage();
    const tabId = newTabId();
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", () => releaseProjectLease(storage, tabId));
    }
    acquisition = requestProjectOwnership(locks, storage, { tabId, onLost });
  }
  return acquisition;
}
