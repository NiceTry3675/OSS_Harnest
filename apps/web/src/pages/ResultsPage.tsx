/** 결과 — 개선은 주장이 아니라 측정이다(PHILOSOPHY 원칙 1): 점수 헤드라인이 최상단.
 *  산출물 렌더는 등록소의 ArtifactView로 위임 — 이 파일은 템플릿을 모른다.
 *  홀드아웃 점수는 표시 전용 참고 지표(SPEC §3 원칙 7) — 루프에 관여하지 않았다.
 *  서버 기록은 있으면 남기고 없으면 조용히 넘어간다(오프라인 완결). */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ProvenanceType } from "@harnest/contracts";
import { useProject, type HoldoutEvaluation } from "../state";
import { getTemplate } from "../templates";
import { saveProject, uploadResult } from "../lib/api";
import { CurveChart } from "../components/CurveChart";

const PROVENANCE_LABEL: Record<ProvenanceType, string> = {
  run_started: "실행 시작",
  round: "고침",
  adopted: "채택",
  paused: "일시정지",
  resumed: "재개",
  finished: "완료",
  plateau_stop: "정체 종료",
};

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString("ko-KR", { hour12: false });
}

function deltaColor(delta: number): string {
  return delta > 0 ? "var(--good)" : delta < 0 ? "var(--bad)" : "var(--ink-3)";
}

const VERDICT_LABEL = { pass: "통과", warn: "주의", fail: "실패" } as const;

function holdoutPhase(result: HoldoutEvaluation | null): string {
  if (result === null) return "측정 없음";
  return result.gateRejected
    ? "분량을 넘겨 탈락 — 점수를 매기지 않음"
    : `${fmt(result.score)}점`;
}

function caseGrade(score: number | undefined): string {
  if (score === undefined) return "—";
  return score === 1 ? "정답" : score === 0.5 ? "부분 정답" : "오답";
}

