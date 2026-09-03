/** 관제실 — 사용자는 AI와 대화하지 않고 지켜보고 통제한다.
 *  템플릿 접점은 등록소(getTemplate) 인터페이스뿐 — 템플릿별 분기 코드를 두지 않는다.
 *  실행 자체는 이 화면이 아니라 프로젝트의 run 컨트롤러가 소유한다: 라우트를 벗어나도 실행은
 *  계속되고, 돌아오면 같은 세션에 다시 붙는다(같은 라운드를 두 번 돌리지 않는다). 이 화면은
 *  구독·표시·버튼만 맡고, 이탈은 정지 요청이 아니므로 언마운트 시 pause()를 부르지 않는다.
 *  runId는 프로젝트 상태에 보존되어 재진입 시 체크포인트에서 재개된다.
 *  홀드아웃 채점은 라운드 0과 종료 시에만(컨트롤러) — 결과는 표시 전용, 루프 제어에 절대
 *  유입되지 않는다(SPEC §3 원칙 7). */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import { CallBudgetExceededError, GradeFormatError } from "@harnest/contracts";
import { CheckpointSaveError } from "@harnest/loop-engine";
import { useProject, type HoldoutEvaluation } from "../state";
import { getTemplate } from "../templates";
import {
  getByoCredential,
  normalizeVertexServiceAccount,
  setByoCredential,
  testByoConnection,
} from "../lib/llm";
import { markUnavailableRestoredHoldout } from "../lib/project-snapshot";
import { isHoldoutSettled } from "../lib/project-export";
import { createCheckpointNarrator, narrateRuntime } from "../lib/runNarration";
import { ActivityConsole } from "../components/ActivityConsole";
import { clearStream, withActivityLog } from "../lib/activityLog";
import { setFlowStep } from "../lib/flowStep";
import { ScoreHero } from "../components/ScoreHero";
import { CurveChart } from "../components/CurveChart";
import { ExperimentTree } from "../components/ExperimentTree";
import { ErrorNote } from "../components/ErrorNote";
import { ProviderCredentialInput } from "../components/ProviderCredentialInput";

const STATUS_LABEL: Record<string, string> = {
  idle: "개선 준비",
  running: "개선 중…",
  paused: "개선 일시정지",
  done: "개선 완료",
};

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** 오류 종류는 계약 타입으로만 판별한다 — 템플릿이 만든 메시지 문자열 매칭 금지(경계 원칙).
 *  hasSavedRound: 저장된 회차가 하나라도 있는지 — 라운드 0 첫 커밋 실패면 '저장된 회차부터'가 성립하지
 *  않으므로 재시도 안내는 아래 원샷 보유 힌트(pendingInitial)가 맡는다. */
function describeRunError(e: unknown, hasSavedRound: boolean): string {
  if (e instanceof CallBudgetExceededError) {
    return `${e.message} 비용 보호를 위한 실행 한도이며, 정상 실행에서는 도달하지 않습니다.`;
  }
  if (e instanceof GradeFormatError) return e.message;
  if (e instanceof CheckpointSaveError) {
    const resume = hasSavedRound ? " 다시 시도하면 마지막으로 저장된 회차부터 이어집니다." : "";
    return `이 회차 결과를 브라우저에 저장하지 못했습니다(저장 공간을 확인해 주세요).${resume} (${e.message})`;
  }
  const message = e instanceof Error ? e.message : String(e);
  return `모델 호출 중 오류가 발생했습니다: ${message}`;
}

function holdoutLabel(result: HoldoutEvaluation, phase: string): string {
  return result.gateRejected
    ? `최종 확인(${phase}): 필수 조건 위반 — 점수 없음`
    : `최종 확인(${phase}): ${fmt(result.score)}점`;
}

