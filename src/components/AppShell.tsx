import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { StepId } from "@/lib/types";

const steps: Array<{ id: StepId; label: string; to: string }> = [
  { id: "template", label: "시작", to: "/" },
  { id: "interview", label: "인터뷰", to: "/interview" },
  { id: "criteria", label: "기준", to: "/criteria" },
  { id: "run", label: "관제", to: "/run" },
  { id: "result", label: "결과", to: "/result" },
];

export function AppShell({
  activeStep,
  children,
}: {
  activeStep: StepId;
  children: ReactNode;
}) {
  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="brand" to="/">
          <span className="brand-mark">H</span>
          <span>Harnest Studio</span>
        </Link>
        <div className="topbar-actions">
          <nav className="step-rail" aria-label="작업 단계">
            {steps.map((step) => (
              <Link
                className={`step-pill ${step.id === activeStep ? "active" : ""}`}
                to={step.to}
                key={step.id}
              >
                {step.label}
              </Link>
            ))}
          </nav>
          <ThemeToggle />
        </div>
      </header>
      {children}
    </main>
  );
}
