/** 승인 화면 — 판정 절차 전체를 사용자 앞에 펼치고, 승인 순간 동결한다(SPEC §3 원칙 4).
 *  llm_judge 포함 루프는 시험관 검증 배터리(안정성·꼼수 내성)가 승인 전 요건이다
 *  (SPEC §3 원칙 2·§5.1). 배터리는 이 화면이 자동 실행한다 — 기준이 수정되면(다이제스트 변경)
 *  이전 리포트가 forDigest 불일치로 무효화되고, 새 다이제스트에 대한 검증이 다시 자동으로 돈다.
 *
 *  실패의 의미론:
 *  - 검증 리포트 fail → 승인 차단(approvalBlockers). 기준을 수정하면 새 다이제스트로 재검증.
 *  - 전송·형식 오류는 판정 결과가 아니다 — "다시 검증"으로 언제든 재실행할 수 있다.
 *  결정적 전용 루프의 면제(SPEC §10)는 그대로 노출한다 — 정직 표기가 계약이다.
 *  pack만 보고 렌더하며 템플릿별 분기를 갖지 않는다(judgeProcedure union + 등록소 examiner로 분기). */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ExaminerCheckId, ExaminerCheckResult, ExaminerVerdict } from "@harnest/contracts";
import { ActivityConsole } from "../components/ActivityConsole";
import { appendStream, clearStream, endStream, setStreamStatus, withActivityLog } from "../lib/activityLog";
import { setFlowStep } from "../lib/flowStep";
import { SealPanel } from "../components/SealPanel";
import { useProject } from "../state";
import { getTemplate } from "../templates";
import { countCaseProvenance } from "../lib/case-provenance";
import { ProviderCredentialInput } from "../components/ProviderCredentialInput";
import { InfoTip } from "../components/InfoTip";
import {
  formatModelLabel,
  getByoCredential,
  normalizeVertexServiceAccount,
  setByoCredential,
  testByoConnection,
} from "../lib/llm";

const VERDICT_LABEL: Record<ExaminerVerdict, string> = { pass: "통과", warn: "주의", fail: "실패" };
const VERDICT_COLOR: Record<ExaminerVerdict, string> = {
  pass: "var(--good)",
  warn: "var(--warn)",
  fail: "var(--bad)",
};

/** 시험 카드에 쓰는 짧은 이름과 설명. cue는 진행 메시지에서 현재 검사를 찾는 마커다. */
const CHECK_CARD: Record<ExaminerCheckId, { name: string; desc: string; cue: string }> = {
  stability: {
    name: "재채점 결과가 안정적인가",
    desc: "같은 문서의 점수 차이가 허용 범위 안인지",
    cue: "안정성",
  },
  hack_resistance: {
    name: "꾸며낸 답을 가려내는가",
    desc: "사실을 꾸미거나 칭찬만 하는 답을 구분하는지",
    cue: "날조",
  },
};

