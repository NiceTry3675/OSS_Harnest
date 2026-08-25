/** 승인 직후의 봉인 연출 — 기준이 잠겼다는 것을 눈에 보이게 한다.
 *
 *  자물쇠가 닫히고, 동결 다이제스트가 한 글자씩 찍힌다. 다이제스트는 이 기준이
 *  무엇인지 가리키는 값이므로 연출이 끝나면 반드시 전체가 그대로 남아야 한다. */

import { useEffect, useState } from "react";

export function SealPanel({ digest, children }: { digest: string; children: React.ReactNode }) {
  const [shut, setShut] = useState(false);
  const [typed, setTyped] = useState(0);

  useEffect(() => {
    const reduced =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setShut(true);
      setTyped(digest.length);
      return;
    }
    setShut(false);
    setTyped(0);
    const a = setTimeout(() => setShut(true), 320);
    const b = setTimeout(() => {
      const step = setInterval(() => {
        setTyped((n) => {
          if (n >= digest.length) {
            clearInterval(step);
            return n;
          }
          return n + 2;
        });
      }, 22);
    }, 700);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [digest]);

  const shown = digest.slice(0, Math.min(typed, digest.length));
  const rest = "·".repeat(Math.max(0, digest.length - typed));

  return (
    <div className="seal">
      <div className={`seal-lock${shut ? " is-shut" : ""}`} aria-hidden="true">
        <span className="seal-ring" />
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path className="seal-shackle" d="M7 10.5V7.5a5 5 0 0 1 10 0v3" />
          <rect x="4.5" y="10.5" width="15" height="10" rx="3" fill="currentColor" stroke="none" />
        </svg>
      </div>

      <h2 className="seal-title">승인 완료 · 잠김</h2>
      <p className="seal-sub">
        잠긴 기준은 여기서 고칠 수 없습니다. 바꾸려면 처음부터 새 기준을 만들어 다시
        승인해야 합니다.
      </p>

      <div className="seal-fp">
        <span className="hint">기준 지문</span>
        <code className="mono">{shown}<span className="seal-rest">{rest}</span></code>
      </div>

      {children}
    </div>
  );
}
