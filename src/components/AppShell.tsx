import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { StepId } from "@/lib/types";

const steps: Array<{ id: StepId; label: string; href: string }> = [
  { id: "template", label: "시작", href: "/" },
  { id: "interview", label: "인터뷰", href: "/interview" },
  { id: "criteria", label: "기준", href: "/criteria" },
  { id: "run", label: "관제", href: "/run" },
  { id: "result", label: "결과", href: "/result" },
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
        <Link className="brand" href="/">
          <span className="brand-mark">H</span>
          <span>Harnest Studio</span>
        </Link>
        <div className="topbar-actions">
          <nav className="step-rail" aria-label="작업 단계">
            {steps.map((step) => (
              <Link
                className={`step-pill ${step.id === activeStep ? "active" : ""}`}
                href={step.href}
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
