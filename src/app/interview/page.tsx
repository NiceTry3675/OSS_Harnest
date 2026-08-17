import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { LiveBlueprint } from "@/components/LiveBlueprint";
import { blueprintItems } from "@/lib/mock-data";

export default function InterviewPage() {
  return (
    <AppShell activeStep="interview">
      <section className="page-frame">
        <div className="panel">
          <div className="panel-header">
            <p className="eyebrow">Guided interview</p>
            <h1 className="section-title">개선할 목표와 필요한 맥락을 입력합니다</h1>
          </div>
          <div className="panel-body">
            <div className="form-grid">
              <label>
                목표
                <input defaultValue="카카오 서버 개발자 공고에 맞게 자기소개서를 개선하고 싶다" />
              </label>
              <label>
                채용공고
                <textarea defaultValue="카카오 서버 개발자 채용 공고 내용을 여기에 붙여넣습니다." />
              </label>
              <label>
                자기소개서 초안
                <textarea defaultValue="저는 다양한 프로젝트를 경험했습니다..." />
              </label>
              <label>
                반드시 포함할 내용
                <input defaultValue="Spring, MSA 경험, 장애 대응 경험" />
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
              <div className="button-row">
                <Link className="primary-button" href="/criteria">
                  평가 기준 제안 받기
                </Link>
              </div>
            </div>
          </div>
        </div>
        <LiveBlueprint items={blueprintItems} />
      </section>
    </AppShell>
  );
}
