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

import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  judgeCalibration,
  type AbChoice,
  type CalibrationPairSpec,
  type ExaminerCheckId,
  type ExaminerVerdict,
} from "@harnest/contracts";
import { useProject } from "../state";
import { getTemplate, type TemplateEntry } from "../templates";
import { PROVIDER_LABEL, setByoKey } from "../lib/llm";

const VERDICT_LABEL: Record<ExaminerVerdict, string> = { pass: "통과", warn: "주의", fail: "실패" };
const VERDICT_COLOR: Record<ExaminerVerdict, string> = {
  pass: "var(--good)",
  warn: "var(--warn)",
  fail: "var(--bad)",
};
const CHECK_LABEL: Record<ExaminerCheckId, string> = {
  ordering: "좋은 문서에 더 높은 점수를 주는가",
  discrimination: "문서 사이 점수 차이가 벌어지는가",
  stability: "다시 채점해도 같은 점수가 나오는가",
  hack_resistance: "흔한 속임수 4가지에 안 넘어가는가",
};

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
  calibration: "내 판단과 맞춰보기",
  pairwise: "둘씩 비교하기",
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
    examinerRun,
    setExaminerRun,
    calibration,
    setCalibration,
    blockers,
    approvedAt,
    approve,
  } = useProject();
  const navigate = useNavigate();
  const entry = getTemplate(templateId);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [batteryError, setBatteryError] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [choices, setChoices] = useState<(AbChoice | null)[] | null>(null);

  const pack = compiled?.pack ?? null;
  // 재컴파일 뒤 늦게 도착한 배터리 결과를 버리기 위한 최신 다이제스트 참조(레이스 가드)
  const packDigestRef = useRef<string | null>(null);
  packDigestRef.current = pack?.definitionDigest ?? null;

  const validReport =
    examinerRun !== null && pack !== null && examinerRun.report.forDigest === pack.definitionDigest;
  const staleReport = examinerRun !== null && !validReport;
  const reportFailed = validReport && examinerRun!.report.overall === "fail";

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
        <p className="sub">먼저 몇 가지 질문에 답해서 채점 기준을 만들어 주세요.</p>
        <Link to="/wizard">
          <button className="primary">질문에 답하러 가기</button>
        </Link>
      </div>
    );
  }

  const approved = approvedAt !== null;
  const jp = pack.judgeProcedure;
  const hp = pack.holdoutPolicy;

  const runBattery = async (): Promise<void> => {
    if (!entry.examiner || running || failedCalibration) return;
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
    setRunning(true);
    try {
      const run = await entry.examiner.runBattery(compiled, llm, setProgress);
      // 실행 중 기준이 재컴파일됐다면 이 결과는 옛 절차의 것 — 버린다
      if (packDigestRef.current !== startedDigest) return;
      setExaminerRun(run);
      // 새 리포트 = 새 쌍: 이전 판정은 forReportAt 불일치로 계약에서도 무효지만 상태도 정리한다
      setCalibration(null);
      setChoices(null);
    } catch (e) {
      if (packDigestRef.current !== startedDigest) return;
      setBatteryError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      setProgress("");
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
              placeholder="채점을 맡을 AI의 API 키"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
            />
            <button onClick={saveKeyAndRetry}>저장하고 다시 시험</button>
          </div>
        ) : null}
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

  const approvedAtLabel = approvedAt
    ? new Date(approvedAt).toLocaleString("ko-KR", {
        month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
      })
    : "방금";

  return (
    <div>
      <h1>채점 기준 승인</h1>
      <p className="sub">채점 기준은 당신이 승인하고, 실행 중 AI는 이 기준을 변경할 수 없습니다.</p>

      <div className={approved ? "card locked" : "card"}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h2 style={{ marginTop: 0 }}>채점 기준</h2>
          {approved ? <span className="lock-badge">🔒 승인 완료 · 잠김</span> : null}
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

        <h2>반드시 지켜야 할 것</h2>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
          {pack.gates.map((g) => (
            <li key={g.id}>
              {g.label} <span className="badge muted">어기면 탈락</span>
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
              이 AI도 채점 방식의 일부라서 승인과 함께 잠깁니다 — 바꾸려면 처음부터 다시 승인해야 합니다.
            </p>
            <p className="hint" style={{ margin: 0 }}>둘씩 비교하기: {jp.pairwiseNotice}</p>
          </>
        ) : (
          <>
            <h2>해당 없는 항목</h2>
            <ExemptionTable rows={jp.exemptions} />
          </>
        )}

        {hp.mode === "auto_tail" ? (
          <>
            <h2>숨겨두는 질문</h2>
            <p style={{ fontSize: 14, margin: 0 }}>
              숨겨둔 질문 {hp.holdoutCaseIds.length}개 — 실행 시작과 끝에만 채점하고 AI가
              고치는 동안에는 보지 못합니다.
            </p>
          </>
        ) : null}

        {jp.kind === "case_answering" && entry.examiner ? (
          <>
            <h2>이 채점 기준이 쓸 만한지 먼저 시험합니다</h2>
            {staleReport || staleCalibration ? (
              <p style={{ fontSize: 13, color: "var(--warn)", margin: "0 0 10px" }}>
                기준이 바뀌어서 이전 {staleReport ? "시험 결과" : "판단 비교"}가
                무효화되었습니다 — 수정된 기준으로 다시 시험해 주세요.
              </p>
            ) : null}

            {!validReport ? (
              <div>
                <p style={{ fontSize: 14, margin: "0 0 10px" }}>
                  승인하기 전에 이 채점 기준이 제대로 작동하는지 먼저 확인합니다. 좋은 문서와 나쁜
                  문서를 제대로 가려내는지, 다시 채점해도 결과가 같은지, 흔한 속임수 네 가지에
                  넘어가지 않는지 봅니다.
                </p>
                {running ? (
                  <p className="hint" style={{ margin: 0 }}>시험하는 중… {progress}</p>
                ) : (
                  <button className="primary" onClick={() => void runBattery()}>
                    기준 시험하기
                  </button>
                )}
                {batteryErrorBox}
              </div>
            ) : (
              <div>
                <div style={{ marginBottom: 8 }}>
                  종합: <VerdictBadge verdict={examinerRun!.report.overall} />
                  <span className="hint" style={{ marginLeft: 6 }}>
                    채점을 맡은 AI: {PROVIDER_LABEL[examinerRun!.report.judge.provider]} ·{" "}
                    {examinerRun!.report.judge.model}
                  </span>
                </div>
                <table className="grid">
                  <tbody>
                    {examinerRun!.report.checks.map((c) => (
                      <tr key={c.id}>
                        <th style={{ textAlign: "left", whiteSpace: "nowrap" }}>
                          {CHECK_LABEL[c.id]}
                        </th>
                        <td style={{ textAlign: "left", width: 64 }}>
                          <VerdictBadge verdict={c.verdict} />
                        </td>
                        <td style={{ textAlign: "left" }}>{c.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!approved && !failedCalibration ? (
                  <div style={{ marginTop: 10 }}>
                    {reportFailed ? (
                      <p className="error" style={{ margin: "0 0 8px" }}>
                        시험을 통과하지 못한 기준은 승인할 수 없습니다 — 기준을 고친 뒤 다시 시험해
                        주세요.
                      </p>
                    ) : null}
                    <button onClick={() => void runBattery()} disabled={running}>
                      {running ? `시험하는 중… ${progress}` : "다시 시험"}
                    </button>
                    {batteryErrorBox}
                  </div>
                ) : null}
              </div>
            )}

            {validReport && !reportFailed && pairs !== null ? (
              <>
                <h2>당신의 판단과 맞춰보기</h2>
                <p className="hint" style={{ margin: "0 0 10px" }}>
                  두 문서 중 나은 쪽을 먼저 골라 주세요. 고른 뒤에 채점 기준이 어느 쪽을 골랐는지
                  보여드립니다. 당신의 판단과 맞아야 이 기준을 믿고 쓸 수 있습니다.
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
                내 판단과 맞춰보기: <VerdictBadge verdict={calibration!.verdict} />
                <span className="hint" style={{ marginLeft: 6 }}>
                  {calibration!.pairs.filter((p) => p.agreed).length}/{calibration!.pairs.length}{" "}
                  일치
                </span>
              </div>
            ) : null}

            {failedCalibration && !approved ? (
              <div style={{ marginTop: 8 }}>
                <p className="error" style={{ margin: "0 0 8px" }}>
                  당신의 판단과 채점 기준이 어긋났습니다. 이 기준은 승인할 수 없습니다. 채점 기준의 답을
                  이미 봤기 때문에 같은 기준으로 다시 고르는 것은 의미가 없습니다 — 기준을 고치면
                  새로 시험합니다.
                </p>
                <button onClick={() => navigate("/wizard")}>기준을 수정하러 가기</button>
              </div>
            ) : null}
          </>
        ) : null}

        {approved ? (
          <div style={{ marginTop: 18 }}>
            <p className="lock-note">
              🔒 {approvedAtLabel}에 승인했습니다. 지금부터 이 기준은 잠기며, 실행 중 AI가 바꿀 수 없습니다.
            </p>
            <p className="hint" style={{ marginTop: 8 }}>
              바꾸려면 처음부터 새로 만들어 다시 승인해야 합니다.
            </p>
            <details className="digest-fold">
              <summary>기준이 바뀌지 않았는지 확인하는 번호</summary>
              <div className="mono digest">{pack.definitionDigest}</div>
            </details>
            <div style={{ marginTop: 12 }}>
              <button className="primary" onClick={() => navigate("/console")}>
                실행 화면으로
              </button>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 18 }}>
            {blockers.length > 0 ? (
              <ul style={{ margin: "0 0 10px", paddingLeft: 18, fontSize: 13, color: "var(--ink-3)" }}>
                {blockers.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            ) : null}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="primary" onClick={approve} disabled={blockers.length > 0}>
                이 기준으로 승인하기
              </button>
              <button onClick={() => navigate("/wizard")}>수정하러 가기</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
