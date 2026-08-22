/** 결과 — 산출물보다 측정이 먼저(PHILOSOPHY §5): 점수 헤드라인이 최상단.
 *  서버 기록은 있으면 남기고 없으면 조용히 넘어간다(오프라인 완결). */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ProvenanceType } from "@harnest/contracts";
import { useProject } from "../state";
import { saveProject, uploadResult } from "../lib/api";
import { CurveChart } from "../components/CurveChart";
import { TimetableGrid } from "../components/TimetableGrid";

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

export function ResultsPage() {
  const { compiled, approvedAt, answers, runId, checkpoint } = useProject();
  const navigate = useNavigate();
  const [saved, setSaved] = useState(false);
  const saveTried = useRef(false);

  useEffect(() => {
    if (saveTried.current) return;
    if (!compiled || !checkpoint || checkpoint.status !== "done") return;
    saveTried.current = true;
    void (async () => {
      // API 계약(apps/api/main.py): POST /projects {interview, pack, loopSpec} / results {checkpoint}
      const projectId = await saveProject({
        interview: {
          schemaVersion: "skeleton-1",
          templateId: compiled.pack.templateId,
          answers,
        },
        pack: compiled.pack,
        loopSpec: compiled.loopSpec,
      });
      if (projectId === null) return;
      const ok = await uploadResult(projectId, { checkpoint });
      if (ok) setSaved(true);
    })();
  }, [compiled, checkpoint, answers, approvedAt, runId]);

  const adopted = useMemo(
    () => new Set((checkpoint?.tree ?? []).filter((r) => r.adopted).map((r) => r.round)),
    [checkpoint],
  );

  if (!compiled || !checkpoint || checkpoint.status !== "done") {
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
          {saved && (
            <span className="badge" style={{ marginLeft: 8 }}>
              서버에 기록됨
            </span>
          )}
        </div>
      </div>

      <h2>근무표</h2>
      <div className="card">
        <TimetableGrid problem={compiled.problem} timetable={checkpoint.champion} />
      </div>

      <h2>남은 위반</h2>
      <div className="card">
        {checkpoint.championViolations.length === 0 ? (
          <p style={{ margin: 0, fontSize: 14, color: "var(--good)" }}>위반 없음</p>
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
        <span className="badge" title={pack.judgeProcedure.exemptions.pairwise}>
          결정적 채점 전용
        </span>
        <span className="badge muted" title={pack.judgeProcedure.exemptions.examinerReport}>
          검증 리포트: 해당 없음(특례)
        </span>
        <span className="badge muted" title={pack.judgeProcedure.exemptions.calibration}>
          캘리브레이션: 해당 없음(특례)
        </span>
        <span className="badge muted" title={pack.holdoutPolicy.note}>
          홀드아웃: 해당 없음(스켈레톤)
        </span>
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
