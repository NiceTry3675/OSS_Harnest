/** 검사관 배터리 진행 상태 — 승인 화면이 아니라 프로젝트에 귀속된다. 화면을 떠났다 돌아와도
 *  같은 다이제스트에 배터리를 다시 시작하지 않고, 진행 중 표시와 결과 수신이 이어진다.
 *  오류도 리포트(forDigest)처럼 다이제스트에 결속된다 — 재컴파일 전 다이제스트의 배터리가 늦게
 *  실패해도 새 다이제스트의 화면에 그 오류가 남지 않는다. */

import type { ExaminerCheckResult } from "@harnest/contracts";

export interface ExaminerBatteryError {
  /** 이 오류를 낸 배터리(또는 준비 단계)의 다이제스트 — 현재 다이제스트와 다르면 화면에 싣지 않는다 */
  forDigest: string;
  message: string;
}

export interface ExaminerBatteryState {
  /** 자동 실행을 시도한 다이제스트 — 같은 다이제스트에는 다시 자동 시작하지 않는다(SPEC §5.2) */
  autoRunDigest: string | null;
  /** 진행 중인 배터리의 다이제스트 — 없으면 null */
  inFlightDigest: string | null;
  progress: string;
  /** 검사 하나가 끝날 때마다 도착하는 결과 — 카드가 즉시 색을 바꾼다 */
  checks: ExaminerCheckResult[];
  /** 전송·형식 오류(판정 결과가 아님) — 수동 재시작으로 지운다 */
  error: ExaminerBatteryError | null;
}

export const idleBattery = (): ExaminerBatteryState => ({
  autoRunDigest: null,
  inFlightDigest: null,
  progress: "",
  checks: [],
  error: null,
});

/** 현재 다이제스트에 결속된 오류 문구만 — 다른 다이제스트의 오류는 없는 것으로 본다 */
export function batteryErrorFor(state: ExaminerBatteryState, digest: string | null): string | null {
  if (state.error === null || digest === null) return null;
  return state.error.forDigest === digest ? state.error.message : null;
}
