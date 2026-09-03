/** 프로젝트 쓰기 잠금 — 같은 브라우저의 탭 두 개가 단일 키 스냅샷('current')과 체크포인트를
 *  번갈아 덮어쓰지 않게 한다. Web Locks(navigator.locks)는 탭이 닫히면 자동 해제되므로 별도
 *  해제 로직이 없다. 잠금을 얻지 못한 탭은 읽기 전용으로 동작한다(저장·시작·재개·승인 차단).
 *  잠금은 소유 탭이 닫혀도 이 탭에 자동으로 넘어오지 않는다 — 이어서 쓰려면 새로고침해야 하며,
 *  화면 안내가 그 경로를 알린다.
 *  미지원 환경(구형 브라우저·비보안 컨텍스트·jsdom)은 잠금 없이 진행한다 — 이때 덮어쓰기는
 *  스냅샷 저장소의 판 번호 비교(IndexedDbProjectStore, SnapshotConflictError)가 막고, 늦게
 *  저장한 탭이 읽기 전용으로 물러난다. */

export const PROJECT_LOCK_NAME = "harnest-project";

/** navigator.locks의 최소 형태 — 테스트 대역을 끼우기 위한 좁은 타입 */
export interface LockManagerLike {
  request(
    name: string,
    options: { ifAvailable: true },
    callback: (lock: unknown) => Promise<unknown>,
  ): Promise<unknown>;
}

/** 잠금을 시도한다. 얻으면 true(탭 수명 동안 보유), 다른 탭이 쥐고 있으면 false,
 *  미지원(undefined)이거나 요청 자체가 실패하면 true(잠금 없이 진행). */
export function requestProjectLock(
  locks: LockManagerLike | undefined,
  name: string = PROJECT_LOCK_NAME,
): Promise<boolean> {
  if (locks === undefined) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (owned: boolean): void => {
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
        .catch(() => done(true));
    } catch {
      done(true);
    }
  });
}

let acquisition: Promise<boolean> | null = null;

/** 페이지당 한 번만 요청한다 — StrictMode의 이중 이펙트나 Provider 재마운트가 자기 잠금에
 *  걸려 읽기 전용으로 떨어지지 않게 한다. */
export function acquireProjectLock(): Promise<boolean> {
  if (acquisition === null) {
    const locks =
      typeof navigator === "undefined"
        ? undefined
        : (navigator as { locks?: LockManagerLike }).locks;
    acquisition = requestProjectLock(locks);
  }
  return acquisition;
}
