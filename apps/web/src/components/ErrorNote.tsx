/** 오류 문구 — 항상 마운트된 role="alert" 컨테이너에 내용만 갈아 끼운다.
 *  조건부로 요소를 넣었다 빼면 일부 보조기기·브라우저 조합이 첫 삽입을 읽지 않는다.
 *  비어 있으면 빈 문단으로 남아 화면 높이를 차지하지 않는다(.error-note:empty). */

import type { CSSProperties } from "react";

export function ErrorNote({
  id,
  message,
  live,
  className,
  style,
  as: Tag = "p",
}: {
  id?: string;
  message: string | null | undefined;
  /** 생략하면 role="alert"의 기본(assertive)만 따른다 — 활동 콘솔(polite)과 겹치는 화면은 생략한다 */
  live?: "assertive" | "polite";
  className?: string;
  style?: CSSProperties;
  /** 문단이 아니라 줄 안에 두어야 하는 곳(버튼 옆 안내)은 span */
  as?: "p" | "span";
}) {
  const text = message ?? "";
  return (
    <Tag
      id={id}
      role="alert"
      aria-live={live}
      className={`error error-note${className ? " " + className : ""}`}
      // 비어 있을 때는 여백도 주지 않는다 — 빈 alert 영역이 자리를 차지하면 안 된다
      style={text ? style : undefined}
    >
      {text}
    </Tag>
  );
}
