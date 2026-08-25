/** 지금 흐름의 몇 번째 칸에 있는지 — 상단 단계 표시가 읽는 값.
 *
 *  단계는 화면(라우트)보다 잘게 나뉜다. 입력 화면 하나가 자료·질문·모델 세 칸이고,
 *  승인 화면 하나가 검증·잠금 두 칸이다. 라우트만으로는 알 수 없으므로
 *  각 화면이 자기 칸을 여기에 알린다. */

import { useSyncExternalStore } from "react";

export const FLOW_STEPS = [
  "자료",
  "질문",
  "모델",
  "검증",
  "잠금",
  "실행",
  "결과",
] as const;

/** -1 = 흐름 밖(홈) */
let current = -1;
const listeners = new Set<() => void>();

export function setFlowStep(step: number): void {
  if (current === step) return;
  current = step;
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useFlowStep(): number {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => -1,
  );
}
