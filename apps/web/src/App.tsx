import { useEffect, useState } from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { WizardPage } from "./pages/WizardPage";
import { ApprovalPage } from "./pages/ApprovalPage";
import { ConsolePage } from "./pages/ConsolePage";
import { ResultsPage } from "./pages/ResultsPage";
import { StepBar } from "./components/StepBar";
import { useProject } from "./state";
import {
  applyTheme, nextTheme, readTheme, saveTheme, THEME_ICON, THEME_LABEL,
  type ThemeChoice,
} from "./lib/theme";

/** 밝은 화면 ↔ 어두운 화면 ↔ 시스템 설정을 순환한다 */
function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>("system");

  useEffect(() => {
    const saved = readTheme();
    setChoice(saved);
    applyTheme(saved);
  }, []);

  const cycle = () => {
    const next = nextTheme(choice);
    setChoice(next);
    saveTheme(next);
  };

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={cycle}
      title={THEME_LABEL[choice]}
      aria-label={`화면 밝기 — 현재 ${THEME_LABEL[choice]}`}
    >
      {THEME_ICON[choice]}
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
