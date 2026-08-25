import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => {
  type Cleanup = () => void;
  type Effect = () => void | Cleanup;
  type EffectSlot = { deps?: readonly unknown[]; cleanup?: Cleanup };
  type RefSlot = { current: unknown };

  const states: unknown[] = [];
  const refs: RefSlot[] = [];
  const effects: EffectSlot[] = [];
  let stateAt = 0;
  let refAt = 0;
  let effectAt = 0;

  const beginRender = () => {
    stateAt = 0;
    refAt = 0;
    effectAt = 0;
  };

  const useState = (initial: unknown) => {
    const at = stateAt++;
    if (states.length <= at) states[at] = initial;
    const setState = (next: unknown) => {
      states[at] = typeof next === "function"
        ? (next as (previous: unknown) => unknown)(states[at])
        : next;
    };
    return [states[at], setState] as const;
  };

  const useRef = (initial: unknown) => {
    const at = refAt++;
    if (refs.length <= at) refs[at] = { current: initial };
    return refs[at];
  };

  const useEffect = (effect: Effect, deps?: readonly unknown[]) => {
    const at = effectAt++;
    const previous = effects[at];
    const changed =
      !previous ||
      deps === undefined ||
      previous.deps === undefined ||
      deps.length !== previous.deps.length ||
      deps.some((value, index) => !Object.is(value, previous.deps?.[index]));
    if (!changed) return;
    previous?.cleanup?.();
    const cleanup = effect();
    effects[at] = {
      deps,
      cleanup: typeof cleanup === "function" ? cleanup : undefined,
    };
  };

  const reset = () => {
    effects.forEach((effect) => effect.cleanup?.());
    states.length = 0;
    refs.length = 0;
    effects.length = 0;
    beginRender();
  };

  return { beginRender, reset, useEffect, useRef, useState };
});

vi.mock("react", () => ({
  useEffect: hooks.useEffect,
  useRef: hooks.useRef,
  useState: hooks.useState,
}));

import { useCountUp } from "./useCountUp";

let now = 0;
let nextFrameId = 1;
let frames = new Map<number, FrameRequestCallback>();

function render(target: number | null, durationMs = 900): number | null {
  hooks.beginRender();
  return useCountUp(target, durationMs);
}

function runFrame(at: number): void {
  now = at;
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((callback) => callback(at));
}

beforeEach(() => {
  hooks.reset();
  now = 0;
  nextFrameId = 1;
  frames = new Map();
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    }),
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    vi.fn((id: number) => {
      frames.delete(id);
    }),
  );
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  );
});

afterEach(() => {
  hooks.reset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useCountUp", () => {
  it("빠르게 목표가 바뀌면 현재 표시값에서 새 목표로 이어 간다", () => {
    expect(render(10)).toBe(10);
    render(20);
    runFrame(450);
    expect(render(20)).toBeCloseTo(18.75);

    render(30);
    runFrame(900);
    expect(render(30)).toBeCloseTo(28.59375);
  });

  it("reduced-motion에서는 애니메이션 프레임 없이 목표값을 즉시 표시한다", () => {
    vi.mocked(matchMedia).mockReturnValue({ matches: true } as MediaQueryList);

    expect(render(10)).toBe(10);
    render(20);
    expect(render(20)).toBe(20);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
});
