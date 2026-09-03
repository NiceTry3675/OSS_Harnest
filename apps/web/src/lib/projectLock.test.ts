/** 탭 두 개가 같은 프로젝트를 동시에 편집·실행하지 못하게 하는 잠금 — 첫 탭만 쓰기 권한을 갖는다. */

import { describe, expect, it, vi } from "vitest";
import {
  PROJECT_LEASE_KEY,
  releaseProjectLease,
  requestProjectLease,
  requestProjectLock,
  requestProjectOwnership,
  type LockManagerLike,
  type StorageLike,
} from "./projectLock";

/** navigator.locks 대역 — ifAvailable 요청을 흉내 낸다. 보유 콜백이 끝나기 전까지는 다른 요청에 null */
function fakeLockManager(): LockManagerLike & { held: string[] } {
  const held: string[] = [];
  return {
    held,
    request(name, _options, callback) {
      if (held.includes(name)) return callback(null);
      held.push(name);
      const holding = callback({ name });
      void holding.finally(() => held.splice(held.indexOf(name), 1));
      return holding;
    },
  };
}

/** 탭들이 공유하는 localStorage 대역 */
function fakeStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

/** 수동 시계 — 갱신 타이머와 되읽기 대기를 테스트가 직접 진행시킨다 */
function manualClock() {
  let t = 1_000;
  const timers: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    wait: async () => {},
    schedule: (fn: () => void, ms: number) => {
      const timer = { fn, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    /** 살아 있는 갱신 타이머를 한 번씩 돌린다 */
    tick: () => {
      for (const timer of timers) if (!timer.cancelled) timer.fn();
    },
    active: () => timers.filter((timer) => !timer.cancelled).length,
  };
}

describe("requestProjectLock", () => {
  it("첫 탭은 잠금을 얻고 두 번째 탭은 읽기 전용으로 떨어진다", async () => {
    const locks = fakeLockManager();
    await expect(requestProjectLock(locks)).resolves.toBe(true);
    // 첫 잠금은 탭 수명 동안 풀리지 않는다
    await expect(requestProjectLock(locks)).resolves.toBe(false);
    expect(locks.held).toEqual(["harnest-project"]);
  });

  it("Web Locks가 없거나 요청 자체가 실패하면 null — 다른 수단(임대)이 필요하다", async () => {
    await expect(requestProjectLock(undefined)).resolves.toBeNull();
    const throwing: LockManagerLike = {
      request: () => {
        throw new Error("SecurityError");
      },
    };
    await expect(requestProjectLock(throwing)).resolves.toBeNull();
    const rejecting: LockManagerLike = {
      request: () => Promise.reject(new Error("AbortError")),
    };
    await expect(requestProjectLock(rejecting)).resolves.toBeNull();
  });
});

describe("requestProjectLease — Web Locks가 없는 환경의 localStorage 임대", () => {
  it("첫 탭은 임대를 얻고, 유효한 임대가 있는 동안 두 번째 탭은 읽기 전용이다", async () => {
    const storage = fakeStorage();
    const clock = manualClock();
    await expect(
      requestProjectLease(storage, { tabId: "A", ...clock }),
    ).resolves.toBe(true);
    await expect(
      requestProjectLease(storage, { tabId: "B", ...clock }),
    ).resolves.toBe(false);
    expect(JSON.parse(storage.data.get(PROJECT_LEASE_KEY)!)).toEqual({
      tabId: "A",
      expiresAt: 16_000,
    });
  });

  it("소유 탭이 갱신을 멈추고 만료되면 다른 탭이 가져가고, 돌아온 소유 탭은 잃은 것을 안다", async () => {
    const storage = fakeStorage();
    const clock = manualClock();
    const lost = vi.fn();
    await requestProjectLease(storage, { tabId: "A", onLost: lost, ...clock });
    // A가 갱신하는 동안(5초마다)은 B가 못 가져간다
    clock.advance(5_000);
    clock.tick();
    clock.advance(5_000);
    await expect(requestProjectLease(storage, { tabId: "B", ...clock })).resolves.toBe(false);
    // A가 멈춘 채 만료(15초)를 넘기면 B가 가져간다
    clock.advance(20_000);
    await expect(requestProjectLease(storage, { tabId: "B", ...clock })).resolves.toBe(true);
    expect(lost).not.toHaveBeenCalled();
    // A의 다음 갱신은 B의 임대를 보고 소유권 상실을 알린다 — 그 뒤로는 갱신 타이머도 멈춘다
    clock.tick();
    expect(lost).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.data.get(PROJECT_LEASE_KEY)!).tabId).toBe("B");
    clock.tick();
    expect(lost).toHaveBeenCalledTimes(1);
    expect(clock.active()).toBe(1); // B의 갱신만 남는다
  });

  it("같은 순간에 두 탭이 임대를 쓰면 되읽기에서 밀린 쪽만 읽기 전용이 된다", async () => {
    const storage = fakeStorage();
    const clock = manualClock();
    // A가 쓴 직후(되읽기 전) B가 덮어쓴 상황 — wait 안에서 B가 끼어든다
    const a = requestProjectLease(storage, {
      tabId: "A",
      ...clock,
      wait: async () => {
        storage.setItem(PROJECT_LEASE_KEY, JSON.stringify({ tabId: "B", expiresAt: 99_000 }));
      },
    });
    await expect(a).resolves.toBe(false);
  });

  it("탭을 떠날 때는 자기 임대만 지운다", () => {
    const storage = fakeStorage();
    storage.setItem(PROJECT_LEASE_KEY, JSON.stringify({ tabId: "B", expiresAt: 99_000 }));
    releaseProjectLease(storage, "A");
    expect(storage.data.has(PROJECT_LEASE_KEY)).toBe(true);
    releaseProjectLease(storage, "B");
    expect(storage.data.has(PROJECT_LEASE_KEY)).toBe(false);
  });

  it("저장소가 없거나 쓸 수 없으면 조정할 수단이 없으므로 잠금 없이 진행한다", async () => {
    await expect(requestProjectLease(undefined, { tabId: "A" })).resolves.toBe(true);
    const blocked: StorageLike = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    await expect(requestProjectLease(blocked, { tabId: "A", settleMs: 0 })).resolves.toBe(true);
  });
});

describe("requestProjectOwnership", () => {
  it("Web Locks가 있으면 그 결과를 쓰고 임대는 건드리지 않는다", async () => {
    const storage = fakeStorage();
    const locks = fakeLockManager();
    await expect(requestProjectOwnership(locks, storage, { tabId: "A" })).resolves.toBe(true);
    await expect(requestProjectOwnership(locks, storage, { tabId: "B" })).resolves.toBe(false);
    expect(storage.data.size).toBe(0);
  });

  it("Web Locks가 없으면(비보안 컨텍스트 등) 임대로 대신한다 — 모든 탭이 소유자가 되지 않는다", async () => {
    const storage = fakeStorage();
    const clock = manualClock();
    await expect(
      requestProjectOwnership(undefined, storage, { tabId: "A", ...clock }),
    ).resolves.toBe(true);
    await expect(
      requestProjectOwnership(undefined, storage, { tabId: "B", ...clock }),
    ).resolves.toBe(false);
  });
});
