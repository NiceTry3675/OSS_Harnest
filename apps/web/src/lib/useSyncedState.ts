/** useState에 동기 ref를 붙인 상태 — 비동기 통지(엔진·홀드아웃·배터리)가 렌더보다 먼저 최신 값을
 *  읽어야 하는 Provider 상태용.
 *
 *  세터는 마운트 동안 정체성이 바뀌지 않는다(빈 의존성 useCallback — 닫는 것이 ref와 useState
 *  세터뿐이라 안전하다). 이 보장이 없으면 세터를 의존성에 넣은 화면 effect가 "세터 호출 → Provider
 *  재렌더 → 새 세터 → effect 재실행 → 세터 호출"로 끝없이 돈다. 함수형 갱신은 ref의 최신 값을
 *  받으므로 같은 틱에 연달아 도착한 결과도 서로를 덮어쓰지 않는다. */

import { useCallback, useRef, useState, type MutableRefObject } from "react";

export type SyncedUpdate<T> = T | ((prev: T) => T);

export function useSyncedState<T>(
  initial: () => T,
): [T, MutableRefObject<T>, (next: SyncedUpdate<T>) => void] {
  const [value, setValue] = useState<T>(initial);
  const ref = useRef<T>(value);
  const apply = useCallback((next: SyncedUpdate<T>): void => {
    const resolved =
      typeof next === "function" ? (next as (prev: T) => T)(ref.current) : next;
    ref.current = resolved;
    setValue(resolved);
  }, []);
  return [value, ref, apply];
}
