/** 승인 화면 — 판정 절차 전체를 사용자 앞에 펼치고, 승인 순간 동결한다(SPEC §3 원칙 4).
 *  llm_judge 포함 루프는 시험관 검증 배터리(순서·변별력·안정성·꼼수 내성)와
 *  캘리브레이션(A/B 블라인드 판정, 꼼수 쌍 포함)이 승인 전 요건이다(SPEC §3 원칙 2·§5.1).
 *
 *  실패의 의미론(2026-08-23 적대 리뷰 반영):
 *  - 검증 리포트 fail → 캘리브레이션으로 진행하지 않는다(판정해도 승인 전에 폐기될 운명).
 *  - 캘리브레이션 fail → 같은 판정 절차(다이제스트)에서는 재판정·재검증 불가. 판정이 공개된
 *    뒤의 재시도는 블라인드가 아니므로, 판정 절차를 수정해 새 다이제스트로 다시 시작한다.
 *  - "다시 판정" 버튼은 없다 — 재판정 경로는 재검증(새 쌍)뿐이며, 옛 판정은 forReportAt
 *    불일치로 계약 계층에서 자동 무효화된다.
 *  결정적 전용 루프의 면제(SPEC §10)는 그대로 노출한다 — 정직 표기가 계약이다.
 *  pack만 보고 렌더하며 템플릿별 분기를 갖지 않는다(judgeProcedure union + 등록소 examiner로 분기). */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  judgeCalibration,
  MAX_EXAMINER_RUNS_PER_DIGEST,
  type AbChoice,
  type CalibrationPairSpec,
  type ExaminerCheckId,
  type ExaminerVerdict,
} from "@harnest/contracts";
import type { ExaminerCheckResult } from "@harnest/contracts";
import { setFlowStep } from "../lib/flowStep";
import { SealPanel } from "../components/SealPanel";
import { useProject } from "../state";
import { getTemplate, type TemplateEntry } from "../templates";
import { countCaseProvenance } from "../lib/case-provenance";
import { PROVIDER_LABEL, setByoKey } from "../lib/llm";

const VERDICT_LABEL: Record<ExaminerVerdict, string> = { pass: "통과", warn: "주의", fail: "실패" };
const VERDICT_COLOR: Record<ExaminerVerdict, string> = {
  pass: "var(--good)",
  warn: "var(--warn)",
  fail: "var(--bad)",
};
const CHECK_LABEL: Record<ExaminerCheckId, string> = {
  ordering: "순서 (좋은 문서가 더 높은가)",
  discrimination: "변별력 (차이가 벌어지는가)",
  stability: "안정성 (재채점이 흔들리지 않는가)",
  hack_resistance: "꼼수 내성 (알려진 꼼수 4종)",
};

/** 시험 카드에 쓰는 짧은 이름과 설명. 표의 긴 라벨(CHECK_LABEL)은 그대로 둔다. */
const CHECK_CARD: Record<ExaminerCheckId, { name: string; desc: string; cue: string }> = {
  ordering: {
    name: "순서를 지키는가",
    desc: "더 좋은 문서에 더 높은 점수를 주는지",
    cue: "품질 사다리",
  },
  discrimination: {
    name: "차이를 가려내는가",
    desc: "비슷한 문서 사이를 구분하는지",
    cue: "품질 사다리",
  },
  stability: {
    name: "같은 답에 같은 점수인가",
    desc: "같은 문서를 다시 채점해도 흔들리지 않는지",
    cue: "안정성",
  },
  hack_resistance: {
    name: "꼼수에 속지 않는가",
    desc: "길게 늘이거나 베껴 쓴 문서를 걸러내는지",
    cue: "꼼수",
  },
};

const CHECK_ORDER: ExaminerCheckId[] = [
  "ordering",
  "discrimination",
  "stability",
  "hack_resistance",
];

const VERDICT_CLASS: Record<ExaminerVerdict, string> = {
  pass: "is-pass",
  warn: "is-warn",
  fail: "is-fail",
};

