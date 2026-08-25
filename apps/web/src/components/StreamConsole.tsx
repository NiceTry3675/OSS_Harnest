/** AI가 쓰고 있는 것을 보여주는 콘솔.
 *
 *  모델 호출은 응답이 한 번에 도착하지만, 도착한 내용을 그대로 한 글자씩 풀어 보여준다.
 *  없는 내용을 지어내지 않는다 — 실제로 받은 텍스트만 순서대로 드러낸다.
 *  기다리는 몇 초가 정지 화면이 되지 않도록 하는 것이 목적이다. */

import { useEffect, useRef, useState } from "react";

export function StreamConsole({
  title,
  model,
  text,
  running,
}: {
  title: string;
  model: string;
  /** 도착한 전문. 비어 있으면 아직 오지 않은 것 */
  text: string;
  running: boolean;
}) {
  const [shown, setShown] = useState("");
  const timer = useRef<number>(0);

  useEffect(() => {
    if (!text) {
      setShown("");
      return;
    }
    const reduced =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setShown(text);
      return;
    }
    setShown("");
    let at = 0;
    timer.current = window.setInterval(() => {
      at += 2;
      setShown(text.slice(0, at));
      if (at >= text.length) window.clearInterval(timer.current);
    }, 18);
    return () => window.clearInterval(timer.current);
  }, [text]);

  const typing = running || shown.length < text.length;

  return (
    <div className="stream">
      <div className="stream-top">
        {running ? <span className="stream-dot" aria-hidden="true" /> : null}
        {title}
        <span className="stream-model">{model}</span>
      </div>
      <div className="stream-body" aria-live="polite">
        {shown}
        {typing ? <span className="stream-caret" aria-hidden="true" /> : null}
      </div>
    </div>
  );
}
