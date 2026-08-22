/** 모의 모델 회귀 테스트 — 관통 시나리오: 원샷은 부분 커버, 변이가 실패 케이스를 흡수해 등반. */
import { describe, expect, it } from "vitest";
import type { CaseDef } from "@harnest/contracts";
import { createGenerator, createInitial, createScorer, scoreHoldout } from "@harnest/template-handover";
import type { HandoverProblem } from "@harnest/template-handover";
import { createMockClient } from "./llm";

const c = (id: string, q: string, a: string): CaseDef => ({ id, question: q, expectedAnswer: a });

const problem: HandoverProblem = {
  material: "저는 사내 배포 파이프라인을 관리합니다.",
  visibleCases: [
    c("case-1", "배포는 어떻게 시작하나요?", "매주 화요일 오전에 스테이징에서 deploy.sh를 먼저 실행합니다."),
    c("case-2", "배포가 실패하면 어떻게 롤백하나요?", "rollback.sh에 직전 릴리스 태그를 넘기면 이전 버전으로 돌아갑니다."),
    c("case-3", "마이그레이션은 누가 승인하나요?", "데이터팀 리드의 승인을 받아야 하며 금요일에는 실행하지 않습니다."),
    c("case-4", "모니터링 알림은 어디로 오나요?", "그라파나 경보가 슬랙 채널로 오고 심각도가 높으면 전화까지 연결됩니다."),
  ],
  holdoutCases: [
    c("case-5", "비밀 키는 어디에 보관하나요?", "모든 비밀 키는 볼트에 저장하며 저장소에 넣는 것은 금지입니다."),
  ],
  lengthCap: 2000,
};

describe("모의 모델 관통", () => {
  it("원샷은 부분 커버(0 < 기준선 < 100), 변이가 실패 케이스를 흡수해 엄격 개선한다", async () => {
    const llm = createMockClient(problem);
    const scorer = createScorer(problem, llm);
    const initial = createInitial(problem, llm);
    const generate = createGenerator(problem, llm);

    const doc0 = await initial(() => 0);
    const s0 = await scorer(doc0);
    expect(s0.gateRejected).toBe(false);
    expect(s0.total).toBeGreaterThan(0);
    expect(s0.total).toBeLessThan(100);

    const doc1 = await generate(doc0, () => 0, {
      round: 1,
      championScore: s0.total,
      championViolations: s0.violations,
    });
    const s1 = await scorer(doc1);
    expect(s1.total).toBeGreaterThan(s0.total);
  });

  it("홀드아웃은 문서에 없는 내용이라 낮게 나온다 — Generator가 홀드아웃을 본 적 없음의 방증", async () => {
    const llm = createMockClient(problem);
    const doc0 = await createInitial(problem, llm)(() => 0);
    const h = await scoreHoldout(problem, doc0, llm);
    expect(h.score).toBe(0);
    expect(h.perCase).toHaveLength(1);
  });
});
