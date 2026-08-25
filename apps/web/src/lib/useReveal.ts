import { useEffect, useRef } from "react";

/** 화면에 들어올 때 한 번 떠오르게 한다.
 *  요소에 className="reveal"을 주고 이 ref를 붙이면, 보이는 순간 is-in이 붙는다.
 *  한 번 나타난 요소는 다시 숨기지 않는다 — 스크롤을 되돌릴 때 깜빡이면 산만하다. */
export function useReveal<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduced =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof IntersectionObserver === "undefined") {
      el.classList.add("is-in");
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return ref;
}
