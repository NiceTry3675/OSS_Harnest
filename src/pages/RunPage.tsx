import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { startRun } from "@/lib/api/client";
import { harnestStorage } from "@/lib/api/storage";
import type { RunResult } from "@/lib/api/types";

export function RunPage() {
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentScore = result?.finalScore ?? 0;
  const startScore = result?.startScore ?? 0;
  const acceptedCount =
    result?.nodes.filter((node) => node.status === "accepted" && node.round > 0).length ?? 0;
  const rejectedCount = result?.nodes.filter((node) => node.status === "rejected").length ?? 0;

  useEffect(() => {
    queueMicrotask(() => {
      const cachedResult = harnestStorage.getRunResult();

      if (cachedResult) {
        setResult(cachedResult);
        return;
      }

      const loopSpec = harnestStorage.getLoopSpec();

      if (!loopSpec) {
        setError("실행할 loop spec이 없습니다. 인터뷰와 평가 기준 승인을 먼저 완료하세요.");
        return;
      }

      startRun(loopSpec)
        .then((runResult) => {
          harnestStorage.setRunResult(runResult);
          setResult(runResult);
        })
        .catch(() => {
          setError("Lite 실행을 시작하지 못했습니다. FastAPI 서버 상태를 확인하세요.");
        });
    });
  }, []);

  return (
    <AppShell activeStep="run">
      <section className="run-page">
        <div className="run-hero">
          <div>
            <p className="eyebrow">Browser loop running</p>
            <h1>자소서 매칭 루프가 웹에서 실행 중입니다</h1>
            <p>
              승인된 평가 기준은 잠긴 상태로 유지되고, AI는 후보를 만들고 채점한 뒤
              점수가 오른 수정만 다음 기준선으로 채택합니다.
            </p>
          </div>
          <div className="run-summary">
            <div>
              <span>현재 점수</span>
              <strong>{result ? currentScore : "--"}</strong>
              <small>/100</small>
            </div>
            <div>
              <span>시작 대비</span>
              <strong>{result ? `+${currentScore - startScore}` : "--"}</strong>
              <small>{acceptedCount} kept edits</small>
            </div>
          </div>
        </div>
        {error ? <p className="error-text">{error}</p> : null}

        <div className="run-layout">
          <section className="section-block timeline-panel">
            <div className="section-heading">
              <p className="eyebrow">Experiment trail</p>
              <h2 className="section-title">채택된 수정만 본선으로 이어집니다</h2>
            </div>
            <div className="event-list">
              {(result?.nodes ?? []).map((event) => (
                <div className={`event-row ${event.status}`} key={event.id}>
                  <span className="event-id">#{event.round}</span>
                  <div>
                    <strong>{event.title}</strong>
                    <p>
                      {event.status === "rejected"
                        ? "폐기됨"
                        : event.status === "running"
                          ? "평가 중"
                          : "채택됨"}
                    </p>
                  </div>
                  <b>{event.score}</b>
                </div>
              ))}
            </div>
          </section>

          <section className="section-block chart-panel">
            <div className="section-heading">
              <p className="eyebrow">Version record</p>
              <h2 className="section-title">아직 저장된 버전 그래프는 없습니다</h2>
            </div>
            <div className="version-note">
              <p>
                현재 Lite 실행은 최종 산출물과 채택 로그만 반환합니다. 실제 개선 곡선은
                라운드별 산출물 버전이 저장된 뒤 표시해야 합니다.
              </p>
              <div className="version-stats">
                <span>
                  시작 점수 <b>{result ? startScore : "--"}</b>
                </span>
                <span>
                  현재 점수 <b>{result ? currentScore : "--"}</b>
                </span>
                <span>
                  채택 <b>{acceptedCount}</b>
                </span>
                <span>
                  폐기 <b>{rejectedCount}</b>
                </span>
              </div>
            </div>
          </section>

          <section className="section-block diff-panel">
            <div className="section-heading">
              <p className="eyebrow">Accepted diff</p>
              <h2 className="section-title">점수를 올린 변경만 보여줍니다</h2>
            </div>
            <div className="diff-text">
              <span>Before</span>
              <p>{result?.diff.before ?? "실행 결과를 기다리는 중입니다."}</p>
              <span>After</span>
              <p>{result?.diff.after ?? "채택된 변경이 생성되면 여기에 표시됩니다."}</p>
            </div>
          </section>

          <aside className="section-block criteria-panel">
            <div className="section-heading">
              <p className="eyebrow">Locked criteria</p>
              <h2 className="section-title">AI가 바꿀 수 없는 기준</h2>
            </div>
            <div className="criteria-mini-list">
              <span>공고 핵심어 반영</span>
              <span>직무 적합도 루브릭</span>
              <span>글자 수 제한</span>
            </div>
            <Link className="primary-button" to="/result">
              결과 확인
            </Link>
          </aside>
        </div>
      </section>
    </AppShell>
  );
}
