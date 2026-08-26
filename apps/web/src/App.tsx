import { useEffect, useState } from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { WizardPage } from "./pages/WizardPage";
import { ApprovalPage } from "./pages/ApprovalPage";
import { ConsolePage } from "./pages/ConsolePage";
import { ResultsPage } from "./pages/ResultsPage";
import { TerminologyComparePage } from "./pages/TerminologyComparePage";
import { StepBar } from "./components/StepBar";
import { useProject } from "./state";
import {
  applyTheme, oppositeTheme, readTheme, resolvedTheme, saveTheme,
  THEME_ICON, THEME_LABEL, type Rendered,
} from "./lib/theme";

/** 밝은 화면 ↔ 어두운 화면 ↔ 시스템 설정을 순환한다 */
function ThemeToggle() {
  // 지금 화면에 적용된 테마를 들고 있다가, 누르면 곧바로 반대로 넘긴다
  const [shown, setShown] = useState<Rendered>("light");

  useEffect(() => {
    const saved = readTheme();
    applyTheme(saved);
    setShown(resolvedTheme(saved));

    // 시스템 설정을 따르는 동안에는 OS가 바뀌면 같이 바뀐다
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      if (readTheme() === "system") setShown(resolvedTheme("system"));
    };
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const flip = () => {
    const next = oppositeTheme();
    saveTheme(next);
    setShown(next);
  };

  const other: Rendered = shown === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={flip}
      title={`${THEME_LABEL[other]}으로 바꾸기`}
      aria-label={`${THEME_LABEL[other]}으로 바꾸기 — 지금은 ${THEME_LABEL[shown]}`}
    >
      {THEME_ICON[shown]}
    </button>
  );
}

export function App() {
  const { hydrated } = useProject();
  const { pathname } = useLocation();

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">Harnest</Link>
        <div className="topbar-right">
          {import.meta.env.DEV ? <Link to="/terminology-compare" className="compare-link">용어 비교</Link> : null}
          <StepBar />
          <ThemeToggle />
        </div>
      </header>
      {/* key를 경로로 두면 화면이 바뀔 때마다 진입 애니메이션이 다시 돈다 */}
      <main key={pathname} className="route-swap">
        {hydrated ? (
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/wizard" element={<WizardPage />} />
            <Route path="/approve" element={<ApprovalPage />} />
            <Route path="/console" element={<ConsolePage />} />
            <Route path="/results" element={<ResultsPage />} />
            {import.meta.env.DEV ? <Route path="/terminology-compare" element={<TerminologyComparePage />} /> : null}
          </Routes>
        ) : (
          <div className="card">
            <p className="sub" style={{ margin: 0 }}>저장된 프로젝트를 불러오는 중…</p>
          </div>
        )}
      </main>
    </div>
  );
}
