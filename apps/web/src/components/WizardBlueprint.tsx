/** 라이브 블루프린트(SPEC §4.3) — 답변이 바뀔 때마다 entry.compile을 시도해
 *  다음 단계에서 승인할 채점 기준·관문·채점 모델·홀드아웃 안내를 미리 보여준다.
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
    <div className="card blueprint">
      <h2 style={{ marginTop: 0, marginBottom: 2 }}>이렇게 채점됩니다</h2>
      <p className="hint" style={{ marginTop: 0, marginBottom: 4 }}>입력할수록 채워집니다</p>
      {state.kind !== "ok" ? (
        <div>
          <p className="sub" style={{ marginBottom: 6 }}>
            답변을 채우면 채점 기준과 필수 관문이 여기에 나타납니다.
          </p>
          {state.kind === "fail" && state.reason ? (
            <div className="hint">{state.reason}</div>
          ) : null}
        </div>
      ) : (
        <div>
          {state.pack.criteria.map((c, n) => (
            <div key={c.id} className="bp-row">
              <span className="bp-ic">{n + 1}</span>
              <div className="bp-body">
                <b>{c.label}</b>
                <p>가중치 {Math.round(c.weight * 100)}%</p>
              </div>
            </div>
          ))}
          {state.pack.gates.map((g) => (
            <div key={g.id} className="bp-row is-gate">
              <span className="bp-ic">!</span>
              <div className="bp-body">
                <b>{g.label}</b>
                <p>미충족 시 탈락</p>
              </div>
            </div>
          ))}
          {hp && hp.mode === "auto_tail" ? (
            <div className="bp-row is-seal">
              <span className="bp-ic">?</span>
              <div className="bp-body">
                <b>숨김 검증</b>
                <p>{hp.note}</p>
              </div>
            </div>
          ) : null}
          {jp && jp.kind === "case_answering" ? (
            <div className="bp-row">
              <span className="bp-ic">＊</span>
              <div className="bp-body">
                <b>채점 모델</b>
                <p>
                  {PROVIDER_LABEL[jp.judge.provider]} · {jp.judge.model}
                </p>
              </div>
            </div>
          ) : null}
          <p className="hint">이 기준은 다음 단계에서 당신이 직접 승인합니다.</p>
        </div>
      )}
    </div>
  );
}
