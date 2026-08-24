/** 라이브 블루프린트(SPEC §4.3) — 답변이 바뀔 때마다 entry.compile을 시도해
 *  다음 단계에서 승인할 채점 기준·관문·채점을 맡을 AI·홀드아웃 안내를 미리 보여준다.
 *  실패해도 크래시 없이 안내만. 템플릿별 분기 없이 등록소 인터페이스만 사용한다. */

import { useEffect, useRef, useState } from "react";
import type { EvaluationPack, JudgeProvider } from "@harnest/contracts";
import type { TemplateEntry } from "../templates";
import { PROVIDER_LABEL } from "../lib/llm";

type BlueprintState =
  | { kind: "pending" }
  | { kind: "ok"; pack: EvaluationPack }
  | { kind: "fail"; reason: string | null };

export function WizardBlueprint({
  entry,
  answers,
  judge,
}: {
  entry: TemplateEntry;
  answers: Record<string, unknown>;
  judge: { provider: JudgeProvider; model: string };
}) {
  const [state, setState] = useState<BlueprintState>({ kind: "pending" });
  // 디바운스 + 최신 요청만 반영(늦게 끝난 이전 compile 결과 무시)
  const seq = useRef(0);

  useEffect(() => {
    const id = ++seq.current;
    const timer = setTimeout(() => {
      void entry
        .compile({ schemaVersion: "skeleton-1", templateId: entry.id, answers }, judge)
        .then((c) => {
          if (seq.current === id) setState({ kind: "ok", pack: c.pack });
        })
        .catch((e: unknown) => {
          if (seq.current === id) {
            setState({ kind: "fail", reason: e instanceof Error ? e.message : null });
          }
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [entry, answers, judge]);

  const jp = state.kind === "ok" ? state.pack.judgeProcedure : null;
  const hp = state.kind === "ok" ? state.pack.holdoutPolicy : null;

  return (
    <div className="card" style={{ width: 380, flexShrink: 0 }}>
      <h2 style={{ marginTop: 0 }}>지금까지 만들어진 채점 기준</h2>
      {state.kind !== "ok" ? (
        <div>
          <p className="sub" style={{ marginBottom: 6 }}>
            답을 채우면 어떤 기준으로 채점할지가 여기에 나타납니다.
          </p>
          {state.kind === "fail" && state.reason ? (
            <div className="hint">{state.reason}</div>
          ) : null}
        </div>
      ) : (
        <div>
          <table className="grid">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>기준</th>
                <th>가중치</th>
              </tr>
            </thead>
            <tbody>
              {state.pack.criteria.map((c) => (
                <tr key={c.id}>
                  <td style={{ textAlign: "left" }}>{c.label}</td>
                  <td>{Math.round(c.weight * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h2 style={{ fontSize: 14, margin: "14px 0 6px" }}>반드시 지켜야 할 것</h2>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {state.pack.gates.map((g) => (
              <li key={g.id}>
                {g.label} <span className="badge muted">어기면 탈락</span>
              </li>
            ))}
          </ul>
          {jp && jp.kind === "case_answering" ? (
            <div style={{ marginTop: 12, fontSize: 13 }}>
              <strong>채점을 맡을 AI</strong> — {PROVIDER_LABEL[jp.judge.provider]} · {jp.judge.model}
            </div>
          ) : null}
          {hp && hp.mode === "auto_tail" ? (
            <div className="hint" style={{ marginTop: 8 }}>{hp.note}</div>
          ) : null}
          <p className="hint" style={{ marginTop: 12 }}>
            이 기준은 다음 단계에서 당신이 직접 확인하고 승인합니다.
          </p>
        </div>
      )}
    </div>
  );
}
