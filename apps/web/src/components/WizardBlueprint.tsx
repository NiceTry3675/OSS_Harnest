/** 라이브 블루프린트(SPEC §4.3) — 답변이 바뀔 때마다 entry.compile을 시도해
 *  다음 단계에서 승인할 채점 기준·관문·채점 모델·홀드아웃 안내를 미리 보여준다.
 *  실패해도 크래시 없이 안내만. 템플릿별 분기 없이 등록소 인터페이스만 사용한다. */

import { useEffect, useRef, useState } from "react";
import type { CriterionDef, EvaluationPack, JudgeProvider } from "@harnest/contracts";
import type { TemplateEntry } from "../templates";
import { formatModelLabel } from "../lib/llm";
import { InfoTip } from "./InfoTip";

type BlueprintState =
  | { kind: "pending" }
  | { kind: "ok"; pack: EvaluationPack }
  | { kind: "fail"; reason: string | null };

function splitCriterionLabel(criterion: CriterionDef): { title: string; help: string | null } {
  const match = criterion.label.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  if (match) return { title: match[1].trim(), help: match[2].trim() };
  const visibleCases = criterion.params.visibleCases;
  if (criterion.kind === "case_answering" && typeof visibleCases === "number") {
    return {
      title: criterion.label,
      help: `문서만 보고 실제 질문 ${visibleCases}개에 답할 수 있는지 확인`,
    };
  }
  return { title: criterion.label, help: null };
}

export interface BlueprintVisibility {
  deterministicCriteria: boolean;
  gates: boolean;
  questionUse: boolean;
  judge: boolean;
}

const SHOW_ALL: BlueprintVisibility = {
  deterministicCriteria: true,
  gates: true,
  questionUse: true,
  judge: true,
};

export function WizardBlueprint({
  entry,
  answers,
  judge,
  visibility = SHOW_ALL,
}: {
  entry: TemplateEntry;
  answers: Record<string, unknown>;
  judge: { provider: JudgeProvider; model: string };
  visibility?: BlueprintVisibility;
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
      <h2 style={{ marginTop: 0, marginBottom: 2 }}>평가 구성 미리보기</h2>
      <p className="hint" style={{ marginTop: 0, marginBottom: 4 }}>입력할수록 채워집니다</p>
      {state.kind !== "ok" ? (
        <div>
          <p className="sub" style={{ marginBottom: 6 }}>
            답을 채우면 평가 기준과 필수 조건이 여기에 나타납니다.
          </p>
          {state.kind === "fail" && state.reason ? (
            <div className="hint">{state.reason}</div>
          ) : null}
        </div>
      ) : (
        <div>
          {state.pack.criteria
            .filter((criterion) =>
              criterion.kind === "case_answering" || visibility.deterministicCriteria,
            )
            .map((c, n) => {
            const label = splitCriterionLabel(c);
            return (
              <div key={c.id} className="bp-row">
                <span className="bp-ic">{n + 1}</span>
                <div className="bp-body">
                  <b>
                    {label.title}
                    {label.help ? <InfoTip label={label.title} text={label.help} /> : null}
                  </b>
                  <p>가중치 {Math.round(c.weight * 100)}%</p>
                </div>
              </div>
            );
          })}
          {visibility.gates ? state.pack.gates.map((g) => (
            <div key={g.id} className="bp-row is-gate">
              <span className="bp-ic">!</span>
              <div className="bp-body">
                <b>{g.label}</b>
                <p>위반 시 제외</p>
              </div>
            </div>
          )) : null}
          {visibility.questionUse && hp && hp.mode === "seeded_split" ? (
            <div className="bp-row is-seal">
              <span className="bp-ic">?</span>
              <div className="bp-body">
                <b>질문 사용 구분</b>
                <p>
                  중간 점검용 {hp.guardCaseIds.length}개 · 최종 확인용 {hp.holdoutCaseIds.length}개
                  <InfoTip
                    label="질문 사용 구분"
                    text={`${hp.note}\n중간 점검 점수가 현재 결과보다 ${hp.guardTolerance}점 넘게 낮으면 새 개선안을 채택하지 않습니다.`}
                  />
                </p>
              </div>
            </div>
          ) : null}
          {visibility.judge && jp && jp.kind === "case_answering" ? (
            <div className="bp-row">
              <span className="bp-ic">＊</span>
              <div className="bp-body">
                <b>사용할 AI 모델</b>
                <p>
                  {formatModelLabel(jp.judge.provider, jp.judge.model)}
                </p>
                <p className="hint">결과물 생성과 평가에 함께 사용합니다.</p>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
