/** 첫 방문 안내 — 다섯 단계를 화면 미리보기와 함께 넘겨 본다.
 *
 *  "숨긴 질문"이나 "기준 잠금" 같은 개념은 글로만 읽으면 와닿지 않는다.
 *  나중에 실제 화면에서 만났을 때 알아볼 수 있도록 축소한 모습을 미리 보여준다.
 *  한 번 닫으면 이 브라우저에서는 다시 뜨지 않는다. */

import { useCallback, useEffect, useState } from "react";

const SEEN_KEY = "harnest.tour.seen";

const SLIDES = [
  {
    title: "무엇을 맡길지 고릅니다",
    desc: "잘 만들었는지 사람이 판단해야 하는 일을 맡깁니다.",
  },
  {
    title: "실제 질문과 답을 넣습니다",
    desc: "이 질문들로 채점합니다. 일부는 숨겨두었다가 맨 끝에만 꺼냅니다.",
  },
  {
    title: "기준을 확인하고 잠급니다",
    desc: "무엇으로 몇 점을 줄지 직접 봅니다. 승인하는 순간 AI도 바꿀 수 없습니다.",
  },
  {
    title: "점수가 오르는 걸 지켜봅니다",
    desc: "AI가 고칠 때마다 채점하고, 더 나은 것만 남깁니다.",
  },
  {
    title: "숨긴 질문으로 확인합니다",
    desc: "한 번도 보여주지 않은 질문으로 채점해, 답을 외운 게 아님을 확인합니다.",
  },
] as const;

/** 각 단계를 축소해 그린 그림 — 실제 화면의 배치를 닮게만 만든다 */
function Shot({ at }: { at: number }) {
  if (at === 0) {
    return (
      <div className="shot-rows">
        <div className="sk-title" />
        <div className="sk-title sk-sub" />
        <div className="shot-split">
          <div className="shot-grow">
            <div className="sk-line" style={{ width: "88%" }} />
            <div className="sk-line" style={{ width: "70%" }} />
            <div className="sk-line" style={{ width: "52%" }} />
          </div>
          <div className="sk-orb">100</div>
        </div>
      </div>
    );
  }
  if (at === 1) {
    return (
      <div className="shot-split">
        <div className="shot-grow">
          <div className="sk-card">
            <div className="sk-line" style={{ width: "64%" }} />
            <div className="sk-line sk-faint" style={{ width: "86%" }} />
          </div>
          <div className="sk-card">
            <div className="sk-line" style={{ width: "52%" }} />
            <div className="sk-line sk-faint" style={{ width: "78%" }} />
          </div>
          <div className="sk-card sk-hidden">
            <span className="sk-pill">숨김</span>
            <div className="sk-line sk-blur" style={{ width: "44%" }} />
          </div>
          <div className="sk-card sk-hidden">
            <span className="sk-pill">숨김</span>
            <div className="sk-line sk-blur" style={{ width: "38%" }} />
          </div>
        </div>
        <div className="sk-panel">
          <div className="sk-item"><i>1</i><span /></div>
          <div className="sk-item"><i className="sk-gate">!</i><span /></div>
          <div className="sk-item"><i>2</i><span /></div>
          <div className="sk-item"><i className="sk-seal">?</i><span /></div>
        </div>
      </div>
    );
  }
  if (at === 2) {
    return (
      <div className="shot-mid">
        <div className="sk-lock" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M7 10.5V7.5a5 5 0 0 1 10 0v3" />
            <rect x="4.5" y="10.5" width="15" height="10" rx="3" fill="currentColor" stroke="none" />
          </svg>
        </div>
        <div className="sk-hash">3f9c2ab41d7e0c86</div>
        <div className="sk-checks">
          <i className="is-ok" /><i className="is-ok" /><i className="is-ok" /><i />
        </div>
      </div>
    );
  }
  if (at === 3) {
    return (
      <div className="sk-stage">
        <div className="sk-score">100<small>점</small></div>
        <div className="sk-from">처음 만든 문서는 49.9점이었습니다</div>
        <svg viewBox="0 0 260 46" preserveAspectRatio="none" className="sk-curve" aria-hidden="true">
          <path d="M0,40 L36,38 L58,34 L80,10 L120,7 L180,4 L260,4" />
          <line x1="0" x2="260" y1="40" y2="40" />
          <circle cx="260" cy="4" r="3.4" />
        </svg>
      </div>
    );
  }
  return (
    <div className="shot-mid">
      <div className="sk-jump">
        <span className="sk-old">49.9</span>
        <span className="sk-arrow">→</span>
        <span className="sk-new">100</span>
      </div>
      <div className="sk-reveal">숨긴 질문 2개로도 확인 — 92.5점</div>
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
        <p className="hint" style={{ margin: 0 }}>전부 5단계, 2분이면 끝납니다.</p>

        <div className="tour-frame">
          {SLIDES.map((_, i) => (
            <div key={i} className={`tour-shot${i === at ? " is-on" : ""}`} aria-hidden={i !== at}>
              <Shot at={i} />
            </div>
          ))}
        </div>

        <div className="tour-text">
          <strong>{at + 1}. {SLIDES[at].title}</strong>
          <p>{SLIDES[at].desc}</p>
        </div>

        <div className="tour-foot">
          <div className="tour-dots">
            {SLIDES.map((s, i) => (
              <button
                key={s.title}
                type="button"
                className={i === at ? "is-on" : ""}
                aria-label={`${i + 1}단계 안내 보기`}
                onClick={() => move(i)}
              />
            ))}
          </div>
          <button type="button" className="tour-arrow" disabled={at === 0}
            aria-label="이전 안내" onClick={() => move(at - 1)}>‹</button>
          <button type="button" className="tour-arrow" disabled={at === last}
            aria-label="다음 안내" onClick={() => move(at + 1)}>›</button>
          <button type="button" className="primary tour-go" onClick={onClose}>
            {at === last ? "시작하기" : "둘러보기"}
          </button>
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