export function ConsolePage() {
  const {
    templateId,
    compiled,
    approvedDigest,
    approvedAt,
    runId,
    setRunId,
    checkpoint,
    setCheckpoint,
    interruptedRunId,
    dismissInterruptedRun,
    holdout,
    setHoldout,
    run,
    checkpointStore,
    readOnly,
  } = useProject();
  const navigate = useNavigate();
  const entry = getTemplate(templateId);

  /** 실행 준비(모델 구성) 실패 — 카드로 표시하고 키 저장 후 재시도할 수 있다 */
  const [setupError, setSetupError] = useState<string | null>(null);
  /** 저장본 읽기 실패·판정 절차 불일치 — 실행 오류와 별개 */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [credentialInput, setCredentialInput] = useState(() => {
    const procedure = compiled?.pack.judgeProcedure;
    if (
      procedure?.kind === "case_answering" &&
      procedure.judge.provider !== "mock" &&
      procedure.judge.provider !== "vertex"
    ) {
      return getByoCredential(procedure.judge.provider) ?? "";
    }
    return "";
  });
  const [credentialBusy, setCredentialBusy] = useState(false);
  const [storedVertexCredential, setStoredVertexCredential] = useState<string | null>(() =>
    getByoCredential("vertex"),
  );
  const [retryTick, setRetryTick] = useState(0);

  // 재진입이면 기존 runId로 재개, 최초 진입이면 새로 발급
  const runIdRef = useRef<string>(runId ?? crypto.randomUUID());
  const digest = compiled?.pack.definitionDigest ?? null;
  // 실행 세션 — 프로젝트 수명에 묶여 있고, 여기서는 구독만 한다
  const session = useSyncExternalStore(run.subscribe, () =>
    digest === null ? null : run.get(runIdRef.current, digest),
  );
  const active = session?.active ?? false;
  const runError = session?.error ?? null;
  const pendingInitial = session?.pendingInitial ?? false;

  const ready =
    entry !== null &&
    compiled !== null &&
    approvedAt !== null &&
    approvedDigest === compiled.pack.definitionDigest;

  useEffect(() => {
    setFlowStep({ kind: "run" });
    // 승인 화면에서 흐르던 글이 이어지지 않게 한다 — 단, 살아 있는 실행의 서술은 지우지 않는다
    if (!active) clearStream();
    // eslint 미사용 — 마운트 시점의 active만 본다
  }, []);

  useEffect(() => {
    if (ready && runId === null) setRunId(runIdRef.current);
  }, [ready, runId, setRunId]);

  // 저장본을 화면에 투영한다 — 살아 있는 세션이 없을 때만. 세션이 살아 있으면 Provider 상태가
  // 엔진 통지로 이미 최신이고, 저장본의 running을 paused로 바꿔 보이면 안 된다(이중 재개 유도).
  useEffect(() => {
    if (!ready || runId === null || !compiled) return;
    const packDigest = compiled.pack.definitionDigest;
    if (run.get(runId, packDigest)?.active) return;
    let cancelled = false;
    void checkpointStore
      .load(runId)
      .then((saved) => {
        if (cancelled || saved === null || run.get(runId, packDigest)?.active) return;
        if (saved.packDigest !== packDigest) {
          setLoadError(
            "저장된 진행 상태의 평가 구성이 현재 승인본과 다릅니다. 다시 승인해야 이어갈 수 있습니다.",
          );
          return;
        }
        // 탭 회수로 남은 running 체크포인트는 화면에서 재개 가능한 상태로 투영한다. '탭이 닫혀 …'
        // 안내는 여기서 판단하지 않는다 — 세션 확보 effect가 같은 커밋에서 세션을 만들므로 이 시점의
        // 세션 유무로는 탭 회수를 가릴 수 없다. 탭 회수인지는 Provider가 복원 시점에 기록한다
        // (interruptedRunId). 세션이 남아 있는 running 저장본은 저장 실패·라운드 오류 뒤의 마지막 성공
        // 커밋이고, 읽기 전용 탭의 running 저장본은 다른 탭이 지금 돌리고 있는 것이다.
        const restored = saved.status === "running" ? { ...saved, status: "paused" as const } : saved;
        setCheckpoint(restored);
        // 화면 이탈 중 라운드 0이 지나갔다면 원샷 산출물은 더 이상 복원할 수 없다.
        // 명시적 실패로 정리해 종료 홀드아웃까지 끝난 뒤 결과 기록이 영구 대기하지 않게 한다.
        setHoldout((prev) =>
          markUnavailableRestoredHoldout(prev, restored, compiled.pack.holdoutPolicy.mode !== "none"),
        );
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [ready, runId, compiled, run, checkpointStore, setCheckpoint, setHoldout]);

  // 세션 확보 — 같은 runId+packDigest에 이미 있으면 그대로 붙는다(StrictMode 이중 이펙트 포함).
  // 승인·동결된 팩의 저지 선언과 실행 모델이 어긋나면 build가 throw — 재승인 원칙.
  // 읽기 전용 탭은 세션을 만들지 않는다 — 세션 생성의 완료본 복구 경로가 홀드아웃 채점(모델 호출)을
  // 내는데, 소유 탭이 같은 채점을 돌리고 있을 수 있고 이 탭의 결과는 저장되지 않는다. 표시는
  // 위의 저장본 투영만으로 충분하다.
  useEffect(() => {
    if (!ready || !entry || !compiled || readOnly) return;
    try {
      run.ensure({
        runId: runIdRef.current,
        pack: compiled.pack,
        spec: compiled.loopSpec,
        store: checkpointStore,
        build: () => {
          const raw = entry.createLlm(compiled);
          const llm = raw ? withActivityLog(raw, "결과물을 만들고 평가하는 중") : raw;
          return narrateRuntime(entry.createRuntime(compiled, llm), compiled.pack);
        },
        narrate: createCheckpointNarrator(),
      });
      setSetupError(null);
    } catch (e) {
      setSetupError(e instanceof Error ? e.message : String(e));
    }
  }, [ready, entry, compiled, readOnly, retryTick, run, checkpointStore]);

  const adopted = useMemo(
    () => new Set((checkpoint?.tree ?? []).filter((r) => r.adopted).map((r) => r.round)),
    [checkpoint],
  );

  if (!ready) {
    return (
      <div>
        <h1>실행</h1>
        <div className="card">
          <p className="sub">
            실행하기 전에 채점 기준을 확인하고 승인해야 합니다. 승인된 기준만 사용하며,
            실행 중에는 바뀌지 않습니다.
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

  const savedStatus = checkpoint?.status ?? "idle";
  // 살아 있는 세션이면 running, 아니면 저장본 그대로 — 단 저장본의 running은 죽은 흔적이므로 paused
  const status = active ? "running" : savedStatus === "running" ? "paused" : savedStatus;
  // 아직 첫 채점이 끝나지 않은 구간 — 사용자에게는 이미 돌고 있는 상태로 보여야 한다
  const preparing = active && checkpoint === null;
  const baselineHoldoutError = holdout.errors?.baseline ?? null;
  const finalHoldoutError = holdout.errors?.final ?? null;
  const holdoutSettled = isHoldoutSettled(compiled.pack, holdout);
  const saveFailed = runError instanceof CheckpointSaveError;
  const callsPerRound = session?.callsPerRound ?? 0;
  const maxCallsPerRun = session?.maxCallsPerRun ?? 0;
  const start = () => {
    if (active || readOnly) return; // 두 번 눌려 실행이 겹치는 것을 막는다
    // 재개하면 '탭이 닫혀 …' 안내는 끝난 일이다 — 이후의 일시정지에 다시 붙지 않게 지운다
    dismissInterruptedRun();
    // 새 실행은 항상 빈 화면에서 시작한다 — 지난 기록이 이어지면 읽을 수 없다
    clearStream(checkpoint === null ? "처음 산출물을 만드는 중" : "이어서 실행하는 중");
    void run.start(runIdRef.current, compiled.pack.definitionDigest);
  };
  const pause = () => run.pause(runIdRef.current, compiled.pack.definitionDigest);
  const retrySetup = async (): Promise<void> => {
    if (readOnly) return; // 읽기 전용 탭은 연결 확인 호출도 내지 않는다(SPEC §4.2)
    const raw = credentialInput.trim();
    const jp = compiled.pack.judgeProcedure;
    setCredentialBusy(true);
    try {
      if (raw && jp.kind === "case_answering" && jp.judge.provider !== "mock") {
        await testByoConnection(jp.judge.provider, raw, jp.judge.model);
        const saved =
          jp.judge.provider === "vertex" ? normalizeVertexServiceAccount(raw) : raw;
        setByoCredential(jp.judge.provider, saved);
        if (jp.judge.provider === "vertex") {
          setStoredVertexCredential(saved);
          setCredentialInput("");
        }
      }
      setSetupError(null);
      setRetryTick((t) => t + 1);
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : String(error));
    } finally {
      setCredentialBusy(false);
    }
  };

  return (
    <div>
      <h1>실행</h1>
      <p className="sub">
        AI가 결과물을 만들고 평가하는 동안, 승인한 평가 구성은 바뀌지 않습니다.{" "}
        <span className="lock-badge">평가 구성 적용 중</span>{" "}
        <span className="mono digest">{compiled.pack.definitionDigest.slice(0, 16)}…</span>
      </p>

      {/* 오류 문구는 항상 마운트된 alert 영역에 갈아 끼운다 — 조건부 카드 안에 두면 카드와 함께
          삽입되어 보조기기가 첫 문구를 놓친다(ErrorNote의 전제). 카드에는 조치 UI만 남긴다 */}
      <ErrorNote message={setupError} />
      {setupError !== null && (
        <div className="card" style={{ borderColor: "var(--bad)" }}>
          <div className="field">
            <label>AI 모델 연결 정보</label>
            {compiled.pack.judgeProcedure.kind === "case_answering" &&
            compiled.pack.judgeProcedure.judge.provider !== "mock" ? (
              <ProviderCredentialInput
                provider={compiled.pack.judgeProcedure.judge.provider}
                value={credentialInput}
                storedCredential={
                  compiled.pack.judgeProcedure.judge.provider === "vertex"
                    ? storedVertexCredential
                    : null
                }
                idPrefix="console-retry"
                disabled={credentialBusy}
                onChange={setCredentialInput}
                onDelete={() => {
                  const provider = compiled.pack.judgeProcedure;
                  if (provider.kind !== "case_answering" || provider.judge.provider === "mock") return;
                  setByoCredential(provider.judge.provider, null);
                  setCredentialInput("");
                  if (provider.judge.provider === "vertex") setStoredVertexCredential(null);
                }}
                onError={setSetupError}
              />
            ) : null}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="primary"
              disabled={credentialBusy || readOnly}
              onClick={() => void retrySetup()}
            >
              {credentialBusy ? "연결 확인 중…" : "연결 확인 후 다시 시도"}
            </button>
            <button onClick={() => navigate("/wizard")}>평가 구성 다시 설정</button>
          </div>
          <p className="hint" style={{ marginBottom: 0 }}>
            연결 정보가 없으면 모의 모델로 평가 구성을 다시 승인하세요. 승인된 평가 구성은
            여기서 바꿀 수 없습니다.
          </p>
        </div>
      )}

      <ScoreHero
        score={checkpoint ? checkpoint.championScore : null}
        baseline={checkpoint && checkpoint.curve.length > 0 ? checkpoint.curve[0] : null}
        round={checkpoint?.round ?? 0}
        maxRounds={compiled.loopSpec.maxRounds}
        statusLabel={preparing ? "개선 준비 중…" : (STATUS_LABEL[status] ?? status)}
        running={active}
      />

      <div className="card">
        {checkpoint !== null && (checkpoint.championGuardScore ?? null) !== null && (
          <div>
            <span className="badge">중간 점검: {fmt(checkpoint.championGuardScore!)}점</span>
            <span className="hint" style={{ marginLeft: 4 }}>
              개선안이 기존 결과보다 크게 나빠지지 않았는지 확인한 점수입니다.
            </span>
          </div>
        )}
        {holdout.baseline !== null && (
          <div style={{ marginTop: 10 }}>
            <span className={holdout.baseline.gateRejected ? "badge muted" : "badge"}>
              {holdoutLabel(holdout.baseline, "시작")}
            </span>
            {baselineHoldoutError !== null && (
              <span className="hint" style={{ marginLeft: 4 }}>
                시작할 때 최종 확인 채점 오류: {baselineHoldoutError}
              </span>
            )}
          </div>
        )}
        {holdout.baseline === null && baselineHoldoutError !== null && (
          <p className="hint" style={{ marginBottom: 0 }}>
            시작할 때 최종 확인 채점 오류: {baselineHoldoutError} (표시할 숫자만 빠졌고 개선 결과에는 영향 없음)
          </p>
        )}
        {finalHoldoutError !== null && (
          <p className="hint" style={{ marginBottom: 0 }}>
            끝날 때 최종 확인 채점 오류: {finalHoldoutError} (표시할 숫자만 빠졌고 개선 결과에는 영향 없음)
          </p>
        )}
        {callsPerRound > 0 && (
          <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
            회차당 AI 요청 약 {callsPerRound}회 · 최대 {compiled.loopSpec.maxRounds}회 개선
            {maxCallsPerRun > 0 ? ` · 실행 1회 AI 요청 한도 ${maxCallsPerRun}회` : ""}
          </p>
        )}
        {/* 탭 회수 안내 — Provider가 복원 시점에 기록한 runId가 이 실행일 때만(읽기 전용 탭 제외) */}
        {interruptedRunId !== null &&
          interruptedRunId === runId &&
          !readOnly &&
          checkpoint !== null &&
          status === "paused" && (
          <p className="hint" style={{ marginBottom: 0 }}>
            탭이 닫혀 진행 중이던 회차는 저장되지 않았습니다. 재개하면 {checkpoint.round + 1}회차를
            다시 돕니다.
          </p>
        )}
        {readOnly && (
          <p className="hint" style={{ marginBottom: 0 }}>
            다른 탭에서 이 프로젝트를 편집·실행 중이라 이 탭에서는 시작·재개할 수 없습니다. 그 탭을
            닫은 뒤 이 탭을 새로고침하면 이어서 작업할 수 있습니다.
          </p>
        )}
        <div className="run-controls">
          <button
            className="primary"
            onClick={start}
            disabled={readOnly || active || status !== "idle" || setupError !== null}
          >
            {preparing ? "준비 중…" : "시작"}
          </button>
          <button onClick={pause} disabled={!active}>
            일시정지
          </button>
          <button
            onClick={start}
            disabled={readOnly || active || status !== "paused" || setupError !== null}
          >
            재개
          </button>
          {status === "done" && holdoutSettled && (
            <button className="primary" onClick={() => navigate("/results")}>
              결과 보기
            </button>
          )}
          {status === "done" && !holdoutSettled && (
            <button disabled>최종 확인 채점 중…</button>
          )}
        </div>
      </div>

      <ErrorNote message={loadError} />
      <ErrorNote
        message={runError !== null && !active ? describeRunError(runError, checkpoint !== null) : null}
      />

      {runError !== null && !active && (
        <div className="card" style={{ borderColor: "var(--bad)" }}>
          {checkpoint !== null && !saveFailed && (
            <p className="hint">진행 상태가 저장되었습니다. 다시 시도하면 이어집니다.</p>
          )}
          {/* 원샷 산출물은 핸들(이 세션) 안에만 남는다 — 채점·저장 단계 실패였고 새로고침 전이면
              재생성 없이 채점부터, 원샷 생성 자체가 실패했으면 처음부터 다시 만든다. 라운드 0 첫 커밋
              실패(saveFailed)도 같은 안내다 — 저장된 회차가 없고 원샷은 핸들에 남아 있다 */}
          {checkpoint === null && pendingInitial && (
            <p className="hint">
              아직 저장된 회차가 없습니다. 새로고침 전까지는 다시 시도해도 처음 산출물을 다시 만들지
              않고 채점부터 이어갑니다.
            </p>
          )}
          {checkpoint === null && !pendingInitial && (
            <p className="hint">
              아직 저장된 회차가 없습니다. 다시 시도하면 처음 산출물부터 다시 만듭니다(추가 비용 발생).
            </p>
          )}
          <button onClick={start} disabled={readOnly || active}>다시 시도</button>
        </div>
      )}

      {/* 점수·곡선은 왼쪽, 회차 기록은 오른쪽 — 한 화면에서 같이 읽힌다 */}
      <div className="deck">
        <div className="deck-main">
          <CurveChart
            curve={checkpoint?.curve ?? []}
            adopted={adopted}
            // 실행 중에만 축을 최대 회차로 고정한다 — 끝난 뒤에는 빈 오른쪽을 남기지 않는다
            xMax={status === "running" ? compiled.loopSpec.maxRounds : undefined}
            live={status === "running"}
          />
        </div>
        <div className="deck-side">
          <h2 className="deck-h">시도한 기록</h2>
          <ExperimentTree tree={checkpoint?.tree ?? []} />
        </div>
      </div>

      {/* 점수·기록을 먼저 읽고, 그 판단의 근거를 아래에서 본다 */}
      <ActivityConsole
        model={
          compiled.pack.judgeProcedure.kind === "case_answering"
            ? compiled.pack.judgeProcedure.judge.model
            : undefined
        }
        empty="개선을 시작하면 AI 작업 내용과 회차별 평가 결과가 여기에 표시됩니다."
        height={440}
      />
    </div>
  );
}
