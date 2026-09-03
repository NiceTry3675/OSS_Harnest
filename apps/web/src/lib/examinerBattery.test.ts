/** 배터리 오류의 다이제스트 결속 — 재컴파일 전 배터리의 늦은 실패가 새 화면에 남지 않는다. */

import { describe, expect, it } from "vitest";
import { batteryErrorFor, idleBattery } from "./examinerBattery";

const A = "a".repeat(64);
const B = "b".repeat(64);

describe("batteryErrorFor", () => {
  it("오류가 없거나 다이제스트가 없으면 null이다", () => {
    expect(batteryErrorFor(idleBattery(), A)).toBeNull();
    expect(
      batteryErrorFor({ ...idleBattery(), error: { forDigest: A, message: "실패" } }, null),
    ).toBeNull();
  });

  it("오류의 다이제스트가 현재 다이제스트와 같을 때만 문구를 돌려준다", () => {
    const failed = { ...idleBattery(), error: { forDigest: A, message: "HTTP 503" } };
    expect(batteryErrorFor(failed, A)).toBe("HTTP 503");
    // 기준을 고쳐 다이제스트가 B로 바뀐 뒤 A의 배터리가 늦게 실패한 상황 — B의 화면에는 싣지 않는다
    expect(batteryErrorFor(failed, B)).toBeNull();
  });
});
