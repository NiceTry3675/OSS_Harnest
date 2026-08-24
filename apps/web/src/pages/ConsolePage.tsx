/** 관제실 — 사용자는 AI와 대화하지 않고 지켜보고 통제한다.
 *  템플릿 접점은 등록소(getTemplate) 인터페이스뿐 — 템플릿별 분기 코드를 두지 않는다.
 *  실행 인스턴스는 마운트당 1회 생성(StrictMode 이중 이펙트는 ref로 흡수),
 *  runId는 프로젝트 상태에 보존되어 재진입 시 체크포인트에서 재개된다.
 *  홀드아웃 채점은 라운드 0과 종료 시에만 — 결과는 표시 전용, 루프 제어에 절대 유입되지 않는다
 *  (SPEC §3 원칙 7). */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GradeFormatError, type LoopCheckpoint } from "@harnest/contracts";
import {
  createLoopRun,
  IndexedDbCheckpointStore,
  type CheckpointStore,
  type LoopHandle,
  type LoopRunOptions,
} from "@harnest/loop-engine";
import { useProject, type HoldoutEvaluation, type HoldoutScores } from "../state";
import { getTemplate, type TemplateRuntime } from "../templates";
import { setByoKey } from "../lib/llm";
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

/** 오류 종류는 계약 타입으로만 판별한다 — 템플릿이 만든 메시지 문자열 매칭 금지(경계 원칙). */
function describeRunError(e: unknown): string {
  if (e instanceof GradeFormatError) return e.message;
  const message = e instanceof Error ? e.message : String(e);
  return `AI를 부르는 중 문제가 생겼습니다: ${message}`;
}

