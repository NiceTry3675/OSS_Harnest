/** 결과 — 개선은 주장이 아니라 측정이다(PHILOSOPHY 원칙 1): 점수 헤드라인이 최상단.
 *  산출물 렌더는 등록소의 ArtifactView로 위임 — 이 파일은 템플릿을 모른다.
 *  홀드아웃 점수는 표시 전용 참고 지표(SPEC §3 원칙 7) — 루프에 관여하지 않았다.
 *  서버 기록은 명시적 선택이며, 실패해도 JSON 파일 내보내기는 독립적으로 동작한다. */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ProvenanceType } from "@harnest/contracts";
import { useProject, type HoldoutEvaluation } from "../state";
import { getTemplate } from "../templates";
import {
  API_LABEL,
  ExportSaveError,
  saveExport,
  savedExportUrl,
  type SavedExport,
} from "../lib/api";
import {
  buildProjectExport,
  downloadProjectExport,
  isHoldoutSettled,
  needsRestoredHoldoutRecovery,
  serializeProjectExport,
} from "../lib/project-export";
import { setFlowStep } from "../lib/flowStep";
import { CurveChart } from "../components/CurveChart";
import { ErrorNote } from "../components/ErrorNote";
import { InfoTip } from "../components/InfoTip";
import { countCaseProvenance } from "../lib/case-provenance";

