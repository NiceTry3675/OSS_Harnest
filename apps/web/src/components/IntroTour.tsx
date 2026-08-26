/** 첫 방문 안내 — 목표에서 결과까지 다섯 장으로 보여준다.
 *
 *  Harnest는 특정 문서를 만들어 주는 도구가 아니다. 사용자가 목표를 말하면
 *  그것을 채점표로 정리하고, 그 채점표를 잠근 뒤, 통과할 때까지 고쳐 쓴다.
 *  그래서 안내도 산출물이 아니라 그 절차를 따라간다.
 *
 *  그림은 실제 화면의 배치를 닮게 그린다. 나중에 진짜 화면에서 만났을 때
 *  알아볼 수 있어야 안내가 값을 한다.
 *
 *  한 번 닫으면 이 브라우저에서는 다시 뜨지 않는다. */

import { useCallback, useEffect, useState } from "react";

const SEEN_KEY = "harnest.tour.seen";

interface Slide {
  /** 화면 상단 부제 — 장마다 다르다 */
  lead: string;
  title: string;
  desc: string;
}

const SLIDES: Slide[] = [
  {
    lead: "1 — 목표",
    title: "무엇을 만들지, 무엇을 잘한 걸로 볼지 적습니다",
    desc: "맡길 일을 설명하고 실제로 받았던 질문과 답을 넣습니다. 분량과 채점 모델도 여기서 정합니다.",
  },
  {
    lead: "2 — 채점표",
    title: "그 목표가 그대로 채점표가 됩니다",
    desc: "적은 내용이 기준과 가중치, 반드시 지켜야 할 조건으로 정리됩니다. 사람이 읽을 수 있는 형태입니다.",
  },
  {
    lead: "3 — 점검·승인",
    title: "채점할 AI가 제대로 채점하는지 먼저 시험합니다",
    desc: "순서를 바꿔도 같은 판정을 내는지, 없는 내용을 지어내지 않는지 확인합니다. 통과해야 승인할 수 있습니다.",
  },
  {
    lead: "4 — 잠금",
    title: "승인하는 순간 채점표가 잠깁니다",
    desc: "기준과 조건, 채점 모델까지 함께 잠깁니다. 실행이 끝날 때까지 AI도 사람도 바꾸지 못합니다.",
  },
  {
    lead: "5 — 실행·결과",
    title: "목표에 닿을 때까지 고쳐 씁니다",
    desc: "회차마다 같은 채점표로 재고, 점수가 실제로 오른 것만 남깁니다. 일부 질문은 개선에 쓰지 않고 시작과 끝에만 따로 채점합니다.",
  },
];

