import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { uploadRunResult } from "@/lib/api/client";
import { harnestStorage } from "@/lib/api/storage";
import type { RunResult } from "@/lib/api/types";

export function ResultPage() {
  const [result, setResult] = useState<RunResult | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      const cachedResult = harnestStorage.getRunResult();
      setResult(cachedResult);

      if (cachedResult) {
        uploadRunResult(cachedResult).catch(() => {
          // Result upload is non-blocking in the Lite E2E flow.
        });
      }
    });
  }, []);

  const startScore = result?.startScore ?? 62;
  const finalScore = result?.finalScore ?? 78;
  const acceptedCount =
    result?.nodes.filter((node) => node.status === "accepted" && node.round > 0).length ?? 2;

  return (
    <AppShell activeStep="result">
      <section className="page-frame">
        <div className="panel">
          <div className="panel-header">
            <p className="eyebrow">Final result</p>
            <h1 className="title">
              {startScore}점에서 시작한 초안이 {finalScore}점까지 개선됐습니다.
            </h1>
          </div>
          <div className="panel-body template-grid">
            <article className="metric-card">
              <strong>최종 결과물</strong>
              <p>{result?.finalArtifact ?? "실행 결과가 생성되면 최종 산출물이 표시됩니다."}</p>
            </article>
            <article className="metric-card">
              <strong>홀드아웃 점수</strong>
              <p className="muted">백엔드 loop spec 연동 후 표시 예정</p>
            </article>
            <div className="button-row">
              <Link className="secondary-button" to="/run">
                실행 기록 보기
              </Link>
              <Link className="primary-button" to="/">
                새 작업 시작
              </Link>
            </div>
          </div>
        </div>
        <aside className="panel blueprint">
          <div className="panel-header">
            <p className="eyebrow">Improvement record</p>
            <h2 className="section-title">어떤 기준으로 좋아졌는지 함께 남깁니다</h2>
          </div>
          <div className="panel-body metric-grid">
            <div className="blueprint-item">
              <strong>시작 점수</strong>
              <span>{startScore}</span>
            </div>
            <div className="blueprint-item">
              <strong>최종 점수</strong>
              <span>{finalScore}</span>
            </div>
            <div className="blueprint-item">
              <strong>채택된 개선</strong>
              <span>{acceptedCount}회</span>
            </div>
          </div>
        </aside>
      </section>
    </AppShell>
  );
}