const PROVENANCE_LABEL: Record<ProvenanceType, string> = {
  run_started: "개선 시작",
  round: "개선 회차",
  adopted: "채택",
  paused: "개선 일시정지",
  resumed: "개선 재개",
  finished: "개선 완료",
  plateau_stop: "더 나아지지 않아 종료",
  ceiling_stop: "상한 도달 종료",
  error: "오류로 일시정지",
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

function holdoutPhase(result: HoldoutEvaluation | null, error: string | null): string {
  if (result === null) return error === null ? "측정 중" : "채점 실패";
  return result.gateRejected
    ? "필수 조건 위반 — 점수 없음"
    : `${fmt(result.score)}점`;
}

function caseGrade(score: number | undefined): string {
  if (score === undefined) return "—";
  return score === 1 ? "정답" : score === 0.5 ? "부분 정답" : "오답";
}

export function ResultsPage() {
  useEffect(() => {
    setFlowStep({ kind: "result" });
  }, []);

  const {
    compiled,
    approvedDigest,
    approvedAt,
    answers,
    checkpoint,
    holdout,
    examinerReport,
  } = useProject();
  const navigate = useNavigate();
  const [saved, setSaved] = useState<"idle" | "saving" | "ok" | "fail">("idle");
  const [savedRecord, setSavedRecord] = useState<SavedExport | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveUncertain, setSaveUncertain] = useState(false);
  const [exported, setExported] = useState<"idle" | "ok" | "fail">("idle");
  const entry = compiled ? getTemplate(compiled.pack.templateId) : null;
  // 케이스 출처 공개 — caseList 질문이 없는 템플릿(결정적 전용 등)은 null이라 렌더되지 않는다
  const caseCounts = useMemo(
    () => (entry ? countCaseProvenance(entry.questions, answers) : null),
    [entry, answers],
  );
  const recordReady = compiled !== null && isHoldoutSettled(compiled.pack, holdout);
  const recoverHoldout =
    compiled !== null && needsRestoredHoldoutRecovery(compiled.pack, checkpoint, holdout);

  // 완료 체크포인트의 챔피언으로 복구 가능한 홀드아웃을 채점하는 책임은 관제실 런타임에 있다.
  // /results 직접 복원도 영구적인 "측정 중" 상태에 머물지 않게 그 경계로 되돌린다.
  useEffect(() => {
    if (recoverHoldout) navigate("/console", { replace: true });
  }, [recoverHoldout, navigate]);

  const makeExport = async () => {
    if (!compiled || !checkpoint || !approvedDigest || !approvedAt) {
      throw new Error("승인된 완료 결과가 없습니다.");
    }
    const envelope = await buildProjectExport({
      compiled,
      answers,
      examinerReport,
      approvedDigest,
      approvedAt,
      checkpoint,
      holdout,
    });
    return { envelope, serialized: serializeProjectExport(envelope) };
  };

  const exportJson = async () => {
    try {
      const { envelope, serialized } = await makeExport();
      downloadProjectExport(envelope, serialized);
      setExported("ok");
    } catch {
      setExported("fail");
    }
  };

  // 업로드는 자동이 아니라 사용자의 선택이다. 파일과 같은 JSON 봉투를 한 번에 저장한다.
  const uploadToServer = async () => {
    if (saved === "saving") return;
    setSaved("saving");
    setSavedRecord(null);
    setSaveError(null);
    setSaveUncertain(false);
    try {
      const { serialized } = await makeExport();
      const record = await saveExport(serialized);
      setSavedRecord(record);
      setSaved("ok");
    } catch (error) {
      if (error instanceof ExportSaveError) {
        setSavedRecord(error.savedRecord);
        setSaveError(error.message);
        setSaveUncertain(error.serverMayHaveStored);
      } else {
        setSaveError(error instanceof Error ? error.message : "서버 기록에 실패했습니다.");
      }
      setSaved("fail");
    }
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
          <p className="sub">아직 완료된 실행이 없습니다. 실행 화면에서 결과물이 완성될 때까지 확인해 주세요.</p>
          <button className="primary" onClick={() => navigate("/console")}>
            실행 화면으로
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
  const baselineHoldoutError = holdout.errors?.baseline ?? null;
  const finalHoldoutError = holdout.errors?.final ?? null;
  const ArtifactView = entry.ArtifactView;

  /** 산출물을 사람이 여는 파일로 내려받는다 — 기록 전체를 담는 JSON 내보내기와 다르다 */
  const downloadArtifact = () => {
    if (!entry.exportArtifact) return;
    const file = entry.exportArtifact(compiled.problem, checkpoint.champion);
    const url = URL.createObjectURL(new Blob([file.text], { type: file.mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = file.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
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

      <div className="card">
        <div style={{ fontSize: 24, fontWeight: 700 }}>
          처음 {fmt(baseline)}점 → 고친 뒤 {fmt(final)}점{" "}
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
        <div className="result-meta">
          총 {checkpoint.round}회 개선
          {checkpoint.doneReason === "plateau"
            ? " · 더 나아지지 않아 일찍 끝남"
            : checkpoint.doneReason === "ceiling"
              ? " · 척도 상한(100점) 도달로 조기 종료"
              : ""}
        </div>
        {checkpoint.doneReason === "ceiling" && (
          <p className="result-warning">
            만점에 도달해 이 기준으로는 더 잴 것이 없습니다. 너무 일찍 만점이 나왔다면 대개 잘
            만들어서가 아니라 기준이 무르다는 뜻입니다 — 필수 조건이 실제로 걸리는지,
            결과물을 안 보고도 답할 수 있는 질문은 아닌지, 채점이 너무 후하지 않은지 살펴보세요.
            최종 확인 점수와 차이가 크다면 좋은 단서입니다. 기준을 조인 뒤 다시 승인하고 새로
            실행하면 다시 잴 수 있습니다.
          </p>
        )}
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button onClick={exportJson} disabled={!recordReady}>JSON 내보내기</button>
          {exported === "ok" && <span className="badge">JSON 내보냄</span>}
          {saved === "ok" ? (
            savedRecord !== null && (
              <a
                className="badge"
                href={savedExportUrl(savedRecord)}
                target="_blank"
                rel="noreferrer"
                title={`SHA-256 ${savedRecord.contentSha256}`}
              >
                서버 기록 {savedRecord.id.slice(0, 8)} 조회
              </a>
            )
          ) : (
            <button
              onClick={uploadToServer}
              disabled={saved === "saving" || !recordReady}
            >
              {saved === "saving"
                ? "기록 중…"
                : saveUncertain
                  ? "중복 가능 — 다시 기록"
                  : "서버에 기록"}
            </button>
          )}
          {saved !== "ok" && savedRecord !== null && (
            <a
              className="badge muted"
              href={savedExportUrl(savedRecord)}
              target="_blank"
              rel="noreferrer"
            >
              응답 기록 직접 확인
            </a>
          )}
          {!recordReady ? (
            <span className="result-action-message">최종 확인 채점이 끝난 뒤에 기록할 수 있습니다.</span>
          ) : null}
          <details className="result-save-detail">
            <summary>저장되는 내용</summary>
            <p>
              입력한 내용, 승인한 평가 구성과 점검 근거, 실행 결과와 최종 확인 점수를 하나의
              JSON 파일로 서버({API_LABEL})에 최대 1 MiB까지 저장합니다. API 키와 점검 과정의
              중간 기록은 저장하지 않습니다.
            </p>
          </details>
        </div>
        {/* 항상 마운트되는 alert 영역은 flex 컨테이너 밖에 둔다 — 빈 아이템이 전폭 행과 gap을 차지하지
            않게. 기록·내보내기 오류는 한 영역에 이어 붙인다 */}
        <ErrorNote
          className="result-action-message"
          live="assertive"
          style={{ marginTop: 8, marginBottom: 0 }}
          message={
            [
              saved === "fail" && saveError !== null ? `서버 기록 실패: ${saveError}` : null,
              exported === "fail" ? "JSON 기록의 결속을 확인할 수 없습니다." : null,
            ]
              .filter((note): note is string => note !== null)
              .join(" ") || null
          }
        />
      </div>

      {(checkpoint.championGuardScore ?? null) !== null && (
        <div className="card">
          <div style={{ fontSize: 16, fontWeight: 600 }}>
            중간 점검 — 시작{" "}
            {(checkpoint.guardCurve?.[0] ?? null) !== null
              ? `${fmt(checkpoint.guardCurve[0]!)}점`
              : "측정 불가(실격)"}{" "}
            → 종료 {fmt(checkpoint.championGuardScore!)}점
            <InfoTip
              label="중간 점검"
              text="개선안이 현재 결과보다 크게 나빠지지 않았는지 매 회차 확인합니다. 합계 점수만 채택 판단에 사용하며, 개별 질문과 실패 사유는 개선에 전달하지 않습니다."
            />
          </div>
        </div>
      )}

      {(holdout.baseline !== null ||
        holdout.final !== null ||
        baselineHoldoutError !== null ||
        finalHoldoutError !== null) && (
        <div className="card">
          <div style={{ fontSize: 16, fontWeight: 600 }}>
            최종 확인 — 시작 {holdoutPhase(holdout.baseline, baselineHoldoutError)} → 종료{" "}
            {holdoutPhase(holdout.final, finalHoldoutError)}
            {checkpoint.round === 0 ? (
              // 라운드 0에서 끝난 실행은 시작·종료 산출물이 같다 — 같은 문서에 델타를 붙이면 오해를 부른다
              <span className="hint" style={{ marginLeft: 8, fontWeight: 400 }}>
                시작·종료 산출물이 같아 한 번만 채점했습니다
              </span>
            ) : holdoutDelta !== null && (
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
            <InfoTip
              label="최종 확인"
              text={"최종 확인용 질문은 개선에 사용하지 않고 시작과 종료 시에만 채점합니다.\n반복: 개선용 질문과 같은 질문\n신규: 개선용 질문에 없던 질문"}
            />
          </div>
          <ErrorNote
            live="assertive"
            style={{ marginBottom: 0 }}
            message={
              baselineHoldoutError !== null || finalHoldoutError !== null
                ? [
                    baselineHoldoutError !== null ? `시작 채점 실패: ${baselineHoldoutError}` : null,
                    finalHoldoutError !== null ? `종료 채점 실패: ${finalHoldoutError}` : null,
                  ]
                    .filter((part): part is string => part !== null)
                    .join(" · ")
                : null
            }
          />
          {holdoutCaseIds.length > 0 ? (
            <>
              <table className="grid" style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>구분</th>
                    <th style={{ textAlign: "left" }}>최종 확인용 질문</th>
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
            </>
          ) : null}
        </div>
      )}

      <div className="artifact-head">
        <h2>결과물</h2>
        {entry.exportArtifact ? (
          <button className="primary" onClick={downloadArtifact}>
            문서 내려받기
          </button>
        ) : null}
      </div>
      <div className="card">
        <ArtifactView problem={compiled.problem} artifact={checkpoint.champion} />
      </div>

      <h2>남은 실패 항목</h2>
      <div className="card">
        {checkpoint.championViolations.length === 0 ? (
          <p style={{ margin: 0, fontSize: 14, color: "var(--good)" }}>남은 실패 항목 없음</p>
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

      <details className="card result-detail">
        <summary>평가 및 기록 상세</summary>
        <div className="result-detail-body">
          <h3>적용된 보호 규칙</h3>
          <div className="result-badges">
            {jp.kind === "deterministic_only" ? (
              <>
                <span className="badge" title={jp.exemptions.pairwise}>규칙 기반 채점</span>
                <span className="badge muted" title={jp.exemptions.examinerReport}>사전 점검: 해당 없음</span>
                <span className="badge muted" title={hp.note}>최종 확인: 사용 안 함</span>
              </>
            ) : (
              <>
                <span className="badge">평가 사례 채점 · {jp.judge.model}</span>
                <span className="badge" title={jp.pairwiseNotice}>채택: 점수 상승 + 중간 점검 통과</span>
                {hp.mode === "seeded_split" && (
                  <span className="badge" title={hp.note}>
                    중간 점검 {hp.guardCaseIds.length}개 · 최종 확인 {hp.holdoutCaseIds.length}개
                  </span>
                )}
                {examinerReport !== null && examinerReport.forDigest === pack.definitionDigest ? (
                  <span
                    className="badge"
                    title={examinerReport.checks
                      .map((c) => `${c.id}: ${VERDICT_LABEL[c.verdict]} — ${c.note}`)
                      .join("\n")}
                  >
                    사전 점검: {VERDICT_LABEL[examinerReport.overall]}
                  </span>
                ) : (
                  <span className="badge muted">사전 점검: 기록 없음</span>
                )}
                {caseCounts !== null && caseCounts.total > 0 ? (
                  caseCounts.ai + caseCounts.aiEdited > 0 ? (
                    <span
                      className="badge"
                      title={`확인 ${caseCounts.ai} · 수정 ${caseCounts.aiEdited} — 확인한 초안은 승인한 평가 구성에 포함됩니다`}
                    >
                      평가 사례: AI 초안 {caseCounts.ai + caseCounts.aiEdited}/{caseCounts.total}
                    </span>
                  ) : (
                    <span className="badge muted">평가 사례 전부 직접 입력</span>
                  )
                ) : null}
              </>
            )}
          </div>

          <h3>기록</h3>
          <div className="result-log">
            <ul className="mono">
              {checkpoint.provenance.map((p, i) => (
                <li key={i}>
                  <span>{timeOf(p.at)}</span>{" "}
                  {PROVENANCE_LABEL[p.type] ?? p.type} — {p.detail}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </details>
    </div>
  );
}
