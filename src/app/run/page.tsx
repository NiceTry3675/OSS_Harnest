"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { startRun } from "@/lib/api/client";
import { harnestStorage } from "@/lib/api/storage";
import type { RunResult } from "@/lib/api/types";

export default function RunPage() {
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentScore = result?.finalScore ?? 0;
  const startScore = result?.startScore ?? 0;
  const acceptedCount =
    result?.nodes.filter((node) => node.status === "accepted" && node.round > 0).length ?? 0;
  const chartPoints = buildChartPoints(result);
  const chartPointString = chartPoints.map((point) => `${point.x},${point.y}`).join(" ");

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
              <p className="eyebrow">Score curve</p>
              <h2 className="section-title">개선 곡선</h2>
            </div>
            <svg className="score-chart" viewBox="0 0 640 300" role="img">
              <title>
                {result
                  ? `${result.startScore}점에서 ${result.finalScore}점까지 개선되는 점수 그래프`
                  : "실행 결과를 기다리는 점수 그래프"}
              </title>
              <line className="chart-axis" x1="44" x2="596" y1="238" y2="238" />
              <polyline className="chart-line" points={chartPointString} />
              {chartPoints.map(({ label, x, y }) => (
                <g key={`${label}-${x}`}>
                  <circle className="chart-dot" cx={x} cy={y} r="7" />
                  <text x={x + 12} y={y - 12}>
                    {label}
                  </text>
                </g>
              ))}
            </svg>
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
            <Link className="primary-button" href="/result">
              결과 확인
            </Link>
          </aside>
        </div>
      </section>
    </AppShell>
  );
}

function buildChartPoints(result: RunResult | null) {
  const acceptedNodes =
    result?.nodes.filter((node) => node.status === "accepted") ?? [
      { score: 0, round: 0, id: "empty", title: "", status: "accepted" as const, note: "" },
    ];
  const nodeCount = Math.max(acceptedNodes.length, 1);

  return acceptedNodes.map((node, index) => {
    const x = nodeCount === 1 ? 48 : 48 + (548 / (nodeCount - 1)) * index;
    const y = 238 - (Math.min(Math.max(node.score, 0), 100) / 100) * 176;

    return {
      label: String(node.score),
      x: Math.round(x),
      y: Math.round(y),
    };
  });
}
