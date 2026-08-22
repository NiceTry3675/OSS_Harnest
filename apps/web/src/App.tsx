import { Link, Route, Routes } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { WizardPage } from "./pages/WizardPage";
import { ApprovalPage } from "./pages/ApprovalPage";
import { ConsolePage } from "./pages/ConsolePage";
import { ResultsPage } from "./pages/ResultsPage";

export function App() {
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">Harnest</Link>
        <span className="tagline">당신이 승인한 기준으로, 될 때까지 스스로 고치는 AI</span>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/wizard" element={<WizardPage />} />
          <Route path="/approve" element={<ApprovalPage />} />
          <Route path="/console" element={<ConsolePage />} />
          <Route path="/results" element={<ResultsPage />} />
        </Routes>
      </main>
    </div>
  );
}
