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
import { CurveChart } from "../components/CurveChart";
import { countCaseProvenance } from "../lib/case-provenance";

const PROVENANCE_LABEL: Record<ProvenanceType, string> = {
  run_started: "실행 시작",
  round: "라운드",
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

function holdoutPhase(result: HoldoutEvaluation | null, error: string | null): string {
  if (result === null) return error === null ? "측정 중" : "채점 실패";
  return result.gateRejected
    ? "분량 게이트 실격 — 점수 미계산"
    : `${fmt(result.score)}점`;
}

function caseGrade(score: number | undefined): string {
  if (score === undefined) return "—";
  return score === 1 ? "정답" : score === 0.5 ? "부분 정답" : "오답";
}

export function ResultsPage() {
  const {
    compiled,
    approvedDigest,
    approvedAt,
    answers,
    checkpoint,
    holdout,
    examinerRun,
    calibration,
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
      examinerRun,
      calibration,
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
  const baselineHoldoutError = holdout.errors?.baseline ?? null;
  const finalHoldoutError = holdout.errors?.final ?? null;
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
        승인된 기준으로 측정한 결과입니다 — 점수를 먼저 확인한 뒤 산출물을 받으세요.
      </p>

      <div className="card">
        <div style={{ fontSize: 24, fontWeight: 700 }}>
          원샷 {fmt(baseline)}점 → 루프 {fmt(final)}점{" "}
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
          총 {checkpoint.round}라운드
          {checkpoint.doneReason === "plateau" ? " · 정체로 조기 종료" : ""}
        </div>
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
          <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
            입력, 승인된 Pack·검증 근거, 실행 결과·홀드아웃이 같은 JSON 형식으로 로컬 서버
            ({API_LABEL})에 최대 1 MiB까지 저장됩니다. API 키와 시험관 내부 산출물은 포함하지
            않습니다.
            {saved === "fail" && saveError !== null ? ` — ${saveError}` : ""}
            {exported === "fail" ? " — JSON 기록의 결속을 확인할 수 없습니다." : ""}
            {!recordReady ? " — 홀드아웃 채점이 끝난 뒤 기록할 수 있습니다." : ""}
          </span>
        </div>
      </div>

      {(holdout.baseline !== null ||
        holdout.final !== null ||
        baselineHoldoutError !== null ||
        finalHoldoutError !== null) && (
        <div className="card">
          <div style={{ fontSize: 16, fontWeight: 600 }}>
            루프에 숨긴 검증 케이스에서 — 시작 {holdoutPhase(holdout.baseline, baselineHoldoutError)} → 종료{" "}
            {holdoutPhase(holdout.final, finalHoldoutError)}
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
            홀드아웃으로 배정된 케이스의 채점 결과는 실행 중 루프에 유입되지 않았습니다 — 시작과
            종료 시에만 측정한 참고 지표입니다.
          </p>
          {(baselineHoldoutError !== null || finalHoldoutError !== null) && (
            <p className="error" style={{ marginBottom: 0 }}>
              {baselineHoldoutError !== null ? `시작 채점 실패: ${baselineHoldoutError}` : ""}
              {baselineHoldoutError !== null && finalHoldoutError !== null ? " · " : ""}
              {finalHoldoutError !== null ? `종료 채점 실패: ${finalHoldoutError}` : ""}
            </p>
          )}
          {holdoutCaseIds.length > 0 ? (
            <>
              <table className="grid" style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>구분</th>
                    <th style={{ textAlign: "left" }}>홀드아웃 질문</th>
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
                반복은 같은 질문이 가시 세트에도 등장했음을, 신규는 질문 문면이 가시 세트에 없었음을
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

      <h2>활성 방어 세트</h2>
      <div className="card">
        {jp.kind === "deterministic_only" ? (
          <>
            <span className="badge" title={jp.exemptions.pairwise}>
              결정적 채점 전용
            </span>
            <span className="badge muted" title={jp.exemptions.examinerReport}>
              검증 리포트: 해당 없음(특례)
            </span>
            <span className="badge muted" title={jp.exemptions.calibration}>
              캘리브레이션: 해당 없음(특례)
            </span>
            <span className="badge muted" title={hp.note}>
              홀드아웃: 해당 없음
            </span>
          </>
        ) : (
          <>
            <span className="badge">케이스 실측 채점(저지: {jp.judge.model})</span>
            <span className="badge" title={jp.pairwiseNotice}>
              채택: 스칼라 엄격 개선
            </span>
            {hp.mode === "auto_tail" && (
              <span className="badge" title={hp.note}>
                홀드아웃 {hp.holdoutCaseIds.length}케이스(자동 꼬리)
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
                title={`판정 ${VERDICT_LABEL[calibration.verdict]} — 알려진 꼼수 쌍 포함 블라인드 A/B`}
              >
                캘리브레이션: {calibration.pairs.filter((p) => p.agreed).length}/
                {calibration.pairs.length} 일치
              </span>
            ) : (
              <span className="badge muted">캘리브레이션: 기록 없음</span>
            )}
            {caseCounts !== null && caseCounts.total > 0 ? (
              caseCounts.ai + caseCounts.aiEdited > 0 ? (
                <span
                  className="badge"
                  title={`확인 ${caseCounts.ai} · 수정 ${caseCounts.aiEdited} — 확인된 초안은 승인 시 다이제스트에 결속됨`}
                >
                  케이스 출처: AI 초안 {caseCounts.ai + caseCounts.aiEdited}/{caseCounts.total}
                </span>
              ) : (
                <span className="badge muted">케이스 전부 직접 입력</span>
              )
            ) : null}
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
