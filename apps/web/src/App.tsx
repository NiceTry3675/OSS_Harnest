import { useEffect, useState } from "react";
import { Link, Route, Routes } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { WizardPage } from "./pages/WizardPage";
import { ApprovalPage } from "./pages/ApprovalPage";
import { ConsolePage } from "./pages/ConsolePage";
import { ResultsPage } from "./pages/ResultsPage";
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

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">Harnest</Link>
        <span className="tagline">당신이 승인한 평가 절차로, 정해진 범위 안에서 개선을 측정하는 AI</span>
        <div className="topbar-right">
          <ThemeToggle />
        </div>
      </header>
      <main>
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