/** 각 장의 그림 — 실제 화면의 배치를 닮게만 그린다 */
function Shot({ at }: { at: number }) {
  // 1. 목표를 적는다
  if (at === 0) {
    return (
      <div className="tv-goal">
        <span className="tv-label">맡길 일</span>
        <div className="tv-field">신입이 물어보지 않고도 일할 수 있는 문서를 만들고 싶습니다</div>
        <div className="tv-chips">
          <span>질문·답 10개</span>
          <span>분량 8,000자</span>
          <span>채점 모델 선택</span>
        </div>
      </div>
    );
  }

  // 2. 목표가 채점표가 된다
  if (at === 1) {
    return (
      <div className="tv-make">
        <div className="tv-from">
          <span className="tv-label">적은 내용</span>
          <div className="tv-field is-small">질문 10개 · 분량 8,000자</div>
        </div>
        <span className="tv-arrow" aria-hidden="true">→</span>
        <div className="tv-to">
          <div className="tv-rule">
            <span>문서만 보고 답할 수 있는가</span>
            <b>80%</b>
          </div>
          <div className="tv-rule">
            <span>간결성</span>
            <b>20%</b>
          </div>
          <div className="tv-rule is-gate">
            <span>분량 8,000자 이하</span>
            <b>필수</b>
          </div>
        </div>
      </div>
    );
  }

  // 3. 채점 모델을 시험한다
  if (at === 2) {
    return (
      <div className="tv-checks">
        <div className="tv-check-row is-ok"><i aria-hidden="true">✓</i>순서를 바꿔도 같은 판정</div>
        <div className="tv-check-row is-ok"><i aria-hidden="true">✓</i>좋은 답과 나쁜 답을 가려냄</div>
        <div className="tv-check-row is-ok"><i aria-hidden="true">✓</i>두 번 재도 점수가 같음</div>
        <div className="tv-check-row"><i aria-hidden="true">…</i>없는 내용에 점수를 주지 않음</div>
      </div>
    );
  }

  // 4. 승인하면 잠긴다
  if (at === 3) {
    return (
      <div className="tv-lockshot">
        <div className="tv-lockmark">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
            <path d="M7 10.5V7.5a5 5 0 0 1 10 0v3" />
            <rect x="4.5" y="10.5" width="15" height="10" rx="3" fill="currentColor" stroke="none" />
          </svg>
        </div>
        <div className="tv-locked">
          <span>기준 · 가중치</span>
          <span>반드시 지켜야 할 조건</span>
          <span>채점 모델</span>
        </div>
        <div className="tv-hash">3f9c2ab41d7e0c86</div>
      </div>
    );
  }

  // 5. 실행하고 결과를 본다
  return (
    <div className="tv-run">
      <svg className="tv-curve" viewBox="0 0 200 76" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" x2="200" y1="68" y2="68" />
        <path d="M6 62 L52 55 L98 34 L144 26 L194 12" />
        <circle cx="194" cy="12" r="4" />
      </svg>
      <div className="tv-ends">
        <span>시작</span>
        <span className="is-after">종료</span>
      </div>
      <p className="tv-note">개선에 쓰지 않은 질문으로 시작과 끝을 따로 잽니다</p>
    </div>
  );
}

export function IntroTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [at, setAt] = useState(0);
  const last = SLIDES.length - 1;

  useEffect(() => {
    if (open) setAt(0);
  }, [open]);

  const move = useCallback(
    (next: number) => setAt((a) => (next < 0 || next > last ? a : next)),
    [last],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setAt((a) => Math.min(last, a + 1));
      if (e.key === "ArrowLeft") setAt((a) => Math.max(0, a - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, last, onClose]);

  if (!open) return null;

  return (
    <div
      className="tour-veil is-open"
      role="dialog"
      aria-modal="true"
      aria-label="진행 안내"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="tour">
        <div className="tour-head">
          <h2>이렇게 진행됩니다</h2>
          <span className="tour-count">{at + 1} / {SLIDES.length}</span>
        </div>
        <p className="tour-lead">{SLIDES[at].lead}</p>

        <div className="tour-frame">
          {SLIDES.map((s, i) => (
            <div key={s.title} className={`tour-shot${i === at ? " is-on" : ""}`} aria-hidden={i !== at}>
              <Shot at={i} />
            </div>
          ))}
        </div>

        <div className="tour-text">
          <strong>{SLIDES[at].title}</strong>
          <p>{SLIDES[at].desc}</p>
        </div>

        <div className="tour-foot">
          <div className="tour-dots">
            {SLIDES.map((s, i) => (
              <button
                key={s.title}
                type="button"
                className={i === at ? "is-on" : ""}
                aria-label={`${i + 1}번째 안내 보기`}
                onClick={() => move(i)}
              />
            ))}
          </div>
          <button type="button" className="tour-arrow" disabled={at === 0}
            aria-label="이전 안내" onClick={() => move(at - 1)}>‹</button>
          {at === last ? (
            <button type="button" className="primary tour-go" onClick={onClose}>
              시작하기
            </button>
          ) : (
            <>
              <button type="button" className="tour-skip" onClick={onClose}>
                건너뛰기
              </button>
              <button type="button" className="primary tour-go" onClick={() => move(at + 1)}>
                다음
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** 이 브라우저에서 안내를 본 적이 있는지 */
export function tourSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

export function markTourSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* 저장할 수 없으면 매번 보여준다 — 기능에는 영향이 없다 */
  }
}
