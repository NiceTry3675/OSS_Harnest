/** 모의 모델 회귀 테스트 — 관통 시나리오: 원샷은 부분 커버, 변이가 실패 케이스를 흡수해 등반.
 *  승인 전 요건(검증 배터리 → 캘리브레이션 → 차단 해제)도 같은 모의 모델로 관통한다. */
import { describe, expect, it } from "vitest";
import { approvalBlockers, judgeCalibration, type CaseDef } from "@harnest/contracts";
import {
  buildCalibrationPairs,
  compile,
  createGenerator,
  createInitial,
  createScorer,
  runExaminerBattery,
  scoreHoldout,
} from "@harnest/template-handover";
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

  it("승인 전 요건 관통: 검증 배터리 → 캘리브레이션(꼼수 쌍 포함) → 승인 차단 해제", async () => {
    // 같은 케이스로 compile해 다이제스트가 결속된 팩을 얻는다 (5케이스 → 가시 4 / 홀드아웃 1)
    const { problem: p, pack } = await compile(
      {
        schemaVersion: "skeleton-1",
        templateId: "handover",
        answers: {
          material: problem.material,
          cases: [...problem.visibleCases, ...problem.holdoutCases].map(
            ({ question, expectedAnswer }) => ({ question, expectedAnswer }),
          ),
          lengthCap: problem.lengthCap,
        },
      },
      { judgeProvider: "mock", judgeModel: "모의 모델" },
    );
    const llm = createMockClient(p);

    const run = await runExaminerBattery(p, pack, llm);
    expect(run.report.forDigest).toBe(pack.definitionDigest);
    // 종합 "주의"의 출처까지 고정: 순서(절단본 0 = 빈 문서 0 동점)와 꼼수 내성(모의 grader가
    // 오염 응답에 부분 점수) — 정직 표기가 그대로 판정에 남는다
    expect(run.report.checks.map((c) => `${c.id}:${c.verdict}`)).toEqual([
      "ordering:warn",
      "discrimination:pass",
      "stability:pass",
      "hack_resistance:warn",
    ]);
    expect(run.report.overall).toBe("warn");

    const pairs = buildCalibrationPairs(run, pack);
    expect(pairs.length).toBeGreaterThanOrEqual(2);
    expect(pairs[0].kind).toBe("hack_probe");

    // 승인 요건: 리포트만으로는 부족하고, 사용자 판정이 모두 모여야 차단이 풀린다
    expect(approvalBlockers(pack, run.report, null)).toHaveLength(1);
    const calibration = judgeCalibration(
      pairs,
      pairs.map((s) => s.examinerChoice),
      pack,
      run.report,
    );
    expect(calibration.verdict).toBe("pass");
    expect(approvalBlockers(pack, run.report, calibration)).toEqual([]);

    // 검증을 다시 실행하면(새 리포트 인스턴스) 이전 캘리브레이션은 자동 무효
    // (리포트 인스턴스 결속 규칙 자체는 contracts/examiner.test.ts가 결정적으로 검증)
    expect(
      approvalBlockers(
        pack,
        { ...run.report, ranAt: "2026-08-23T23:59:59.000Z" },
        calibration,
      ).some((b) => b.includes("검증이 다시 실행")),
    ).toBe(true);
  });
});
