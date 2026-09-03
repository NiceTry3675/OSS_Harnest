/** 탭 두 개가 같은 프로젝트를 동시에 편집·실행하지 못하게 하는 잠금 — 첫 탭만 쓰기 권한을 갖는다. */

import { describe, expect, it } from "vitest";
import { requestProjectLock, type LockManagerLike } from "./projectLock";

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

describe("requestProjectLock", () => {
  it("첫 탭은 잠금을 얻고 두 번째 탭은 읽기 전용으로 떨어진다", async () => {
    const locks = fakeLockManager();
    await expect(requestProjectLock(locks)).resolves.toBe(true);
    // 첫 잠금은 탭 수명 동안 풀리지 않는다
    await expect(requestProjectLock(locks)).resolves.toBe(false);
    expect(locks.held).toEqual(["harnest-project"]);
  });

  it("Web Locks가 없는 환경(jsdom·구형 브라우저)은 잠금 없이 진행한다", async () => {
    await expect(requestProjectLock(undefined)).resolves.toBe(true);
  });

  it("요청 자체가 실패해도 화면이 멈추지 않는다 — 잠금 없이 진행", async () => {
    const throwing: LockManagerLike = {
      request: () => {
        throw new Error("SecurityError");
      },
    };
    await expect(requestProjectLock(throwing)).resolves.toBe(true);
    const rejecting: LockManagerLike = {
      request: () => Promise.reject(new Error("AbortError")),
    };
    await expect(requestProjectLock(rejecting)).resolves.toBe(true);
  });
});
