/** 라이브 블루프린트(SPEC §4.3)의 컴파일 훅 — 답변이 바뀔 때마다 entry.compile을 시도한다.
 *  결과 pack은 미리보기 카드(WizardBlueprint)와 케이스 목록의 용도 배지(WizardCaseList)가
 *  함께 읽는다. 실패해도 크래시 없이 안내만. 템플릿별 분기 없이 등록소 인터페이스만 사용한다. */

import { useEffect, useRef, useState } from "react";
import type { EvaluationPack, JudgeProvider } from "@harnest/contracts";
import type { TemplateEntry } from "../templates";

export type BlueprintState =
  | { kind: "pending" }
  /** answers는 이 pack을 만든 답변 참조 — 케이스 배지는 같은 참조일 때만 인덱스를 되돌린다 */
  | { kind: "ok"; pack: EvaluationPack; answers: Record<string, unknown> }
  | { kind: "fail"; reason: string | null };

export function useBlueprint(
  entry: TemplateEntry | null,
  answers: Record<string, unknown>,
  judge: { provider: JudgeProvider; model: string },
): BlueprintState {
  const [state, setState] = useState<BlueprintState>({ kind: "pending" });
  // 디바운스 + 최신 요청만 반영(늦게 끝난 이전 compile 결과 무시)
  const seq = useRef(0);

  useEffect(() => {
    const id = ++seq.current;
    if (entry === null) return;
    const timer = setTimeout(() => {
      void entry
        .compile({ schemaVersion: "skeleton-1", templateId: entry.id, answers }, judge)
        .then((c) => {
          if (seq.current === id) setState({ kind: "ok", pack: c.pack, answers });
        })
        .catch((e: unknown) => {
          if (seq.current === id) {
            setState({ kind: "fail", reason: e instanceof Error ? e.message : null });
          }
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [entry, answers, judge]);

  return state;
}
