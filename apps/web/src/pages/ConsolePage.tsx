/** 관제실 — 사용자는 AI와 대화하지 않고 지켜보고 통제한다.
 *  실행 인스턴스는 마운트당 1회 생성(StrictMode 이중 이펙트는 ref로 흡수),
 *  runId는 프로젝트 상태에 보존되어 재진입 시 체크포인트에서 재개된다. */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createLoopRun,
  IndexedDbCheckpointStore,
  type CheckpointStore,
  type LoopHandle,
  type LoopRunOptions,
} from "@harnest/loop-engine";
import {
  initialTimetable,
  mutate,
  score,
  type Timetable,
} from "@harnest/template-timetable";
import { useProject } from "../state";
import { CurveChart } from "../components/CurveChart";
import { ExperimentTree } from "../components/ExperimentTree";

const STATUS_LABEL: Record<string, string> = {
  idle: "대기",
  running: "실행 중",
  paused: "일시정지",
  done: "완료",
};

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="grow">
      <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

export function ConsolePage() {
  const { compiled, approvedAt, runId, setRunId, checkpoint, setCheckpoint } = useProject();
  const navigate = useNavigate();
  const [runError, setRunError] = useState<string | null>(null);
  const handleRef = useRef<LoopHandle | null>(null);
  // 재진입이면 기존 runId로 재개, 최초 진입이면 새로 발급
  const runIdRef = useRef<string>(runId ?? crypto.randomUUID());

  const ready = compiled !== null && approvedAt !== null;

  useEffect(() => {
    if (ready && runId === null) setRunId(runIdRef.current);
  }, [ready, runId, setRunId]);

  useEffect(() => {
    if (!compiled || !approvedAt || handleRef.current !== null) return;
    const { problem, pack, loopSpec } = compiled;
    const store: CheckpointStore<Timetable> = new IndexedDbCheckpointStore();
    const options: LoopRunOptions<Timetable> = {
      runId: runIdRef.current,
      pack,
      spec: loopSpec,
      scorer: (tt) => score(problem, tt),
      generate: (champion, rng) => mutate(problem, champion, rng),
      initial: (rng) => initialTimetable(problem, rng),
      store,
      onEvent: (cp) => setCheckpoint(cp),
      roundDelayMs: 120,
    };
    handleRef.current = createLoopRun(options);
  }, [compiled, approvedAt, setCheckpoint]);

  useEffect(() => () => handleRef.current?.pause(), []);

  const adopted = useMemo(
    () => new Set((checkpoint?.tree ?? []).filter((r) => r.adopted).map((r) => r.round)),
    [checkpoint],
  );

  if (!ready) {
    return (
      <div>
        <h1>관제실</h1>
        <div className="card">
          <p className="sub">
            실행 전에 채점 기준을 확인하고 승인해야 합니다. 승인된 기준만이 실행에 쓰이며,
            실행 중에는 변경되지 않습니다.
          </p>
          <button className="primary" onClick={() => navigate(compiled ? "/approve" : "/wizard")}>
            {compiled ? "승인 화면으로 이동" : "프로젝트 설정부터 시작"}
          </button>
        </div>
      </div>
    );
  }

  const status = checkpoint?.status ?? "idle";
  const start = () => {
    setRunError(null);
    handleRef.current
      ?.start()
      .catch((e: unknown) => setRunError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <div>
      <h1>관제실</h1>
      <p className="sub">
        채점 기준은 당신이 승인했고, 실행 중 AI는 이 기준을 변경할 수 없습니다.{" "}
        <span className="lock-badge">기준 동결</span>{" "}
        <span className="mono digest">{compiled.pack.definitionDigest.slice(0, 16)}…</span>
      </p>

      <div className="card">
        <div className="row">
          <Stat
            label="라운드"
            value={`${checkpoint?.round ?? 0} / ${compiled.loopSpec.maxRounds}`}
          />
          <Stat label="상태" value={STATUS_LABEL[status] ?? status} />
          <Stat
            label="현재 챔피언 점수"
            value={checkpoint ? `${fmt(checkpoint.championScore)}점` : "—"}
          />
          <Stat
            label="기준선(라운드 0) 점수"
            value={
              checkpoint && checkpoint.curve.length > 0 ? `${fmt(checkpoint.curve[0])}점` : "—"
            }
          />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button className="primary" onClick={start} disabled={status !== "idle"}>
            실행 시작
          </button>
          <button onClick={() => handleRef.current?.pause()} disabled={status !== "running"}>
            일시정지
          </button>
          <button onClick={start} disabled={status !== "paused"}>
            재개
          </button>
          {status === "done" && (
            <button className="primary" onClick={() => navigate("/results")}>
              결과 보기
            </button>
          )}
        </div>
        {runError !== null && (
          <p className="error" style={{ marginBottom: 0 }}>
            실행 오류: {runError}
          </p>
        )}
      </div>

      <div className="card">
        <CurveChart curve={checkpoint?.curve ?? []} adopted={adopted} xMax={compiled.loopSpec.maxRounds} />
      </div>

      <div className="card">
        <h2 style={{ margin: "0 0 10px", fontSize: 14, color: "var(--ink-2)" }}>실험 기록</h2>
        <ExperimentTree tree={checkpoint?.tree ?? []} />
      </div>
    </div>
  );
}
