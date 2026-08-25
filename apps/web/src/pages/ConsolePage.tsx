/** 관제실 — 사용자는 AI와 대화하지 않고 지켜보고 통제한다.
 *  템플릿 접점은 등록소(getTemplate) 인터페이스뿐 — 템플릿별 분기 코드를 두지 않는다.
 *  실행 인스턴스는 마운트당 1회 생성(StrictMode 이중 이펙트는 ref로 흡수),
 *  runId는 프로젝트 상태에 보존되어 재진입 시 체크포인트에서 재개된다.
 *  홀드아웃 채점은 라운드 0과 종료 시에만 — 결과는 표시 전용, 루프 제어에 절대 유입되지 않는다
 *  (SPEC §3 원칙 7). */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CallBudgetExceededError,
  GradeFormatError,
  type LoopCheckpoint,
} from "@harnest/contracts";
import {
  createLoopRun,
  IndexedDbCheckpointStore,
  type CheckpointStore,
  type LoopHandle,
  type LoopRunOptions,
} from "@harnest/loop-engine";
import { useProject, type HoldoutEvaluation, type HoldoutScores } from "../state";
import { getTemplate, type TemplateRuntime } from "../templates";
import {
  getByoCredential,
  normalizeVertexServiceAccount,
  setByoCredential,
  testByoConnection,
} from "../lib/llm";
import { markUnavailableRestoredHoldout } from "../lib/project-snapshot";
import { isHoldoutPhasePending, isHoldoutSettled } from "../lib/project-export";
import { ActivityConsole } from "../components/ActivityConsole";
import { appendStream, clearStream, endStream, setStreamStatus, withActivityLog } from "../lib/activityLog";
import { setFlowStep } from "../lib/flowStep";
import { ScoreHero } from "../components/ScoreHero";
import { CurveChart } from "../components/CurveChart";
import { ExperimentTree } from "../components/ExperimentTree";
import { ProviderCredentialInput } from "../components/ProviderCredentialInput";

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
  if (e instanceof CallBudgetExceededError) {
    return `${e.message} 비용 보호를 위한 실행 한도이며, 정상 실행에서는 도달하지 않습니다.`;
  }
  if (e instanceof GradeFormatError) return e.message;
  const message = e instanceof Error ? e.message : String(e);
  return `모델 호출 중 오류가 발생했습니다: ${message}`;
}

function holdoutLabel(result: HoldoutEvaluation, phase: string): string {
  return result.gateRejected
    ? `숨김 검증(${phase}): 분량 게이트 실격 — 점수 미계산`
    : `숨김 케이스(${phase}): ${fmt(result.score)}점`;
}