/** 검증이 도는 동안 보여주는 카드 — 진행 메시지로 지금 어느 시험인지 표시한다 */
function CheckCards({
  checks,
  progress,
}: {
  checks: ReadonlyArray<{ id: ExaminerCheckId; verdict: ExaminerVerdict; note: string }> | null;
  progress: string;
}) {
  return (
    <div className="test-grid">
      {CHECK_ORDER.map((id) => {
        const done = checks?.find((c) => c.id === id) ?? null;
        const running = !done && progress.includes(CHECK_CARD[id].cue);
        const cls = done ? VERDICT_CLASS[done.verdict] : running ? "is-running" : "";
        return (
          <div key={id} className={`test ${cls}`} title={done ? done.note : undefined}>
            <b>{CHECK_CARD[id].name}</b>
            <p>{CHECK_CARD[id].desc}</p>
            <span className="test-state">
              {done ? (
                `${done.verdict === "pass" ? "✓ " : ""}${VERDICT_LABEL[done.verdict]}`
              ) : running ? (
                <>
                  <span className="spin" aria-hidden="true" />
                  시험하는 중
                </>
              ) : (
                "대기"
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: ExaminerVerdict }) {
  return (
    <span
      className="badge"
      style={{
        background: "transparent",
        border: `1px solid ${VERDICT_COLOR[verdict]}`,
        color: VERDICT_COLOR[verdict],
      }}
    >
      {VERDICT_LABEL[verdict]}
    </span>
  );
}

const EXEMPTION_LABEL = {
  examinerReport: "검증 리포트",
  calibration: "캘리브레이션",
  pairwise: "쌍대 비교",
} as const;

function ExemptionTable({ rows }: { rows: Record<keyof typeof EXEMPTION_LABEL, string> }) {
  return (
    <table className="grid">
      <tbody>
        {(Object.keys(EXEMPTION_LABEL) as Array<keyof typeof EXEMPTION_LABEL>).map((k) => (
          <tr key={k}>
            <th style={{ textAlign: "left", whiteSpace: "nowrap" }}>{EXEMPTION_LABEL[k]}</th>
            <td style={{ textAlign: "left" }}>{rows[k]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PairPane({
  label,
  artifact,
  problem,
  entry,
}: {
  label: string;
  artifact: unknown;
  problem: unknown;
  entry: TemplateEntry;
}) {
  const ArtifactView = entry.ArtifactView;
  return (
    <div className="grow" style={{ minWidth: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-3)", marginBottom: 4 }}>
        {label}
      </div>
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 10,
          maxHeight: 220,
          overflowY: "auto",
        }}
      >
        <ArtifactView problem={problem} artifact={artifact} />
      </div>
    </div>
  );
}

export function ApprovalPage() {
  const {
    templateId,
    compiled,
    answers,
    examinerRun,
    setExaminerRun,
    examinerAttempts,
    noteExaminerAttempt,
    calibration,
    setCalibration,
    blockers,
    approvedDigest,
    approvedAt,
    approve,
  } = useProject();
  const navigate = useNavigate();
  const entry = getTemplate(templateId);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  // 검증이 도는 동안 하나씩 도착하는 검사 결과 — 카드가 즉시 색을 바꾼다
  const [liveChecks, setLiveChecks] = useState<ExaminerCheckResult[]>([]);
  const [batteryError, setBatteryError] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [choices, setChoices] = useState<(AbChoice | null)[] | null>(null);

  const pack = compiled?.pack ?? null;
  // 케이스 출처 공개 — AI 초안이 0개여도 표시한다(공개가 원칙)
  const caseCounts = useMemo(
    () => (entry ? countCaseProvenance(entry.questions, answers) : null),
    [entry, answers],
  );
  // 재컴파일 뒤 늦게 도착한 배터리 결과를 버리기 위한 최신 다이제스트 참조(레이스 가드)
  const packDigestRef = useRef<string | null>(null);
  packDigestRef.current = pack?.definitionDigest ?? null;
  const approvedRef = useRef(false);
  const activeRef = useRef(false);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      // 페이지를 떠난 동안 도착한 배터리 결과가 새 화면의 승인 증거를 바꾸지 못하게 한다.
      activeRef.current = false;
    };
  }, []);

  const validReport =
    examinerRun !== null && pack !== null && examinerRun.report.forDigest === pack.definitionDigest;
  const staleReport = examinerRun !== null && !validReport;
  const reportFailed = validReport && examinerRun!.report.overall === "fail";

  /** 재검증 쿼터(SPEC §5.2) — 배터리 1회도 십여 회 호출이므로 같은 다이제스트 실행 횟수를 제한한다 */
  const attemptsForPack =
    examinerAttempts !== null && pack !== null && examinerAttempts.forDigest === pack.definitionDigest
      ? examinerAttempts.count
      : 0;
  const quotaExhausted = attemptsForPack >= MAX_EXAMINER_RUNS_PER_DIGEST;

  const calibForPack =
    calibration !== null && pack !== null && calibration.forDigest === pack.definitionDigest;
  /** 실패 고착 — 같은 다이제스트에서는 재판정·재검증으로 씻을 수 없다 */
  const failedCalibration = calibForPack && calibration!.verdict === "fail";
  const validCalibration =
    calibForPack && validReport && calibration!.forReportAt === examinerRun!.report.ranAt;
  const staleCalibration = calibration !== null && !calibForPack;

  const pairs = useMemo<CalibrationPairSpec[] | null>(() => {
    if (!validReport || !entry?.examiner || !compiled || !examinerRun) return null;
    return entry.examiner.buildPairs(examinerRun, compiled.pack);
  }, [validReport, entry, compiled, examinerRun]);

  if (!compiled || !entry || !pack) {
    return (
      <div className="card">
        <h1>아직 승인할 기준이 없습니다</h1>
        <p className="sub">먼저 몇 가지 질문에 답해 채점 기준을 만들어 주세요.</p>
        <Link to="/wizard">
          <button className="primary">질문에 답하러 가기</button>
        </Link>
      </div>
    );
  }

  const approved = approvedAt !== null && approvedDigest === pack.definitionDigest;

  // 승인 화면은 두 칸이다 — 검증하는 동안이 4번째, 잠근 뒤가 5번째
  useEffect(() => {
    setFlowStep(approved ? 4 : 3);
  }, [approved]);
  approvedRef.current = approved;
  const jp = pack.judgeProcedure;
  const hp = pack.holdoutPolicy;

  const runBattery = async (): Promise<void> => {
    if (!entry.examiner || running || approved || failedCalibration || quotaExhausted) return;
    setBatteryError(null);
    let llm;
    try {
      llm = entry.createLlm(compiled);
    } catch (e) {
      setBatteryError(e instanceof Error ? e.message : String(e));
      return;
    }
    if (!llm) return;
    const startedDigest = pack.definitionDigest;
    // 전송 실패도 호출을 소모하므로 완료가 아니라 시작 시점에 계수한다
    noteExaminerAttempt(startedDigest);
    setRunning(true);
    try {
      setLiveChecks([]);
      const run = await entry.examiner.runBattery(compiled, llm, setProgress, (c) =>
        setLiveChecks((prev) => [...prev.filter((p) => p.id !== c.id), c]),
      );
      // 실행 중 기준이 재컴파일·승인됐거나 화면을 떠났다면 이 결과는 현재 승인 증거가 아니다.
      if (
        !activeRef.current ||
        approvedRef.current ||
        packDigestRef.current !== startedDigest
      ) return;
      setExaminerRun(run);
      // 새 리포트 = 새 쌍: 이전 판정은 forReportAt 불일치로 계약에서도 무효지만 상태도 정리한다
      setCalibration(null);
      setChoices(null);
    } catch (e) {
      if (!activeRef.current || packDigestRef.current !== startedDigest) return;
      setBatteryError(e instanceof Error ? e.message : String(e));
    } finally {
      if (activeRef.current) {
        setRunning(false);
        setProgress("");
      }
    }
  };

  const saveKeyAndRetry = (): void => {
    const key = keyInput.trim();
    if (key.length > 0 && jp.kind === "case_answering" && jp.judge.provider !== "mock") {
      setByoKey(jp.judge.provider, key);
    }
    void runBattery();
  };

  const batteryErrorBox =
    batteryError !== null && !running ? (
      <div style={{ marginTop: 10 }}>
        <p className="error" style={{ margin: "0 0 8px" }}>{batteryError}</p>
        {jp.kind === "case_answering" && jp.judge.provider !== "mock" ? (
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="password"
              placeholder="채점 모델 API 키"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
            />
            <button onClick={saveKeyAndRetry}>저장 후 다시 검증</button>
          </div>
        ) : null}
      </div>
    ) : null;

  const quotaHint =
    attemptsForPack > 0 && !quotaExhausted ? (
      <p className="hint" style={{ margin: "6px 0 0" }}>
        검증 실행 {attemptsForPack}/{MAX_EXAMINER_RUNS_PER_DIGEST}회 사용 — 같은 기준에서는 최대{" "}
        {MAX_EXAMINER_RUNS_PER_DIGEST}회까지 실행할 수 있습니다 (1회당 십여 회의 모델 호출).
      </p>
    ) : null;

  const quotaExhaustedBox = quotaExhausted ? (
    <div style={{ marginTop: 8 }}>
      <p className="error" style={{ margin: "0 0 8px" }}>
        이 기준으로 검증을 {MAX_EXAMINER_RUNS_PER_DIGEST}회 실행했습니다 — 비용 보호를 위해 같은
        기준의 추가 검증은 막혀 있습니다. 기준을 수정하면 새 절차로 다시 검증할 수 있습니다.
      </p>
      <button onClick={() => navigate("/wizard")}>기준을 수정하러 가기</button>
    </div>
  ) : null;

  const effectiveChoices: (AbChoice | null)[] =
    choices ??
    (pairs
      ? pairs.map(
          (p) =>
            (validCalibration
              ? calibration!.pairs.find((r) => r.id === p.id)?.userChoice
              : null) ?? null,
        )
      : []);

  const pick = (index: number, choice: AbChoice): void => {
    if (approved || validCalibration || failedCalibration || !pairs || !examinerRun) return;
    const next = [...effectiveChoices];
    next[index] = choice;
    setChoices(next);
    if (next.every((c) => c !== null)) {
      setCalibration(judgeCalibration(pairs, next as AbChoice[], pack, examinerRun.report));
    }
  };

  // 승인된 뒤에는 이 화면이 통째로 봉인 장면이 된다. 기준 상세는 접어 두고,
  // 펼쳐야 볼 수 있게 한다 — 잠갔다는 사실이 먼저 읽혀야 한다.
  if (approved) {
    return (
      <div className="sealed-page">
        <SealPanel digest={pack.definitionDigest}>
          <button className="primary seal-go" onClick={() => navigate("/console")}>
            실행 화면으로
          </button>
        </SealPanel>

        <details className="sealed-detail">
          <summary>동결된 채점 기준 보기</summary>
          <table className="grid">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>기준</th>
                <th>가중치</th>
              </tr>
            </thead>
            <tbody>
              {pack.criteria.map((c) => (
                <tr key={c.id}>
                  <td style={{ textAlign: "left" }}>{c.label}</td>
                  <td>{Math.round(c.weight * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {pack.gates.length > 0 ? (
            <ul className="sealed-gates">
              {pack.gates.map((g) => (
                <li key={g.id}>
                  {g.label} <span className="badge muted">미충족 시 탈락</span>
                </li>
              ))}
            </ul>
          ) : null}
        </details>
      </div>
    );
  }

  return (
    <div>
      <h1>채점 기준 승인</h1>
      <p className="sub">채점 기준은 당신이 승인하고, 실행 중 AI는 이 기준을 변경할 수 없습니다.</p>

      <div className={approved ? "card locked" : "card"}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h2 style={{ marginTop: 0 }}>채점 기준</h2>
          {approved ? <span className="lock-badge">🔒 승인됨 · 동결</span> : null}
        </div>

        <table className="grid">
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>기준</th>
              <th>가중치</th>
            </tr>
          </thead>
          <tbody>
            {pack.criteria.map((c) => (
              <tr key={c.id}>
                <td style={{ textAlign: "left" }}>{c.label}</td>
                <td>{Math.round(c.weight * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>필수 관문</h2>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
          {pack.gates.map((g) => (
            <li key={g.id}>
              {g.label} <span className="badge muted">미충족 시 탈락</span>
            </li>
          ))}
        </ul>

        {jp.kind === "case_answering" ? (
          <>
            <h2>채점 방식</h2>
            <p style={{ fontSize: 14, margin: "0 0 4px" }}>
              채점 모델: <strong>{PROVIDER_LABEL[jp.judge.provider]} · {jp.judge.model}</strong>
            </p>
            <p className="hint" style={{ margin: "0 0 6px" }}>
              이 모델은 판정 절차의 일부로 승인 시 동결됩니다 — 교체하려면 다시 승인해야 합니다.
            </p>
            <p className="hint" style={{ margin: 0 }}>쌍대 비교: {jp.pairwiseNotice}</p>
          </>
        ) : (
          <>
            <h2>검증·면제 표기</h2>
            <ExemptionTable rows={jp.exemptions} />
          </>
        )}

        {hp.mode === "auto_tail" ? (
          <>
            <h2>숨김 검증</h2>
            <p style={{ fontSize: 14, margin: 0 }}>
              숨김 검증 케이스 {hp.holdoutCaseIds.length}개 — 실행 시작·종료 시에만 채점되며 AI
              수정 과정에 노출되지 않습니다.
            </p>
          </>
        ) : null}

        {caseCounts !== null && caseCounts.total > 0 ? (
          <>
            <h2>케이스 출처</h2>
            <p style={{ fontSize: 14, margin: 0 }}>
              {caseCounts.ai + caseCounts.aiEdited > 0
                ? `직접 입력 ${caseCounts.user}개 · AI 초안 확인 ${caseCounts.ai}개 · AI 초안 수정 ${caseCounts.aiEdited}개 — 초안도 당신이 확인한 순간부터 채점 정답으로 동결됩니다.`
                : `전체 ${caseCounts.total}개 직접 입력.`}
            </p>
          </>
        ) : null}

        {jp.kind === "case_answering" && entry.examiner ? (
          <>
            <h2>시험관 검증</h2>
            {staleReport || staleCalibration ? (
              <p style={{ fontSize: 13, color: "var(--warn)", margin: "0 0 10px" }}>
                기준이 수정되어 이전 {staleReport ? "검증 리포트" : "캘리브레이션"}가
                무효화되었습니다 — 수정된 기준으로 다시 검증해 주세요.
              </p>
            ) : null}

            {!validReport ? (
              <div>
                <p style={{ fontSize: 14, margin: "0 0 10px" }}>
                  승인 전에 이 채점 기준 자체를 시험합니다: 품질이 다른 문서들의 순서·변별력·
                  안정성, 그리고 알려진 꼼수 4종(장황함·통째 베끼기·날조·아첨)에 대한 내성.
                </p>
                {running ? (
                  <>
                    <CheckCards checks={liveChecks} progress={progress} />
                    <p className="hint">{progress}</p>
                  </>
                ) : quotaExhausted ? (
                  quotaExhaustedBox
                ) : (
                  <>
                    <CheckCards checks={null} progress={progress} />
                    <div style={{ marginTop: 16 }}>
                      <button className="primary" onClick={() => void runBattery()}>
                        검증 실행
                      </button>
                    </div>
                    {quotaHint}
                  </>
                )}
                {batteryErrorBox}
              </div>
            ) : (
              <div>
                <div style={{ marginBottom: 8 }}>
                  종합: <VerdictBadge verdict={examinerRun!.report.overall} />
                  <span className="hint" style={{ marginLeft: 6 }}>
                    구동 저지: {PROVIDER_LABEL[examinerRun!.report.judge.provider]} ·{" "}
                    {examinerRun!.report.judge.model}
                  </span>
                </div>
                <CheckCards checks={examinerRun!.report.checks} progress="" />
                {!approved && !failedCalibration ? (
                  <div style={{ marginTop: 10 }}>
                    {reportFailed ? (
                      <p className="error" style={{ margin: "0 0 8px" }}>
                        검증에 실패한 기준은 동결할 수 없습니다 — 기준을 수정한 뒤 다시 검증해
                        주세요.
                      </p>
                    ) : null}
                    {quotaExhausted && !reportFailed ? null : quotaExhausted ? (
                      quotaExhaustedBox
                    ) : (
                      <>
                        <button onClick={() => void runBattery()} disabled={running}>
                          {running ? `검증 중… ${progress}` : "다시 검증"}
                        </button>
                        {quotaHint}
                      </>
                    )}
                    {batteryErrorBox}
                  </div>
                ) : null}
              </div>
            )}

            {validReport && !reportFailed && pairs !== null ? (
              <>
                <h2>캘리브레이션 — 당신의 판단과 비교</h2>
                <p className="hint" style={{ margin: "0 0 10px" }}>
                  각 쌍에서 더 나은 문서를 먼저 골라 주세요. 고른 뒤에 채점 기준의 판정이
                  공개됩니다 — 알려진 꼼수 예시가 섞여 있습니다.
                </p>
                {pairs.map((pair, i) => {
                  const chosen = effectiveChoices[i];
                  return (
                    <div
                      key={pair.id}
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 10,
                        padding: 12,
                        marginBottom: 10,
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                        {i + 1}번째 쌍
                      </div>
                      <div className="row">
                        <PairPane label="A" artifact={pair.a} problem={compiled.problem} entry={entry} />
                        <PairPane label="B" artifact={pair.b} problem={compiled.problem} entry={entry} />
                      </div>
                      {chosen === null ? (
                        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                          <button onClick={() => pick(i, "A")}>A가 더 좋다</button>
                          <button onClick={() => pick(i, "B")}>B가 더 좋다</button>
                        </div>
                      ) : (
                        <div style={{ marginTop: 10, fontSize: 13 }}>
                          <span
                            style={{
                              fontWeight: 600,
                              color:
                                chosen === pair.examinerChoice ? "var(--good)" : "var(--bad)",
                            }}
                          >
                            {chosen === pair.examinerChoice
                              ? `일치 — 당신도 채점 기준도 ${chosen}를 택했습니다.`
                              : `불일치 — 당신은 ${chosen}, 채점 기준은 ${pair.examinerChoice}를 택했습니다.`}
                          </span>{" "}
                          <span className="hint">{pair.basis}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            ) : null}

            {calibForPack && (validCalibration || failedCalibration) ? (
              <div style={{ marginBottom: 4 }}>
                캘리브레이션: <VerdictBadge verdict={calibration!.verdict} />
                <span className="hint" style={{ marginLeft: 6 }}>
                  {calibration!.pairs.filter((p) => p.agreed).length}/{calibration!.pairs.length}{" "}
                  일치
                </span>
              </div>
            ) : null}

            {failedCalibration && !approved ? (
              <div style={{ marginTop: 8 }}>
                <p className="error" style={{ margin: "0 0 8px" }}>
                  캘리브레이션에 실패한 기준은 동결할 수 없습니다. 판정이 이미 공개되었으므로 같은
                  기준으로 다시 판정하는 것은 의미가 없습니다 — 기준을 수정하면 새 검증으로
                  이어집니다.
                </p>
                <button onClick={() => navigate("/wizard")}>기준을 수정하러 가기</button>
              </div>
            ) : null}
          </>
        ) : null}

        {(
          <div style={{ marginTop: 18 }}>
            {blockers.length > 0 ? (
              <ul style={{ margin: "0 0 10px", paddingLeft: 18, fontSize: 13, color: "var(--ink-3)" }}>
                {blockers.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            ) : null}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="primary"
                onClick={approve}
                disabled={running || blockers.length > 0}
              >
                승인하고 동결
              </button>
              <button onClick={() => navigate("/wizard")}>수정하러 가기</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
