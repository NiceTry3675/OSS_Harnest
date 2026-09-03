/** Provider 세터의 정체성 회귀 테스트 — 세터가 렌더마다 새로 만들어지면 세터를 의존성에 넣은
 *  화면 effect가 자기 갱신으로 끝없이 재실행된다(관제실 저장본 투영 effect). React 대신 훅의 의미를
 *  그대로 흉내 낸 최소 런타임으로 검증한다: useCallback은 의존성이 같으면 같은 함수를 돌려준다. */

import { afterEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => {
  const states: unknown[] = [];
  const refs: { current: unknown }[] = [];
  const callbacks: { deps: readonly unknown[]; fn: unknown }[] = [];
  let stateAt = 0;
  let refAt = 0;
  let callbackAt = 0;
  let renders = 0;

  const beginRender = () => {
    stateAt = 0;
    refAt = 0;
    callbackAt = 0;
    renders += 1;
  };

  const useState = (initial: unknown) => {
    const at = stateAt++;
    if (states.length <= at) states[at] = typeof initial === "function" ? initial() : initial;
    const setState = (next: unknown) => {
      states[at] =
        typeof next === "function" ? (next as (previous: unknown) => unknown)(states[at]) : next;
    };
    return [states[at], setState] as const;
  };

  const useRef = (initial: unknown) => {
    const at = refAt++;
    if (refs.length <= at) refs[at] = { current: initial };
    return refs[at];
  };

  const useCallback = (fn: unknown, deps: readonly unknown[]) => {
    const at = callbackAt++;
    const previous = callbacks[at];
    const same =
      previous !== undefined &&
      previous.deps.length === deps.length &&
      deps.every((value, index) => Object.is(value, previous.deps[index]));
    if (same) return previous.fn;
    callbacks[at] = { deps, fn };
    return fn;
  };

  const reset = () => {
    states.length = 0;
    refs.length = 0;
    callbacks.length = 0;
    beginRender();
    renders = 0;
  };

  return { beginRender, reset, useState, useRef, useCallback, renderCount: () => renders };
});

vi.mock("react", () => ({
  useState: hooks.useState,
  useRef: hooks.useRef,
  useCallback: hooks.useCallback,
}));

import { useSyncedState } from "./useSyncedState";

function render<T>(initial: () => T) {
  hooks.beginRender();
  return useSyncedState<T>(initial);
}

afterEach(() => hooks.reset());

describe("useSyncedState", () => {
  it("세터는 렌더 사이에 같은 참조다 — effect 의존성에 넣어도 자기 갱신으로 재발화하지 않는다", () => {
    const [, , first] = render<number>(() => 0);
    first(1);
    const [value, , second] = render<number>(() => 0);
    expect(value).toBe(1);
    expect(second).toBe(first);
    second((prev) => prev + 1);
    const [, , third] = render<number>(() => 0);
    expect(third).toBe(first);
  });

  it("ref는 렌더보다 먼저 갱신되고 함수형 갱신은 ref의 최신 값을 받는다 — 같은 틱의 연속 결과가 서로를 덮지 않는다", () => {
    const [, ref, apply] = render<{ a: number | null; b: number | null }>(() => ({ a: null, b: null }));
    // 재렌더 없이 두 결과가 연달아 도착한다
    apply((prev) => ({ ...prev, a: 1 }));
    expect(ref.current).toEqual({ a: 1, b: null });
    apply((prev) => ({ ...prev, b: 2 }));
    expect(ref.current).toEqual({ a: 1, b: 2 });
    const [value] = render<{ a: number | null; b: number | null }>(() => ({ a: null, b: null }));
    expect(value).toEqual({ a: 1, b: 2 });
    expect(hooks.renderCount()).toBe(2);
  });

  it("값 갱신도 ref와 상태에 함께 반영된다", () => {
    const [, ref, apply] = render<string | null>(() => null);
    apply("run-1");
    expect(ref.current).toBe("run-1");
    const [value] = render<string | null>(() => null);
    expect(value).toBe("run-1");
    apply(null);
    expect(ref.current).toBeNull();
  });
});