const CHECK_ORDER: ExaminerCheckId[] = ["stability", "hack_resistance"];

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
            {done ? (
              <div className="hint" style={{ margin: "8px 0 0", fontSize: 12 }}>
                {done.note}
              </div>
            ) : null}
            <span className="test-state">
              {done ? (
                `${done.verdict === "pass" ? "✓ " : ""}${VERDICT_LABEL[done.verdict]}`
              ) : running ? (
                <>
                  <span className="spin" aria-hidden="true" />
                  점검 중
                </>
              ) : (
                "점검 시작 전"
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
  examinerReport: "AI 평가 사전 점검",
  pairwise: "두 결과 직접 비교",
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

/** 컴파일이 계산한 설정 안내(예: 베끼기 방어 약화) — 판정이 아니라 정적 사실이므로
 *  검사 카드가 아니라 안내문으로 보여준다 */
function ComplianceNotices({ notices }: { notices: string[] | undefined }) {
  if (!notices || notices.length === 0) return null;
  return (
    <>
      {notices.map((n, i) => (
        <p key={i} className="hint copy-lines" style={{ margin: "8px 0 0", color: "var(--warn)" }}>
          {n}
        </p>
      ))}
    </>
  );
}

export function ApprovalPage() {
  const {
    templateId,
    compiled,
    answers,
    examinerReport,
    setExaminerReport,
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
  // 자동 검증은 다이제스트당 한 번만 시도한다 — 오류 시 무한 재시도로 비용이 새지 않게
  const autoRunDigestRef = useRef<string | null>(null);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      // 페이지를 떠난 동안 도착한 배터리 결과가 새 화면의 승인 증거를 바꾸지 못하게 한다.
      activeRef.current = false;
    };
  }, []);

  const validReport =
    examinerReport !== null && pack !== null && examinerReport.forDigest === pack.definitionDigest;
  const reportFailed = validReport && examinerReport!.overall === "fail";

  const approved =
    pack !== null && approvedAt !== null && approvedDigest === pack.definitionDigest;

  // 현재 다이제스트의 승인 결속 여부는 StepBar가 프로젝트 상태에서 해석한다.
  // pack 유무와 관계없이 같은 순서로 호출해 조기 반환 시에도 Hooks 규칙을 지킨다.
  useEffect(() => {
    setFlowStep({ kind: "approval" });
    clearStream(); // 앞 화면에서 흐르던 글이 이어지지 않게 한다
  }, []);
  approvedRef.current = approved;

  const runBattery = async (): Promise<void> => {
    if (!entry?.examiner || !compiled || !pack || running || approved) return;
    setBatteryError(null);
    let llm;
    try {
      llm = entry.createLlm(compiled);
      if (llm) llm = withActivityLog(llm, "선택한 AI의 평가를 사전 점검하는 중");
    } catch (e) {
      setBatteryError(e instanceof Error ? e.message : String(e));
      return;
    }
    if (!llm) return;
    const startedDigest = pack.definitionDigest;
    setRunning(true);
    try {
      setLiveChecks([]);
      clearStream("선택한 AI의 평가를 사전 점검하는 중");
      const report = await entry.examiner.runBattery(compiled, llm, setProgress, (c) =>
        setLiveChecks((prev) => [...prev.filter((p) => p.id !== c.id), c]),
      );
      // 실행 중 기준이 재컴파일·승인됐거나 화면을 떠났다면 이 결과는 현재 승인 증거가 아니다.
      if (
        !activeRef.current ||
        approvedRef.current ||
        packDigestRef.current !== startedDigest
      ) return;
      setExaminerReport(report);
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

  // 수정→재검증 자동 왕복 — 유효한 리포트가 없으면 배터리를 자동으로 시작한다.
  // 키 없음·전송 오류로 멈춘 경우는 아래 오류 상자에서 수동으로 다시 시작한다.
  useEffect(() => {
    if (!entry?.examiner || pack === null || approved || running || validReport) return;
    if (autoRunDigestRef.current === pack.definitionDigest) return;
    autoRunDigestRef.current = pack.definitionDigest;
    void runBattery();
    // eslint 미사용 — runBattery는 렌더마다 새로 만들어지므로 다이제스트 기준으로만 발화한다
  }, [entry, pack?.definitionDigest, approved, running, validReport]);

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

  const jp = pack.judgeProcedure;
  const hp = pack.holdoutPolicy;
  const splitSummary =
    hp.mode === "seeded_split"
      ? caseCounts && caseCounts.total > 0
        ? `개선용 ${Math.max(0, caseCounts.total - hp.guardCaseIds.length - hp.holdoutCaseIds.length)}개 · 중간 점검용 ${hp.guardCaseIds.length}개 · 최종 확인용 ${hp.holdoutCaseIds.length}개`
        : `중간 점검용 ${hp.guardCaseIds.length}개 · 최종 확인용 ${hp.holdoutCaseIds.length}개`
      : "";

  const saveCredentialAndRetry = async (): Promise<void> => {
    if (jp.kind !== "case_answering" || jp.judge.provider === "mock") return;
    const provider = jp.judge.provider;
    const raw = credentialInput.trim();
    setCredentialBusy(true);
    try {
      if (raw) {
        await testByoConnection(provider, raw, jp.judge.model);
        const saved = provider === "vertex" ? normalizeVertexServiceAccount(raw) : raw;
        setByoCredential(provider, saved);
        if (provider === "vertex") {
          setStoredVertexCredential(saved);
          setCredentialInput("");
        }
      }
      setBatteryError(null);
      await runBattery();
    } catch (error) {
      setBatteryError(error instanceof Error ? error.message : String(error));
    } finally {
      setCredentialBusy(false);
    }
  };

  const batteryErrorBox =
    batteryError !== null && !running ? (
      <div style={{ marginTop: 10 }}>
        <p className="error" style={{ margin: "0 0 8px" }}>{batteryError}</p>
        {jp.kind === "case_answering" && jp.judge.provider !== "mock" ? (
          <div style={{ display: "grid", gap: 8 }}>
            <ProviderCredentialInput
              provider={jp.judge.provider}
              value={credentialInput}
              storedCredential={
                jp.judge.provider === "vertex" ? storedVertexCredential : null
              }
              idPrefix="approval-retry"
              disabled={credentialBusy}
              onChange={setCredentialInput}
              onDelete={() => {
                const provider = jp.judge.provider;
                if (provider === "mock") return;
                setByoCredential(provider, null);
                setCredentialInput("");
                if (provider === "vertex") setStoredVertexCredential(null);
              }}
              onError={setBatteryError}
            />
            <button disabled={credentialBusy} onClick={() => void saveCredentialAndRetry()}>
              {credentialBusy ? "연결 확인 중…" : "연결 확인 후 다시 점검"}
            </button>
          </div>
        ) : (
          <button onClick={() => void runBattery()}>다시 점검</button>
        )}
      </div>
    ) : null;

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
          <summary>승인 내용 보기</summary>

          <h2>채점 기준</h2>
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

          <h2>필수 조건</h2>
          {pack.gates.length > 0 ? (
            <ul className="sealed-gates">
              {pack.gates.map((g) => (
                <li key={g.id}>
                  {g.label} <span className="badge muted">위반 시 제외</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">설정된 필수 조건이 없습니다.</p>
          )}
          <ComplianceNotices notices={compiled.notices} />

          {jp.kind === "case_answering" ? (
            <>
              <h2>채점 방식</h2>
              <p style={{ fontSize: 14, margin: "0 0 4px" }}>
                사용할 AI 모델: <strong>{formatModelLabel(jp.judge.provider, jp.judge.model)}</strong>
              </p>
              <p className="hint" style={{ margin: "0 0 12px" }}>
                개선안 채택 조건: {jp.pairwiseNotice}
              </p>
            </>
          ) : (
            <>
              <h2>적용·제외 항목</h2>
              <ExemptionTable rows={jp.exemptions} />
            </>
          )}

          <h2>질문 사용 구분</h2>
          {hp.mode === "seeded_split" ? (
            <p style={{ fontSize: 14, margin: "0 0 12px" }}>
              {splitSummary}
              <InfoTip
                label="질문 사용 구분"
                text={`${hp.note}\n중간 점검 점수가 현재 결과보다 ${hp.guardTolerance}점 넘게 낮으면 새 개선안을 채택하지 않습니다.`}
              />
            </p>
          ) : (
            <p style={{ fontSize: 14, margin: "0 0 12px" }}>사용 안 함 — {hp.note}</p>
          )}

          {caseCounts !== null && caseCounts.total > 0 ? (
            <>
              <h2>질문 출처</h2>
              <p style={{ fontSize: 14, margin: "0 0 12px" }}>
                {caseCounts.ai + caseCounts.aiEdited > 0
                  ? `직접 입력 ${caseCounts.user}개 · AI 초안 확인 ${caseCounts.ai}개 · AI 초안 수정 ${caseCounts.aiEdited}개 — 확인한 초안은 평가 구성에 포함됨.`
                  : `전체 ${caseCounts.total}개 직접 입력.`}
              </p>
            </>
          ) : null}

          {jp.kind === "case_answering" && entry.examiner ? (
            <>
              <h2>AI 평가 사전 점검</h2>
              {validReport ? (
                <>
                  <div style={{ marginBottom: 8 }}>
                    종합: <VerdictBadge verdict={examinerReport!.overall} />
                    <span className="hint" style={{ marginLeft: 6 }}>
                      점검에 사용한 AI 모델:{" "}
                      {formatModelLabel(examinerReport!.judge.provider, examinerReport!.judge.model)}
                    </span>
                  </div>
                  <CheckCards checks={examinerReport!.checks} progress="" />
                </>
              ) : (
                <p className="hint">현재 평가 구성의 점검 기록이 없습니다.</p>
              )}
            </>
          ) : null}
        </details>
      </div>
    );
  }

  return (
    <div>
      <h1>평가 구성 승인</h1>
      <p className="sub">AI가 결과물을 만들고 평가하는 동안, 승인한 평가 구성은 바뀌지 않습니다.</p>

      <div className="approve-deck">
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h2 style={{ marginTop: 0 }}>채점 기준</h2>
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

        <h2>필수 조건</h2>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
          {pack.gates.map((g) => (
            <li key={g.id}>
              {g.label} <span className="badge muted">위반 시 제외</span>
            </li>
          ))}
        </ul>
        <ComplianceNotices notices={compiled.notices} />

        {jp.kind === "case_answering" ? (
          <>
            <h2>채점 방식</h2>
            <p style={{ fontSize: 14, margin: "0 0 4px" }}>
              사용할 AI 모델: <strong>{formatModelLabel(jp.judge.provider, jp.judge.model)}</strong>
            </p>
            <p className="hint" style={{ margin: "0 0 6px" }}>
              이 AI 모델이 결과물을 만들고 평가합니다. 변경하면 다시 승인해야 합니다.
            </p>
            <p className="hint" style={{ margin: 0 }}>개선안 채택 조건: {jp.pairwiseNotice}</p>
          </>
        ) : (
          <>
            <h2>적용·제외 항목</h2>
            <ExemptionTable rows={jp.exemptions} />
          </>
        )}

        {hp.mode === "seeded_split" ? (
          <>
            <h2>질문 사용 구분</h2>
            <p style={{ fontSize: 14, margin: 0 }}>
              {splitSummary}
              <InfoTip
                label="질문 사용 구분"
                text={`${hp.note}\n중간 점검 점수가 현재 결과보다 ${hp.guardTolerance}점 넘게 낮으면 새 개선안을 채택하지 않습니다.`}
              />
            </p>
          </>
        ) : null}

        {caseCounts !== null && caseCounts.total > 0 ? (
          <>
            <h2>질문 출처</h2>
            <p style={{ fontSize: 14, margin: 0 }}>
              {caseCounts.ai + caseCounts.aiEdited > 0
                ? `직접 입력 ${caseCounts.user}개 · AI 초안 확인 ${caseCounts.ai}개 · AI 초안 수정 ${caseCounts.aiEdited}개 — 확인한 초안은 평가 구성에 포함됨.`
                : `전체 ${caseCounts.total}개 직접 입력.`}
            </p>
          </>
        ) : null}

        {jp.kind === "case_answering" && entry.examiner ? (
          <>
            <h2>AI 평가 사전 점검</h2>
            <p style={{ fontSize: 14, margin: "0 0 10px" }}>
              재채점 결과가 안정적인지, 꾸며낸 답을 가려내는지 확인합니다.
              기준을 바꾸면 다시 점검합니다.
            </p>

            {!validReport ? (
              <div>
                {running ? (
                  <>
                    <CheckCards checks={liveChecks} progress={progress} />
                    <p className="hint">{progress}</p>
                  </>
                ) : (
                  <CheckCards checks={null} progress={progress} />
                )}
                {batteryErrorBox}
              </div>
            ) : (
              <div>
                <div style={{ marginBottom: 8 }}>
                  종합: <VerdictBadge verdict={examinerReport!.overall} />
                  <span className="hint" style={{ marginLeft: 6 }}>
                    점검에 사용한 AI 모델:{" "}
                    {formatModelLabel(examinerReport!.judge.provider, examinerReport!.judge.model)}
                  </span>
                </div>
                <CheckCards checks={examinerReport!.checks} progress="" />
                <div style={{ marginTop: 10 }}>
                  {reportFailed ? (
                    <p className="error" style={{ margin: "0 0 8px" }}>
                      사전 점검 실패 — 기준을 수정하면 다시 점검합니다.
                    </p>
                  ) : null}
                  <button onClick={() => void runBattery()} disabled={running}>
                    {running ? `점검 중… ${progress}` : "다시 점검"}
                  </button>
                  {batteryErrorBox}
                </div>
              </div>
            )}
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
                평가 구성 승인
              </button>
              <button onClick={() => navigate("/wizard")}>입력 수정</button>
            </div>
          </div>
        )}
      </div>

      <aside className="approve-side">
        <ActivityConsole
          model={jp.kind === "case_answering" ? jp.judge.model : undefined}
          empty="사전 점검 결과가 여기에 표시됩니다."
          height={560}
        />
      </aside>
      </div>
    </div>
  );
}
