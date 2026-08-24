import { Link, Route, Routes } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { WizardPage } from "./pages/WizardPage";
import { ApprovalPage } from "./pages/ApprovalPage";
import { ConsolePage } from "./pages/ConsolePage";
import { ResultsPage } from "./pages/ResultsPage";
import { useProject } from "./state";

export function App() {
  const { hydrated } = useProject();

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">Harnest</Link>
        <span className="tagline">당신이 승인한 평가 절차로, 정해진 범위 안에서 개선을 측정하는 AI</span>
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
