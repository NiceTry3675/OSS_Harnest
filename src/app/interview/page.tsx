"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { LiveBlueprint } from "@/components/LiveBlueprint";
import { blueprintItems } from "@/lib/mock-data";
import { submitInterviewDraft } from "@/lib/api/client";
import { harnestStorage } from "@/lib/api/storage";
import type { InterviewPayload } from "@/lib/api/types";

export default function InterviewPage() {
  const router = useRouter();
  const [goal, setGoal] = useState("카카오 서버 개발자 공고에 맞게 자기소개서를 개선하고 싶다");
  const [jobPosting, setJobPosting] = useState(
    "카카오 서버 개발자 채용 공고: Spring 기반 REST API 개발, MSA 환경 운영, 대용량 트래픽 처리, 장애 대응 경험, 주문/결제 도메인 이해를 요구합니다.",
  );
  const [artifact, setArtifact] = useState("저는 다양한 프로젝트를 경험했습니다...");
  const [mustInclude, setMustInclude] = useState("Spring, MSA 경험, 장애 대응 경험");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const payload: InterviewPayload = {
      schemaVersion: "0.1.0",
      projectId: null,
      template: {
        id: "resume-match",
        version: "1.0.0",
      },
      mode: "lite",
      goal,
      artifact: {
        type: "text",
        label: "자기소개서",
        content: artifact,
        origin: artifact.trim() ? "user" : "generated",
      },
      answers: {
        job_posting: { type: "paste", value: jobPosting },
        must_include: { type: "text", value: mustInclude },
        length_limit: { type: "number", value: 1700 },
        tone: { type: "choice", value: "정중하고 간결하게" },
      },
      evaluation: null,
      loop: {
        maxIterations: 30,
        llmRoute: "trial",
        branching: { width: 1 },
        critic: true,
        stop: {
          targetScore: 80,
          plateauRounds: 8,
        },
      },
      client: {
        locale: "ko",
        submittedAt: new Date().toISOString(),
      },
    };

    try {
      const suggestion = await submitInterviewDraft(payload);
      harnestStorage.clearExecution();
      harnestStorage.setInterviewPayload({
        ...payload,
        projectId: suggestion.projectId,
      });
      harnestStorage.setEvaluationSuggestion(suggestion);
      router.push("/criteria");
    } catch {
      setError(
        "평가 기준 후보를 가져오지 못했습니다. FastAPI 서버 실행 여부와 NEXT_PUBLIC_API_BASE_URL 설정을 확인하세요.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AppShell activeStep="interview">
      <section className="page-frame">
        <div className="panel">
          <div className="panel-header">
            <p className="eyebrow">Guided interview</p>
            <h1 className="section-title">개선할 목표와 필요한 맥락을 입력합니다</h1>
          </div>
          <div className="panel-body">
            <form className="form-grid" onSubmit={handleSubmit}>
              <label>
                목표
                <input value={goal} onChange={(event) => setGoal(event.target.value)} />
              </label>
              <label>
                채용공고
                <textarea
                  value={jobPosting}
                  onChange={(event) => setJobPosting(event.target.value)}
                />
              </label>
              <label>
                자기소개서 초안
                <textarea
                  value={artifact}
                  onChange={(event) => setArtifact(event.target.value)}
                />
              </label>
              <label>
                반드시 포함할 내용
                <input
                  value={mustInclude}
                  onChange={(event) => setMustInclude(event.target.value)}
                />
              </label>
              <section className="harness-config">
                <div className="config-heading">
                  <div>
                    <p className="eyebrow">Harness setup</p>
                    <h2>채점표와 반복 조건</h2>
                  </div>
                  <span>사용자가 승인하면 잠김</span>
                </div>
                <div className="scorecard-grid">
                  <label>
                    채점 기준
                    <div className="criteria-chips">
                      <span>공고 핵심어 40%</span>
                      <span>직무 적합도 50%</span>
                      <span>글자 수 10%</span>
                    </div>
                  </label>
                  <label>
                    반복 횟수
                    <input defaultValue="최대 30회" />
                  </label>
                  <label>
                    목표 점수
                    <input defaultValue="80점 이상이면 종료" />
                  </label>
                  <label>
                    감점 규칙
                    <input defaultValue="글자 수 초과, 근거 없는 경험, 공고와 무관한 문장" />
                  </label>
                </div>
              </section>
              {error ? <p className="error-text">{error}</p> : null}
              <div className="button-row">
                <button className="primary-button" disabled={isSubmitting} type="submit">
                  {isSubmitting ? "평가 기준 생성 중" : "평가 기준 제안 받기"}
                </button>
              </div>
            </form>
          </div>
        </div>
        <LiveBlueprint items={blueprintItems} />
      </section>
    </AppShell>
  );
}
