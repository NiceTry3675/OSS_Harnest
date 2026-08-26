/** 모델이 지금 쓰고 있는 글을 화면으로 흘려보내는 통로.
 *
 *  "무엇을 하는 중"이라는 상태 문구가 아니라, 모델이 실제로 만들어내는 글이
 *  만들어지는 속도 그대로 흐른다. 벤더가 열어둔 스트리밍 경로를 받아 쓰므로
 *  화면에 뜨는 속도가 곧 모델이 쓰는 속도다 — 다 받아놓고 흉내 내는 타자가 아니다.
 *
 *  엔진·템플릿·계약의 시그니처를 건드리지 않기 위해 전역 통로를 쓴다.
 *  클라이언트를 한 겹 감싸 응답을 여기로 흘리고, 화면은 구독만 한다.
 *
 *  흘러간 글은 표시 전용이다. 채점·채택·동결 어디에도 되돌아가지 않는다. */

import { useSyncExternalStore } from "react";
import type { LlmClient } from "@harnest/template-handover";
import { isStreamingClient } from "./llm";

export interface StreamState {
  /** 지금까지 도착한 글 전체 — 화면이 이걸 한 글자씩 드러낸다 */
  text: string;
  /** 콘솔 머리에 붙는 지금 상태 */
  status: string;
  /** 실행 중인지 — 깜빡이는 표시를 켠다 */
  live: boolean;
}

let state: StreamState = { text: "", status: "", live: false };
const listeners = new Set<() => void>();

function set(next: Partial<StreamState>): void {
  state = { ...state, ...next };
  for (const fn of listeners) fn();
}

/** 새 실행·새 검증을 시작할 때 — 지난 글이 섞이면 읽을 수 없다 */
export function clearStream(status = ""): void {
  state = { text: "", status, live: status !== "" };
  for (const fn of listeners) fn();
}

export function setStreamStatus(status: string, live = true): void {
  set({ status, live });
}

export function endStream(status = ""): void {
  set({ status, live: false });
}

/** 도착한 글자를 있는 그대로 잇는다 — 스트리밍 조각이 지나는 길 */
export function pushStream(text: string): void {
  if (text === "") return;
  set({ text: state.text + text });
}

/** 화면이 직접 붙이는 설명. 제목이 있으면 구분선으로 넣는다. */
export function appendStream(text: string, heading?: string): void {
  const body = text.trimEnd();
  if (!body) return;
  const head = heading ? `\n\n── ${heading} ──\n` : "\n\n";
  set({ text: state.text === "" ? (heading ? head.trimStart() + body : body) : state.text + head + body });
}

/** 지금 통로에 담긴 글 — 화면 밖(테스트 등)에서 읽을 때 쓴다 */
export function streamSnapshot(): StreamState {
  return state;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const EMPTY: StreamState = { text: "", status: "", live: false };

export function useStream(): StreamState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY,
  );
}

// ── 도착하는 도중에 읽을 수 있는 것만 골라낸다 ──────────────────────────
//
// 이 콘솔이 보여주려는 것은 산출물이 아니라 판단이다. 산출물은 결과 화면에서
// 따로 읽는다 — 여기서 한 번 더 흘리면 같은 글을 두 번 보는 것뿐이다.
//
// 그래서 산문으로 오는 응답(= 산출물 본문)은 통로에 올리지 않고 버린다.
// 올리는 것은 두 가지다.
//   · 모델이 답을 내기 전에 스스로 정리한 추론 요약 (벤더가 내주는 그대로)
//   · 채점 응답에서 뽑은 판정과 그 이유
//
// 채점 형식이 {"caseId", "score", "why"} 순서라 score가 why보다 먼저 온다 —
// 판정 표시를 먼저 찍고, 그 뒤에 이유가 한 글자씩 이어 붙는다.
//
// 필드 이름만 보고 고르므로 템플릿의 내용을 알지 않는다.

/** 도착하는 도중에 그대로 흘려보낼 값. 배열이면 원소 전부가 대상이다. */
const LIVE_KEYS = new Set(["why", "reason", "note", "question", "evidence", "quote"]);
/** 판정 표시로 바꿔 찍을 값 */
const MARK_KEY = "score";

const ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "",
  b: "",
  f: "",
  '"': '"',
  "\\": "\\",
  "/": "/",
};

interface LiveReader {
  push(chunk: string): void;
  end(): void;
}

const BREAK = String.fromCharCode(10);

function markOf(score: number): string {
  return score >= 1 ? "[정답]" : score > 0 ? "[부분]" : "[오답]";
}