export function ResultsPage() {
  const { compiled, approvedAt, answers, runId, checkpoint, holdout, examinerRun, calibration } =
    useProject();
  const navigate = useNavigate();
  const [saved, setSaved] = useState<"idle" | "saving" | "ok" | "fail">("idle");
  const entry = compiled ? getTemplate(compiled.pack.templateId) : null;

  // 업로드는 자동이 아니라 사용자의 선택이다 — 입력한 기록(질문·답 전체)과 산출물이
  // 로컬 서버 DB에 저장되므로, 무엇이 전송되는지 고지하고 버튼으로만 보낸다.
  const uploadToServer = async () => {
    if (!compiled || !checkpoint || saved === "saving") return;
    setSaved("saving");
    const projectId = await saveProject({
      interview: {
        schemaVersion: "skeleton-1",
        templateId: compiled.pack.templateId,
        answers,
      },
      pack: compiled.pack,
      loopSpec: compiled.loopSpec,
    });
    const ok = projectId !== null && (await uploadResult(projectId, { checkpoint }));
    setSaved(ok ? "ok" : "fail");
  };

  const adopted = useMemo(
    () => new Set((checkpoint?.tree ?? []).filter((r) => r.adopted).map((r) => r.round)),
    [checkpoint],
  );

  if (!compiled || !entry || !checkpoint || checkpoint.status !== "done") {
    return (
      <div>
        <h1>결과</h1>
        <div className="card">
          <p className="sub">아직 완료된 실행이 없습니다. 관제실에서 실행을 끝까지 지켜봐 주세요.</p>
          <button className="primary" onClick={() => navigate("/console")}>
            관제실로 이동
          </button>
        </div>
      </div>
    );
  }

  const baseline = checkpoint.curve.length > 0 ? checkpoint.curve[0] : 0;
  const final = checkpoint.championScore;
  const delta = final - baseline;
  const { pack } = compiled;
  const jp = pack.judgeProcedure;
  const hp = pack.holdoutPolicy;
  const ArtifactView = entry.ArtifactView;
  const holdoutDelta =
    holdout.baseline !== null &&
    !holdout.baseline.gateRejected &&
    holdout.final !== null &&
    !holdout.final.gateRejected
      ? holdout.final.score - holdout.baseline.score
      : null;
  const baselineCases =
    holdout.baseline !== null && !holdout.baseline.gateRejected ? holdout.baseline.perCase : [];
  const finalCases =
    holdout.final !== null && !holdout.final.gateRejected ? holdout.final.perCase : [];
  const holdoutCaseIds = Array.from(
    new Set([...baselineCases.map((c) => c.caseId), ...finalCases.map((c) => c.caseId)]),
  );

  return (
    <div>
      <h1>결과</h1>
      <p className="sub">
        당신이 승인한 기준으로 매긴 점수입니다. 점수를 먼저 보고 결과물을 받으세요.
      </p>

      <div className="card">
        <div style={{ fontSize: 24, fontWeight: 700 }}>
          AI가 한 번에 만든 것 {fmt(baseline)}점 → 고쳐서 {fmt(final)}점{" "}
          <span
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: delta > 0 ? "var(--good)" : "var(--ink-3)",
            }}
          >
            {delta > 0 ? `+${fmt(delta)}점 개선` : delta < 0 ? `${fmt(delta)}점` : "변화 없음"}
          </span>
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 4 }}>
          총 {checkpoint.round}번 고침
          {checkpoint.doneReason === "plateau" ? " · 정체로 조기 종료" : ""}
        </div>
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
          {saved === "ok" ? (
            <span className="badge">서버에 기록됨</span>
          ) : (
            <>
              <button onClick={uploadToServer} disabled={saved === "saving"}>
                {saved === "saving" ? "기록 중…" : "서버에 기록"}
              </button>
              <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                입력한 질문·답과 결과 문서를 내 컴퓨터의 서버에 저장합니다.
                {saved === "fail" ? " — 서버에 연결할 수 없습니다." : ""}
              </span>
            </>
          )}
        </div>
      </div>

      {(holdout.baseline !== null || holdout.final !== null) && (
        <div className="card">
          <div style={{ fontSize: 16, fontWeight: 600 }}>
            AI에게 안 보여준 질문에서 — 시작 {holdoutPhase(holdout.baseline)} → 종료{" "}
            {holdoutPhase(holdout.final)}
            {holdoutDelta !== null && (
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  marginLeft: 8,
                  color: deltaColor(holdoutDelta),
                }}
              >
                {holdoutDelta > 0
                  ? `+${fmt(holdoutDelta)}점`
                  : holdoutDelta < 0
                    ? `${fmt(holdoutDelta)}점`
                    : "변화 없음"}
              </span>
            )}
          </div>
          <p className="hint" style={{ marginBottom: 0 }}>
            이 질문들의 채점 결과는 AI가 고치는 동안 전혀 쓰이지 않았습니다 — 시작과
            종료 시에만 측정한 참고 지표입니다.
          </p>
          {holdoutCaseIds.length > 0 ? (
            <>
              <table className="grid" style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>구분</th>
                    <th style={{ textAlign: "left" }}>안 보여준 질문</th>
                    <th>시작</th>
                    <th>종료</th>
                  </tr>
                </thead>
                <tbody>
                  {holdoutCaseIds.map((caseId) => {
                    const atStart = baselineCases.find((c) => c.caseId === caseId);
                    const atEnd = finalCases.find((c) => c.caseId === caseId);
                    const sample = atEnd ?? atStart!;
                    return (
                      <tr key={caseId}>
                        <td style={{ textAlign: "left", whiteSpace: "nowrap" }}>
                          <span className={sample.caseType === "repeated" ? "badge" : "badge muted"}>
                            {sample.caseType === "repeated" ? "반복" : "신규"}
                          </span>
                        </td>
                        <td style={{ textAlign: "left" }}>{sample.question}</td>
                        <td title={atStart?.why}>{caseGrade(atStart?.score)}</td>
                        <td title={atEnd?.why}>{caseGrade(atEnd?.score)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="hint" style={{ marginBottom: 0 }}>
                반복은 AI에게 보여준 질문 중에도 같은 것이 있었다는 뜻이고, 신규는 그렇지 않았다는
                뜻합니다. 질문 반복은 이 문서 유형의 측정 대상이므로 제거하지 않고 구분해 보고합니다.
              </p>
            </>
          ) : null}
        </div>
      )}

      <h2>산출물</h2>
      <div className="card">
        <ArtifactView problem={compiled.problem} artifact={checkpoint.champion} />
      </div>

      <h2>아직 못 맞힌 질문</h2>
      <div className="card">
        {checkpoint.championViolations.length === 0 ? (
          <p style={{ margin: 0, fontSize: 14, color: "var(--good)" }}>모든 질문에 답할 수 있습니다</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: "var(--ink-2)" }}>
            {checkpoint.championViolations.map((v, i) => (
              <li key={i}>{v}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <CurveChart curve={checkpoint.curve} adopted={adopted} />
      </div>

      <h2>이번 실행에 적용된 안전장치</h2>
      <div className="card">
        {jp.kind === "deterministic_only" ? (
          <>
            <span className="badge" title={jp.exemptions.pairwise}>
              정해진 방식으로만 채점
            </span>
            <span className="badge muted" title={jp.exemptions.examinerReport}>
              기준 시험: 해당 없음
            </span>
            <span className="badge muted" title={jp.exemptions.calibration}>
              내 판단과 맞춰보기: 해당 없음
            </span>
            <span className="badge muted" title={hp.note}>
              숨겨둔 질문: 해당 없음
            </span>
          </>
        ) : (
          <>
            <span className="badge">실제로 답하게 해서 채점 (채점 AI: {jp.judge.model})</span>
            <span className="badge" title={jp.pairwiseNotice}>
              점수가 실제로 올랐을 때만 채택
            </span>
            {hp.mode === "auto_tail" && (
              <span className="badge" title={hp.note}>
                안 보여준 질문 {hp.holdoutCaseIds.length}개
              </span>
            )}
            {examinerRun !== null && examinerRun.report.forDigest === pack.definitionDigest ? (
              <span
                className="badge"
                title={examinerRun.report.checks
                  .map((c) => `${c.id}: ${VERDICT_LABEL[c.verdict]} — ${c.note}`)
                  .join("\n")}
              >
                검증 리포트: {VERDICT_LABEL[examinerRun.report.overall]}
              </span>
            ) : (
              <span className="badge muted">검증 리포트: 기록 없음</span>
            )}
            {calibration !== null && calibration.forDigest === pack.definitionDigest ? (
              <span
                className="badge"
                title={`판정 ${VERDICT_LABEL[calibration.verdict]} — 속임수 문서를 섞어 정답을 가린 채 비교`}
              >
                내 판단과 일치: {calibration.pairs.filter((p) => p.agreed).length}/
                {calibration.pairs.length} 일치
              </span>
            ) : (
              <span className="badge muted">내 판단과 맞춰보기: 기록 없음</span>
            )}
          </>
        )}
      </div>

      <h2>기록</h2>
      <div className="card" style={{ maxHeight: 260, overflowY: "auto" }}>
        <ul className="mono" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {checkpoint.provenance.map((p, i) => (
            <li key={i} style={{ padding: "2px 0", color: "var(--ink-2)" }}>
              <span style={{ color: "var(--ink-3)" }}>{timeOf(p.at)}</span>{" "}
              {PROVENANCE_LABEL[p.type] ?? p.type} — {p.detail}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