export function ConsolePage() {
  useEffect(() => {
    setFlowStep({ kind: "run" });
    clearStream(); // 승인 화면에서 흐르던 글이 이어지지 않게 한다
  }, []);

  const {
    templateId,
    compiled,
    approvedDigest,
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
  /** 실행 중 오류 — 체크포인트가 남아 있으므로 재시도는 start() 재호출로 이어서 진행 */
  const [runError, setRunError] = useState<string | null>(null);
  // 라운드 0(원샷)이 끝나야 첫 체크포인트가 나온다. 그때까지 상태가 "대기"로 남아
  // 버튼이 계속 눌리고 화면도 그대로였다 — 누른 사실을 여기서 즉시 붙잡는다.
  const [starting, setStarting] = useState(false);
  const [callsPerRound, setCallsPerRound] = useState<number>(0);
  const [maxCallsPerRun, setMaxCallsPerRun] = useState<number>(0);

  const handleRef = useRef<LoopHandle | null>(null);
  // 같은 회차를 두 번 기록하지 않게 한다 — 체크포인트는 여러 번 올 수 있다
  const lastLoggedRound = useRef<number>(-1);
  const storeRef = useRef<CheckpointStore<unknown> | null>(null);
  if (storeRef.current === null) storeRef.current = new IndexedDbCheckpointStore();
  // 재진입이면 기존 runId로 재개, 최초 진입이면 새로 발급
  const runIdRef = useRef<string>(runId ?? crypto.randomUUID());
  // 홀드아웃 진행 상태 — onEvent 클로저에서 최신값을 보기 위한 ref (표시 전용 데이터)
  const holdoutRef = useRef<HoldoutScores>({
    ...holdout,
    errors: holdout.errors ?? { baseline: null, final: null },
  });
  const baselineStartedRef = useRef(false);
  const finalStartedRef = useRef(false);

  const ready =
    entry !== null &&
    compiled !== null &&
    approvedAt !== null &&
    approvedDigest === compiled.pack.definitionDigest;

  // Provider의 비동기 복원값을 이벤트 클로저에도 반영한다. 특히 지나간 기준선의 명시적
  // 복원 실패가 빈 초기 ref에 덮이지 않아야 한다.
  useEffect(() => {
    holdoutRef.current = {
      ...holdout,
      errors: holdout.errors ?? { baseline: null, final: null },
    };
  }, [holdout]);

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
            "체크포인트의 판정 절차가 현재 승인본과 다릅니다 — 이어받을 수 없습니다(재승인 필요).",
          );
          return;
        }
        // 탭 회수로 남은 running 체크포인트는 화면에서 재개 가능한 상태로 투영한다.
        const restored = saved.status === "running" ? { ...saved, status: "paused" as const } : saved;
        setCheckpoint(restored);
        // 화면 이탈 중 라운드 0이 지나갔다면 원샷 산출물은 더 이상 복원할 수 없다.
        // 명시적 실패로 정리해 종료 홀드아웃까지 끝난 뒤 결과 기록이 영구 대기하지 않게 한다.
        const restoredHoldout = markUnavailableRestoredHoldout(
          holdoutRef.current,
          restored,
          compiled.pack.holdoutPolicy.mode !== "none",
        );
        holdoutRef.current = restoredHoldout;
        setHoldout(restoredHoldout);
      })
      .catch((error: unknown) => {
        if (!cancelled) setRunError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [ready, runId, compiled, setCheckpoint, setHoldout]);

  useEffect(() => {
    if (!ready || !entry || !compiled || handleRef.current !== null) return;

    let active = true;
    const effectRunId = runIdRef.current;
    const effectPackDigest = compiled.pack.definitionDigest;
    const ownsEvent = (cp: LoopCheckpoint<unknown>): boolean =>
      active && cp.runId === effectRunId && cp.packDigest === effectPackDigest;

    let runtime: TemplateRuntime;
    try {
      // 승인·동결된 팩의 저지 선언과 실행 모델이 어긋나면 여기서 throw — 재승인 원칙
      const raw = entry.createLlm(compiled);
      const llm = raw ? withActivityLog(raw, "산출물을 만들고 채점하는 중") : raw;
      // 루프가 무엇을 보고 어떻게 고쳐 쓰는지를 화면으로 흘린다.
      // 생성기는 "지금 산출물이 못 채운 것"을 받아 그것만 보강한다 — 그게 이 루프의 추론이다.
      const base = entry.createRuntime(compiled, llm);
      runtime = {
        ...base,
        generate: async (champion, rng, feedback) => {
          const misses = feedback.championViolations;
          const body =
            misses.length > 0
              ? "지금 산출물이 못 채운 것" + "\n" +
                misses.map((v) => "  · " + v).join("\n") + "\n" + "\n" +
                "이 항목들을 보강해 다시 씁니다. 나머지는 건드리지 않습니다."
              : "지적된 문제가 없습니다. 표현을 더 촘촘히 다듬어 다시 씁니다.";
          appendStream(
            body,
            feedback.round + "회차 — 무엇을 고칠지 정합니다 (현재 " +
              feedback.championScore.toFixed(1) + "점)",
          );
          return base.generate(champion, rng, feedback);
        },
        scorer: async (artifact) => {
          const r = await base.scorer(artifact);
          // 점수만 있으면 "왜 이 숫자인지"를 알 수 없다. 승인된 기준의 이름과 가중치를
          // 함께 붙여, 어떤 기준에 비추어 몇 점이고 합계가 어떻게 나왔는지 드러낸다.
          const scored = Object.entries(r.parts).map(([id, value]) => {
            const def = compiled.pack.criteria.find((c) => c.id === id);
            const label = def?.label ?? id;
            const weight = def?.weight ?? 0;
            return {
              line:
                "기준「" + label + "」" +
                (def ? " 가중치 " + Math.round(weight * 100) + "%" : "") +
                " → " + value.toFixed(1) + "점",
              math: value.toFixed(1) + "×" + weight.toFixed(2),
            };
          });
          const gateNames = compiled.pack.gates.map((g) => "「" + g.label + "」").join(" ");
          const lines = [
            ...scored.map((x) => x.line),
            ...(compiled.pack.gates.length > 0
              ? [
                  "필수 관문" + gateNames + " " +
                    (r.gateRejected ? "위반 — 점수와 무관하게 탈락합니다" : "통과"),
                ]
              : []),
            "합계 " + r.total.toFixed(1) + "점" +
              (scored.length > 1 ? " = " + scored.map((x) => x.math).join(" + ") : ""),
            ...(r.violations.length > 0
              ? ["", "이 기준을 아직 채우지 못한 케이스", ...r.violations.map((v) => "  · " + v)]
              : ["", "기준에 비추어 지적할 것이 없습니다."]),
          ];
          appendStream(lines.join("\n"), "채점 결과");
          return r;
        },
      };
    } catch (e) {
      setSetupError(e instanceof Error ? e.message : String(e));
      return;
    }
    setSetupError(null);
    setCallsPerRound(runtime.callsPerRound);
    setMaxCallsPerRun(runtime.maxCallsPerRun);

    const scoreHoldout = runtime.scoreHoldout;
    const updateHoldout = (next: HoldoutScores): void => {
      if (!active) return;
      holdoutRef.current = next;
      setHoldout(next);
    };
    const onEvent = (cp: LoopCheckpoint<unknown>): void => {
      if (!ownsEvent(cp)) return;
      const last = cp.tree[cp.tree.length - 1];
      if (last !== undefined && last.round !== lastLoggedRound.current) {
        lastLoggedRound.current = last.round;
        const why = last.adopted
          ? "더 나아서 채택"
          : last.gateRejected
            ? "필수 관문에서 실격"
            : !last.guardSafe
              ? "검증 가드가 퇴보해 기각"
              : "기존 산출물이 더 나음";
        // 왜 그렇게 판단했는지를 남긴다 — 점수만으로는 이유를 알 수 없다.
        // 채택 조건은 셋을 모두 넘어야 한다: 필수 관문 · 검증 가드 비퇴보 · 엄격한 점수 개선.
        const gap = last.candidateScore - last.championScore;
        const guard =
          last.candidateGuardScore === null
            ? ""
            : ` 검증 가드는 ${last.candidateGuardScore.toFixed(1)}점으로 ${
                last.guardSafe ? "퇴보하지 않았습니다" : "허용 오차를 넘어 떨어졌습니다"
              }.`;
        const detail = last.gateRejected
          ? "필수 관문을 넘지 못해 점수와 무관하게 탈락했습니다."
          : !last.guardSafe
            ? `점수는 ${last.candidateScore.toFixed(1)}점이지만 숨긴 케이스로 재어 본 검증 가드가 퇴보해 기각합니다 — 눈에 보이는 케이스에만 맞춰 쓴 것으로 봅니다.${guard}`
            : last.adopted
              ? `새 산출물 ${last.candidateScore.toFixed(1)}점이 기존 ${last.championScore.toFixed(1)}점보다 ${gap.toFixed(1)}점 높아 바꿔 답았습니다.${guard}`
              : `새 산출물 ${last.candidateScore.toFixed(1)}점이 기존 ${last.championScore.toFixed(1)}점을 넘지 못해 기존을 유지합니다 — 동점도 바꾸지 않습니다.${guard}`;
        appendStream(detail, `${last.round}회차 판단 — ${why}`);
        setStreamStatus(`${last.round}회차 — ${why}`);
      }
      setCheckpoint(cp);
      if (!scoreHoldout) return;
      // 홀드아웃은 표시 전용 — 아래 어떤 결과도 루프 제어·Generator로 되돌아가지 않는다
      if (
        cp.round === 0 &&
        isHoldoutPhasePending(holdoutRef.current, "baseline") &&
        !baselineStartedRef.current
      ) {
        baselineStartedRef.current = true;
        updateHoldout({
          ...holdoutRef.current,
          errors: { ...(holdoutRef.current.errors ?? { baseline: null, final: null }), baseline: null },
        });
        const champion = cp.champion; // 그 시점 챔피언을 지역 캡처(이후 라운드 변이와 격리)
        void scoreHoldout(champion)
          .then((result) => {
            if (!active) return;
            updateHoldout({
              ...holdoutRef.current,
              baseline: result,
              errors: { ...(holdoutRef.current.errors ?? { baseline: null, final: null }), baseline: null },
            });
          })
          .catch((e: unknown) => {
            if (!active) return;
            updateHoldout({
              ...holdoutRef.current,
              errors: {
                ...(holdoutRef.current.errors ?? { baseline: null, final: null }),
                baseline: e instanceof Error ? e.message : String(e),
              },
            });
          });
      }
      if (
        cp.status === "done" &&
        isHoldoutPhasePending(holdoutRef.current, "final") &&
        !finalStartedRef.current
      ) {
        finalStartedRef.current = true;
        updateHoldout({
          ...holdoutRef.current,
          errors: { ...(holdoutRef.current.errors ?? { baseline: null, final: null }), final: null },
        });
        const champion = cp.champion;
        void scoreHoldout(champion)
          .then((result) => {
            if (!active) return;
            updateHoldout({
              ...holdoutRef.current,
              final: result,
              errors: { ...(holdoutRef.current.errors ?? { baseline: null, final: null }), final: null },
            });
          })
          .catch((e: unknown) => {
            if (!active) return;
            updateHoldout({
              ...holdoutRef.current,
              errors: {
                ...(holdoutRef.current.errors ?? { baseline: null, final: null }),
                final: e instanceof Error ? e.message : String(e),
              },
            });
          });
      }
    };

    const options: LoopRunOptions<unknown> = {
      runId: effectRunId,
      pack: compiled.pack,
      spec: compiled.loopSpec,
      scorer: runtime.scorer,
      generate: runtime.generate,
      initial: runtime.initial,
      store: storeRef.current!,
      onEvent,
      roundDelayMs: runtime.roundDelayMs,
    };
    const handle = createLoopRun(options);
    handleRef.current = handle;
    // 완료 직후 홀드아웃 채점 중 새로고침된 경우, 저장된 챔피언으로 복구 가능한 단계를 채점한다.
    // round 0이면 시작·종료 산출물이 같아 둘 다 복구 가능하고, 이후 라운드는 종료만 복구한다.
    void storeRef.current!
      .load(effectRunId)
      .then((saved) => {
        if (active &&
          saved?.status === "done" &&
          saved.packDigest === effectPackDigest
        ) {
          onEvent(saved);
        }
      })
      .catch((error: unknown) => {
        if (active) setRunError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
      handle.pause();
      if (handleRef.current === handle) handleRef.current = null;
      baselineStartedRef.current = false;
      finalStartedRef.current = false;
    };
  }, [ready, entry, compiled, retryTick, setCheckpoint, setHoldout]);

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
  // 아직 첫 채점이 끝나지 않은 구간 — 사용자에게는 이미 돌고 있는 상태로 보여야 한다
  const preparing = starting && checkpoint === null;
  const baselineHoldoutError = holdout.errors?.baseline ?? null;
  const finalHoldoutError = holdout.errors?.final ?? null;
  const holdoutSettled = isHoldoutSettled(compiled.pack, holdout);
  const start = () => {
    if (starting) return; // 두 번 눌려 실행이 겹치는 것을 막는다
    setRunError(null);
    setStarting(true);
    // 새 실행은 항상 빈 화면에서 시작한다 — 지난 기록이 이어지면 읽을 수 없다
    clearStream(checkpoint === null ? "처음 산출물을 만드는 중" : "이어서 실행하는 중");
    lastLoggedRound.current = -1;
    const handle = handleRef.current;
    if (handle === null) {
      setStarting(false);
      return;
    }
    void handle
      .start()
      .catch((e: unknown) => {
        if (handleRef.current === handle) setRunError(describeRunError(e));
      })
      .finally(() => {
        if (handleRef.current === handle) setStarting(false);
      });
  };
  const retrySetup = async (): Promise<void> => {
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
      <h1>관제실</h1>
      <p className="sub">
        채점 기준은 당신이 승인했고, 실행 중 AI는 이 기준을 변경할 수 없습니다.{" "}
        <span className="lock-badge">기준 동결</span>{" "}
        <span className="mono digest">{compiled.pack.definitionDigest.slice(0, 16)}…</span>
      </p>

      {setupError !== null && (
        <div className="card" style={{ borderColor: "var(--bad)" }}>
          <p className="error" style={{ marginTop: 0 }}>{setupError}</p>
          <div className="field">
            <label>채점 모델 자격 증명</label>
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
            <button className="primary" disabled={credentialBusy} onClick={() => void retrySetup()}>
              {credentialBusy ? "연결 확인 중…" : "연결 확인 후 다시 시도"}
            </button>
            <button onClick={() => navigate("/wizard")}>기준 다시 만들기</button>
          </div>
          <p className="hint" style={{ marginBottom: 0 }}>
            자격 증명 없이 사용하려면 기준을 처음부터 다시 만들어 모의 모델로 승인해 주세요 — 승인된
            판정 절차는 여기서 바꿀 수 없습니다.
          </p>
        </div>
      )}

      <ScoreHero
        score={checkpoint ? checkpoint.championScore : null}
        baseline={checkpoint && checkpoint.curve.length > 0 ? checkpoint.curve[0] : null}
        round={checkpoint?.round ?? 0}
        maxRounds={compiled.loopSpec.maxRounds}
        statusLabel={preparing ? "처음 산출물을 만드는 중" : (STATUS_LABEL[status] ?? status)}
        running={preparing || status === "running"}
      />

      <div className="card">
        {checkpoint !== null && (checkpoint.championGuardScore ?? null) !== null && (
          <div>
            <span className="badge">검증 가드: {fmt(checkpoint.championGuardScore!)}점</span>
            <span className="hint" style={{ marginLeft: 4 }}>
              비공개 검증 케이스 집계 — 이 점수가 퇴보하는 후보는 채택되지 않습니다
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
                시작 홀드아웃 채점 오류: {baselineHoldoutError}
              </span>
            )}
          </div>
        )}
        {holdout.baseline === null && baselineHoldoutError !== null && (
          <p className="hint" style={{ marginBottom: 0 }}>
            시작 홀드아웃 채점 오류: {baselineHoldoutError} (표시용 지표만 누락 — 실행에는 영향 없음)
          </p>
        )}
        {finalHoldoutError !== null && (
          <p className="hint" style={{ marginBottom: 0 }}>
            종료 홀드아웃 채점 오류: {finalHoldoutError} (표시용 지표만 누락 — 실행에는 영향 없음)
          </p>
        )}
        {callsPerRound > 0 && (
          <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
            라운드당 약 {callsPerRound}회 모델 호출 · 최대 {compiled.loopSpec.maxRounds}라운드
            {maxCallsPerRun > 0 ? ` · 실행 1회 호출 예산 ${maxCallsPerRun}회` : ""}
          </p>
        )}
        <div className="run-controls">
          <button
            className="primary"
            onClick={start}
            disabled={starting || status !== "idle" || setupError !== null}
          >
            {preparing ? "시작하는 중…" : "실행 시작"}
          </button>
          <button onClick={() => handleRef.current?.pause()} disabled={status !== "running"}>
            일시정지
          </button>
          <button onClick={start} disabled={starting || status !== "paused" || setupError !== null}>
            재개
          </button>
          {status === "done" && holdoutSettled && (
            <button className="primary" onClick={() => navigate("/results")}>
              결과 보기
            </button>
          )}
          {status === "done" && !holdoutSettled && (
            <button disabled>홀드아웃 정리 중…</button>
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
        empty="실행을 시작하면 모델이 답을 내기 전에 정리한 생각과 회차별 판정이 여기에 흐릅니다."
        height={440}
      />
    </div>
  );
}
