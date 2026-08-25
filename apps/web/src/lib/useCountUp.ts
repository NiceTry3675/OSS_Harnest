import { useEffect, useRef, useState } from "react";

/** 목표값이 바뀌면 현재 표시값에서 그 값까지 굴려 올린다.
 *  점수가 화면의 주인공이므로, 바뀌는 순간이 눈에 보여야 한다(PHILOSOPHY §5).
 *
 *  target이 null이면 애니메이션 없이 null을 그대로 돌려준다(아직 값이 없는 상태). */
export function useCountUp(target: number | null, durationMs = 900): number | null {
  const [shown, setShown] = useState<number | null>(target);
  const shownRef = useRef<number | null>(target);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    if (target === null) {
      shownRef.current = null;
      setShown(null);
      return;
    }

    // 접근성 설정에서 모션을 줄이도록 했다면 즉시 반영한다
    const reduced =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    const from = shownRef.current ?? target;
    if (reduced || from === target || durationMs <= 0) {
      shownRef.current = target;
      setShown(target);
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // easeOutCubic — 빠르게 올라갔다가 목표값에서 부드럽게 멈춘다
      const eased = 1 - Math.pow(1 - t, 3);
      const next = from + (target - from) * eased;
      shownRef.current = next;
      setShown(next);
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      }
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [target, durationMs]);

  // 애니메이션이 한 번도 돌지 못한 경우에도 값은 보여야 한다.
  // 점수가 "—"로 남는 것은 실행이 실패한 것처럼 읽히므로 표시를 우선한다.
  return shown ?? target;
}
