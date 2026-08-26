/** 모델이 쓰고 있는 글이 흘러가는 콘솔.
 *
 *  도착한 글을 그대로 그린다. 흉내 내는 타자기를 두지 않는다 — 벤더가 이미
 *  토큰 단위로 흘려보내고 있어서, 그 위에 타자기를 한 겹 더 얹으면 진짜 속도를
 *  가리기만 한다. 화면에 뜨는 속도가 곧 모델이 쓰는 속도다.
 *
 *  스크롤은 읽는 쪽이 정한다. 맨 아래에 붙어 있으면 새 글을 따라가고,
 *  위로 올려 읽기 시작하면 따라가기를 멈춘다 — 읽는 도중에 화면이 끌려가면
 *  아무것도 읽을 수 없다. 멈춘 동안에는 되돌아가는 버튼을 띄운다. */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStream } from "../lib/activityLog";

/** 이만큼 안쪽이면 "맨 아래에 붙어 있다"로 본다 */
const STICK_SLACK = 40;

export function ActivityConsole({
  model,
  empty = "실행을 시작하면 AI가 쓰는 글이 여기에 흐릅니다.",
  height = 420,
}: {
  model?: string;
  empty?: string;
  height?: number;
}) {
  const { text, status, live } = useStream();
  const [following, setFollowing] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);

  // 글이 늘어난 직후, 그려지기 전에 붙인다 — 한 프레임 늦으면 눈에 띄게 튄다
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || !followRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [text]);

  // 통로가 비면(새 실행·새 검증) 다시 따라가기 시작한다
  useEffect(() => {
    if (text !== "") return;
    followRef.current = true;
    setFollowing(true);
  }, [text]);

  // 손으로 올리면 따라가기를 멈추고, 다시 바닥에 닿으면 이어서 따라간다
  const onScroll = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_SLACK;
    if (atBottom !== followRef.current) {
      followRef.current = atBottom;
      setFollowing(atBottom);
    }
  }, []);

  const catchUp = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    followRef.current = true;
    setFollowing(true);
    el.scrollTop = el.scrollHeight;
  }, []);

  return (
    <div className="stream" style={{ ["--stream-h" as string]: `${height}px` }}>
      <div className="stream-top">
        {live ? <span className="stream-dot" aria-hidden="true" /> : null}
        <span className="stream-name">AI 작업 기록</span>
        {status ? <span className="stream-phase">· {status}</span> : null}
        {model ? <span className="stream-model">{model}</span> : null}
      </div>
      <div className="stream-body" ref={bodyRef} onScroll={onScroll} aria-live="polite">
        {text === "" ? (
          <span className="stream-empty">{empty}</span>
        ) : (
          <>
            {text}
            {live ? <span className="stream-caret" aria-hidden="true" /> : null}
          </>
        )}
      </div>
      {!following && text !== "" ? (
        <button type="button" className="stream-catch" onClick={catchUp}>
          ↓ 최신으로
        </button>
      ) : null}
    </div>
  );
}