function createLiveReader(): LiveReader {
  // 앞부분을 조금 모아 보고 산문인지 JSON인지 정한다
  let mode: "wait" | "prose" | "json" = "wait";
  let pre = "";

  // JSON 훑기 상태
  let inString = false;
  let escaped = false;
  let unicode = "";
  let buffer = "";
  let pendingKey: string | null = null;
  let expectingValue = false;
  let liveValue = false;
  let numeric = "";
  let rowOpen = false;
  /** 지금 값이 배열 안이면 쉼표가 나와도 키가 유지된다 */
  let inArrayValue = false;
  /** 판정 표시를 막 찍었다면 이유는 같은 줄에 이어 붙는다 */
  let justMarked = false;

  function finishNumber(): void {
    if (numeric === "") return;
    const value = Number(numeric);
    numeric = "";
    if (pendingKey === MARK_KEY && Number.isFinite(value)) {
      pushStream(`${rowOpen ? "" : BREAK + BREAK}${markOf(value)} `);
      rowOpen = true;
      justMarked = true;
    }
  }

  function feed(chunk: string): void {
    for (const ch of chunk) {
      if (inString) {
        if (unicode !== "") {
          unicode += ch;
          if (unicode.length === 5) {
            const decoded = String.fromCharCode(parseInt(unicode.slice(1), 16));
            buffer += decoded;
            if (liveValue) pushStream(decoded);
            unicode = "";
          }
          continue;
        }
        if (escaped) {
          escaped = false;
          if (ch === "u") {
            unicode = "u";
            continue;
          }
          const decoded = ESCAPES[ch] ?? ch;
          buffer += decoded;
          if (liveValue && decoded !== "") pushStream(decoded);
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
          if (expectingValue) {
            expectingValue = false;
            if (!inArrayValue) pendingKey = null;
            liveValue = false;
          } else {
            pendingKey = buffer;
          }
          continue;
        }
        buffer += ch;
        if (liveValue) pushStream(ch);
        continue;
      }

      if (ch === '"') {
        inString = true;
        buffer = "";
        if (expectingValue && pendingKey !== null && LIVE_KEYS.has(pendingKey)) {
          // 값마다 줄을 나눈다 — 붙여 두면 여러 값이 한 덩어리로 읽힌다
          liveValue = true;
          if (!justMarked) pushStream(rowOpen ? BREAK : BREAK + BREAK);
          justMarked = false;
          rowOpen = true;
        }
        continue;
      }
      if (ch === ":") {
        expectingValue = true;
        continue;
      }
      if (ch === "[" && expectingValue) {
        inArrayValue = true;
        continue;
      }
      if (ch === "," || ch === "}" || ch === "]") {
        finishNumber();
        if (ch === "," && inArrayValue) {
          // 같은 배열의 다음 원소 — 키는 그대로다
          expectingValue = true;
          continue;
        }
        if (ch === "]") inArrayValue = false;
        expectingValue = false;
        pendingKey = null;
        if (ch === "}") {
          rowOpen = false;
          justMarked = false;
        }
        continue;
      }
      if (expectingValue && /[-0-9.eE+]/.test(ch)) {
        numeric += ch;
        continue;
      }
    }
  }

  function decide(): void {
    // 코드 펜스로 감싸 오는 모델이 있어 앞의 ```json 은 세지 않는다
    const head = pre.replace(/^\s*(?:```[a-zA-Z]*\s*)?/, "");
    if (head === "" && pre.length <= 24) return;
    if (head.startsWith("[") || head.startsWith("{")) {
      mode = "json";
      pre = "";
      feed(head);
      return;
    }
    // 산문 = 산출물 본문. 흘리지 않고 버린다.
    mode = "prose";
    pre = "";
  }

  return {
    push(chunk) {
      if (mode === "wait") {
        pre += chunk;
        decide();
        return;
      }
      if (mode === "prose") return;
      feed(chunk);
    },
    end() {
      if (mode === "wait") {
        pre = "";
        mode = "prose";
      }
      finishNumber();
    },
  };
}

/** 모델 클라이언트를 감싸 응답을 도착하는 대로 통로에 흘린다.
 *  값과 오류는 그대로 통과시킨다 — 화면 효과가 실행을 바꾸지 않는다. */
export function withActivityLog(llm: LlmClient, label: string): LlmClient {
  return {
    providerId: llm.providerId,
    model: llm.model,
    async complete(prompt, opts) {
      setStreamStatus(label);
      const reader = createLiveReader();
      let opened = false;
      try {
        if (isStreamingClient(llm)) {
          const out = await llm.completeStream(prompt, opts, (chunk, kind) => {
            if (kind === "output") {
              reader.push(chunk);
              return;
            }
            if (kind === "notice") {
              appendStream(chunk, "안내");
              return;
            }
            // 추론 요약은 벤더가 내주는 그대로 흘린다 — 손대지 않는다
            if (!opened) {
              opened = true;
              pushStream("\n\n");
            }
            pushStream(chunk);
          });
          reader.end();
          return out;
        }
        const out = await llm.complete(prompt, opts);
        reader.push(out);
        reader.end();
        return out;
      } catch (err) {
        appendStream(err instanceof Error ? err.message : "모델 호출에 실패했습니다", "오류");
        endStream("실패");
        throw err;
      }
    },
  };
}
