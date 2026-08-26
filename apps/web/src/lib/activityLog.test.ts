/** 추론 실황 통로 — 조각 경계가 어디서 잘리든 같은 글이 나와야 한다.
 *  화면에 흐르는 글은 표시 전용이므로, 여기서 검사하는 것은 "읽을 수 있는가"뿐이다. */

import { describe, expect, it } from "vitest";
import { clearStream, streamSnapshot, withActivityLog } from "./activityLog";
import type { StreamingLlmClient } from "./llm";

const BREAK = String.fromCharCode(10);

function streamingLlm(whole: string, cut: number, thoughts = ""): StreamingLlmClient {
  return {
    providerId: "mock",
    model: "테스트",
    async complete() {
      return whole;
    },
    async completeStream(_prompt, _opts, onChunk) {
      for (let at = 0; at < thoughts.length; at += cut) {
        onChunk(thoughts.slice(at, at + cut), "thought");
      }
      for (let at = 0; at < whole.length; at += cut) {
        onChunk(whole.slice(at, at + cut), "output");
      }
      return whole;
    },
  };
}

type PlainLlm = { providerId: "mock"; model: string; complete(): Promise<string> };

async function flow(llm: StreamingLlmClient | PlainLlm): Promise<string> {
  clearStream();
  await withActivityLog(llm, "테스트").complete("무시");
  return streamSnapshot().text;
}

describe("추론 실황 통로", () => {
  it("채점 JSON에서 판정 표시와 이유만 흘린다 — 조각을 어디서 잘라도 같다", async () => {
    const raw =
      '[{"caseId":"case-1","score":1,"why":"문서에 규칙이 있다"},' +
      '{"caseId":"case-2","score":0,"why":"근거를 찾지 못했다"}]';
    const seen: string[] = [];
    for (const cut of [1, 3, 7, 1000]) seen.push(await flow(streamingLlm(raw, cut)));

    expect(new Set(seen).size).toBe(1);
    expect(seen[0]).toContain("[정답] 문서에 규칙이 있다");
    expect(seen[0]).toContain("[오답] 근거를 찾지 못했다");
    expect(seen[0]).not.toContain("caseId");
    expect(seen[0]).not.toContain('"');
  });

  it("산출물 본문(산문)은 통로에 올리지 않는다 — 결과 화면에서 따로 읽는다", async () => {
    const prose = "# 인수인계 문서" + BREAK + BREAK + "첫 문단입니다.";
    expect(await flow(streamingLlm(prose, 4))).toBe("");
  });

  it("추론 요약은 벤더가 준 그대로 흘린다", async () => {
    const text = await flow(streamingLlm("문서 본문입니다", 3, "빠진 항목부터 채워야겠다."));
    expect(text).toContain("빠진 항목부터 채워야겠다.");
    expect(text).not.toContain("문서 본문입니다");
  });

  it("코드 펜스로 감싸 와도 JSON으로 읽는다", async () => {
    const text = await flow(streamingLlm('```json\n{"score":0.5,"why":"일부만 맞다"}\n```', 5));
    expect(text).toContain("[부분] 일부만 맞다");
    expect(text).not.toContain("```");
  });

  it("따옴표·줄바꿈 이스케이프를 풀어서 흘린다", async () => {
    const text = await flow(streamingLlm('{"score":1,"why":"\\"금요일\\" 규칙\n확인"}', 2));
    expect(text).toContain('"금요일" 규칙\n확인');
  });


  it("배열 값도 원소마다 이어서 흘린다 — 초안의 근거 인용", async () => {
    const raw =
      '[{"question":"월세 0원 응답은 어떻게 처리하나요?",' +
      '"expectedAnswer":"제외합니다",' +
      '"evidence":["월세를 지출하지 않은 응답자는 제외","PROC SURVEYREG를 이용"]}]';
    const seen: string[] = [];
    for (const cut of [1, 5, 1000]) seen.push(await flow(streamingLlm(raw, cut)));

    expect(new Set(seen).size).toBe(1);
    expect(seen[0]).toContain("월세 0원 응답은 어떻게 처리하나요?");
    expect(seen[0]).toContain("월세를 지출하지 않은 응답자는 제외");
    expect(seen[0]).toContain("PROC SURVEYREG를 이용");
    // 답은 흘리지 않는다 — 카드에 이미 있다
    expect(seen[0]).not.toContain("제외합니다");
    // 값마다 줄이 나뉜다
    expect(seen[0].split(BREAK).filter((l) => l.trim() !== "")).toHaveLength(3);
  });

  it("스트리밍을 지원하지 않는 클라이언트도 같은 결과를 낸다", async () => {
    const text = await flow({
      providerId: "mock",
      model: "테스트",
      async complete() {
        return '{"score":1,"why":"맞다"}';
      },
    });
    expect(text).toContain("[정답] 맞다");
  });
});
