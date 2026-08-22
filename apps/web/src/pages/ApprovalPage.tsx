/** 승인 화면 — 판정 절차 전체를 사용자 앞에 펼치고, 승인 순간 동결한다(SPEC §3 원칙 4).
 *  면제·미구현 항목의 그대로-노출은 미결 4 표기 규칙의 스켈레톤 구현 — 정직 표기가 계약이다.
 *  pack만 보고 렌더하며 템플릿별 분기를 갖지 않는다(judgeProcedure union으로 분기). */

import { Link, useNavigate } from "react-router-dom";
import { useProject } from "../state";

const NOTICE_LABEL = {
  examinerReport: "검증 리포트",
  calibration: "캘리브레이션",
  pairwise: "쌍대 비교",
} as const;

const PROVIDER_LABEL: Record<"gemini" | "mock", string> = { gemini: "Gemini", mock: "모의" };

function NoticeTable({ rows }: { rows: Record<keyof typeof NOTICE_LABEL, string> }) {
  return (
    <table className="grid">
      <tbody>
        {(Object.keys(NOTICE_LABEL) as Array<keyof typeof NOTICE_LABEL>).map((k) => (
          <tr key={k}>
            <th style={{ textAlign: "left", whiteSpace: "nowrap" }}>{NOTICE_LABEL[k]}</th>
            <td style={{ textAlign: "left" }}>{rows[k]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ApprovalPage() {
  const { compiled, approvedAt, approve } = useProject();
  const navigate = useNavigate();

  if (!compiled) {
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

  const { pack } = compiled;
  const approved = approvedAt !== null;
  const jp = pack.judgeProcedure;
  const hp = pack.holdoutPolicy;

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
            <p className="hint" style={{ margin: "0 0 10px" }}>
              이 모델은 판정 절차의 일부로 승인 시 동결됩니다 — 교체하려면 다시 승인해야 합니다.
            </p>
            <NoticeTable rows={jp.notices} />
          </>
        ) : (
          <>
            <h2>검증·면제 표기</h2>
            <NoticeTable rows={jp.exemptions} />
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

        {approved ? (
          <div style={{ marginTop: 18 }}>
            <div className="hint">동결 다이제스트</div>
            <div className="mono digest">{pack.definitionDigest}</div>
            <p className="hint" style={{ marginTop: 10 }}>
              동결된 기준은 여기서 수정할 수 없습니다. 바꾸려면 처음부터 새 기준을 만들어
              다시 승인해야 합니다.
            </p>
            <div style={{ marginTop: 12 }}>
              <button className="primary" onClick={() => navigate("/console")}>
                실행 화면으로
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
            <button className="primary" onClick={approve}>
              승인하고 동결
            </button>
            <button onClick={() => navigate("/wizard")}>수정하러 가기</button>
          </div>
        )}
      </div>
    </div>
  );
}