function holdoutLabel(result: HoldoutEvaluation, phase: string): string {
  return result.gateRejected
    ? `숨겨둔 질문(${phase}): 분량을 넘겨 탈락 — 점수를 매기지 않음`
    : `숨겨둔 질문(${phase}): ${fmt(result.score)}점`;
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
  const {
    templateId,
    compiled,
    approvedAt,
    runId,
    setRunId,
    checkpoint,
    setCheckpoint,
    holdout,
    setHoldout,
  } = useProject();
  const navigate = useNavigate();
  const entry = getTemplate(templateId);

  /** 실행 준비(모델 구성) 실패 — 카드로 표시하고 키 저장 후 재시도할 수 있다 */
  const [setupError, setSetupError] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [retryTick, setRetryTick] = useState(0);
  /** 실행 중 오류 — 체크포인트가 남아 있으므로 재시도는 start() 재호출로 이어서 진행 */
  const [runError, setRunError] = useState<string | null>(null);
  const [holdoutError, setHoldoutError] = useState<string | null>(null);
  const [callsPerRound, setCallsPerRound] = useState<number>(0);

  const handleRef = useRef<LoopHandle | null>(null);
  const storeRef = useRef<CheckpointStore<unknown> | null>(null);
  if (storeRef.current === null) storeRef.current = new IndexedDbCheckpointStore();
  // 재진입이면 기존 runId로 재개, 최초 진입이면 새로 발급
  const runIdRef = useRef<string>(runId ?? crypto.randomUUID());
  // 홀드아웃 진행 상태 — onEvent 클로저에서 최신값을 보기 위한 ref (표시 전용 데이터)
  const holdoutRef = useRef<HoldoutScores>({ ...holdout });
  const baselineStartedRef = useRef(false);
  const finalStartedRef = useRef(false);

  const ready = entry !== null && compiled !== null && approvedAt !== null;

  useEffect(() => {
    if (ready && runId === null) setRunId(runIdRef.current);
  }, [ready, runId, setRunId]);

  useEffect(() => {
    if (!ready || runId === null || !compiled) return;
    let cancelled = false;
    void storeRef.current!
      .load(runId)
      .then((saved) => {
        if (cancelled || saved === null) return;
        if (saved.packDigest !== compiled.pack.definitionDigest) {
          setRunError(
            "저장된 진행 상황이 지금 승인한 기준과 달라서 이어서 할 수 없습니다 — 다시 승인해 주세요.",
          );
          return;
        }
        // 탭 회수로 남은 running 체크포인트는 화면에서 재개 가능한 상태로 투영한다.
        setCheckpoint(saved.status === "running" ? { ...saved, status: "paused" } : saved);
      })
      .catch((error: unknown) => {
        if (!cancelled) setRunError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [ready, runId, compiled, setCheckpoint]);

  useEffect(() => {
    if (!entry || !compiled || !approvedAt || handleRef.current !== null) return;

    let runtime: TemplateRuntime;
    try {
      // 승인·동결된 팩의 저지 선언과 실행 모델이 어긋나면 여기서 throw — 재승인 원칙
      const llm = entry.createLlm(compiled);
      runtime = entry.createRuntime(compiled, llm);
    } catch (e) {
      setSetupError(e instanceof Error ? e.message : String(e));
      return;
    }
    setSetupError(null);
    setCallsPerRound(runtime.callsPerRound);

    const scoreHoldout = runtime.scoreHoldout;
    const onEvent = (cp: LoopCheckpoint<unknown>): void => {
      setCheckpoint(cp);
      if (!scoreHoldout) return;
      // 홀드아웃은 표시 전용 — 아래 어떤 결과도 루프 제어·Generator로 되돌아가지 않는다
      if (cp.round === 0 && holdoutRef.current.baseline === null && !baselineStartedRef.current) {
        baselineStartedRef.current = true;
        const champion = cp.champion; // 그 시점 챔피언을 지역 캡처(이후 라운드 변이와 격리)
        void scoreHoldout(champion)
          .then((result) => {
            holdoutRef.current = { ...holdoutRef.current, baseline: result };
            setHoldout({ ...holdoutRef.current });
          })
          .catch((e: unknown) =>
            setHoldoutError(e instanceof Error ? e.message : String(e)),
          );
      }
      if (
        cp.status === "done" &&
        holdoutRef.current.final === null &&
        !finalStartedRef.current
      ) {
        finalStartedRef.current = true;
        const champion = cp.champion;
        void scoreHoldout(champion)
          .then((result) => {
            holdoutRef.current = { ...holdoutRef.current, final: result };
            setHoldout({ ...holdoutRef.current });
          })
          .catch((e: unknown) =>
            setHoldoutError(e instanceof Error ? e.message : String(e)),
          );
      }
    };

    const options: LoopRunOptions<unknown> = {
      runId: runIdRef.current,
      pack: compiled.pack,
      spec: compiled.loopSpec,
      scorer: runtime.scorer,
      generate: runtime.generate,
      initial: runtime.initial,
      store: storeRef.current!,
      onEvent,
      roundDelayMs: runtime.roundDelayMs,
    };
    handleRef.current = createLoopRun(options);
    // 완료 직후 홀드아웃 채점 중 새로고침된 경우, 저장된 최종 챔피언으로 종료 채점을 복구한다.
    // round 0이 아니므로 누락된 시작 점수를 최종 문서로 잘못 다시 계산하지는 않는다.
    void storeRef.current!
      .load(runIdRef.current)
      .then((saved) => {
        if (
          saved?.status === "done" &&
          saved.packDigest === compiled.pack.definitionDigest
        ) {
          onEvent(saved);
        }
      })
      .catch((error: unknown) => {
        setRunError(error instanceof Error ? error.message : String(error));
      });
  }, [entry, compiled, approvedAt, retryTick, setCheckpoint, setHoldout]);

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
          <button
            className="primary"
            onClick={() => navigate(entry && compiled ? "/approve" : "/wizard")}
          >
            {entry && compiled ? "승인 화면으로 이동" : "프로젝트 설정부터 시작"}
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
      .catch((e: unknown) => setRunError(describeRunError(e)));
  };
  const retrySetup = () => {
    const key = keyInput.trim();
    const jp = compiled.pack.judgeProcedure;
    if (key.length > 0 && jp.kind === "case_answering" && jp.judge.provider !== "mock") {
      setByoKey(jp.judge.provider, key);
    }
    setSetupError(null);
    setRetryTick((t) => t + 1);
  };

  return (
    <div>
      <h1>관제실</h1>
      <p className="sub">
        채점 기준은 당신이 승인했고, 실행 중 AI는 이 기준을 변경할 수 없습니다.{" "}
        <span className="lock-badge">🔒 기준 잠김</span>
      </p>

      {setupError !== null && (
        <div className="card" style={{ borderColor: "var(--bad)" }}>
          <p className="error" style={{ marginTop: 0 }}>{setupError}</p>
          <div className="field">
            <label htmlFor="byo-key">채점 모델 API 키</label>
            <input
              id="byo-key"
              type="password"
              placeholder="승인된 채점 모델의 API 키를 입력하세요"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
            />
            <p className="hint">
              키는 이 브라우저에만 저장되고 AI 회사로 바로 전송됩니다 — 우리 서버로는
              가지 않습니다.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="primary" onClick={retrySetup}>
              저장 후 다시 시도
            </button>
            <button onClick={() => navigate("/wizard")}>기준 다시 만들기</button>
          </div>
          <p className="hint" style={{ marginBottom: 0 }}>
            키 없이 사용하려면 기준을 처음부터 다시 만들어 모의 모델로 승인해 주세요 — 승인된
            채점 방식은 여기서 바꿀 수 없습니다.
          </p>
        </div>
      )}

      <div className="card">
        <div className="row">
          <Stat
            label="고친 횟수"
            value={`${checkpoint?.round ?? 0} / ${compiled.loopSpec.maxRounds}`}
          />
          <Stat label="상태" value={STATUS_LABEL[status] ?? status} />
          <Stat
            label="현재 최고 점수"
            value={checkpoint ? `${fmt(checkpoint.championScore)}점` : "—"}
          />
          <Stat
            label="처음 점수"
            value={
              checkpoint && checkpoint.curve.length > 0 ? `${fmt(checkpoint.curve[0])}점` : "—"
            }
          />
        </div>
        {holdout.baseline !== null && (
          <div style={{ marginTop: 10 }}>
            <span className={holdout.baseline.gateRejected ? "badge muted" : "badge"}>
              {holdoutLabel(holdout.baseline, "시작")}
            </span>
            {holdoutError !== null && (
              <span className="hint" style={{ marginLeft: 4 }}>
                숨겨둔 질문 채점 중 문제: {holdoutError}
              </span>
            )}
          </div>
        )}
        {holdout.baseline === null && holdoutError !== null && (
          <p className="hint" style={{ marginBottom: 0 }}>
            숨겨둔 질문 채점 중 문제: {holdoutError} (참고 점수만 빠지고 실행에는 영향 없습니다)
          </p>
        )}
        {callsPerRound > 0 && (
          <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
            한 번 고칠 때마다 AI를 약 {callsPerRound}회 부릅니다 · 최대 {compiled.loopSpec.maxRounds}번까지
          </p>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button
            className="primary"
            onClick={start}
            disabled={status !== "idle" || setupError !== null}
          >
            실행 시작
          </button>
          <button onClick={() => handleRef.current?.pause()} disabled={status !== "running"}>
            일시정지
          </button>
          <button onClick={start} disabled={status !== "paused" || setupError !== null}>
            재개
          </button>
          {status === "done" && (
            <button className="primary" onClick={() => navigate("/results")}>
              결과 보기
            </button>
          )}
        </div>
      </div>

      {runError !== null && (
        <div className="card" style={{ borderColor: "var(--bad)" }}>
          <p className="error" style={{ marginTop: 0 }}>{runError}</p>
          <p className="hint">
            지금까지의 진행은 체크포인트에 저장되어 있습니다 — 다시 시도하면 이어서 진행됩니다.
          </p>
          <button onClick={start}>다시 시도</button>
        </div>
      )}

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
