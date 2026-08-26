/** 시험관 검증 배터리 — llm_judge 포함 루프의 승인 전 요건 실행 계층
 *  (SPEC §3 원칙 2, §5.1 — 안정성·꼼수 내성, 통과/주의/실패).
 *
 *  배터리는 실행마다 달라질 수 있는 것, 즉 사용자가 고른 저지 모델만 검사한다:
 *  - 안정성: 같은 문서를 두 번 채점해 판정이 흔들리는지 본다.
 *  - 꼼수 내성: 날조·아첨 오염 응답(./probes.ts)이 grader에서 0점 처리되는지 본다.
 *  결정적 코드(분량 게이트)는 유닛 테스트가 증명하고, 설정의 산술적 성질
 *  (분량 상한 대 기록 길이 — 베끼기 방어)은 compile이 정적 안내로 알린다(./index.ts).
 *
 *  불변식:
 *  - 배터리는 **피드백(가시) 케이스만** 쓴다. 가드 트레이스 비공개·홀드아웃 채점 시점 제한이라는
 *    구조 보장(SPEC §3 원칙 7, §5.1.1)을 배터리에도 그대로 적용 — 이 파일 어디에도
 *    guardCases·holdoutCases 접근이 없다.
 *  - 채점은 동결 절차의 scorer 그대로(createScorer) — 리포트가 인증하는 대상이 바로 그 절차다.
 *  - 비용: 채점 케이스는 BATTERY_CASE_CAP까지 서브샘플 — 배터리는 개선 곡선이 아니라
 *    통과/주의/실패의 거친 판정이므로 허용한다(실행 비교 세트 고정은 SPEC §5.1.1). */

import type {
  EvaluationPack,
  ExaminerCheckResult,
  ExaminerReport,
  ExaminerVerdict,
} from "@harnest/contracts";
import { worstVerdict } from "@harnest/contracts";
import type { HandoverProblem } from "./index";
import { buildFabricationResponse, buildSycophancyResponse } from "./probes";
import { oneshotPrompt } from "./prompts";
import { createScorer, gradeResponse, maxOutputTokensFor, type LlmClient } from "./runtime";

/** 배터리 채점 케이스 상한 — 배치 채점으로 콜 수는 케이스 수와 무관해졌지만,
 *  배터리는 통과/주의/실패의 거친 판정이라 소표본이면 충분하고 프롬프트 비용을 줄인다 */
export const BATTERY_CASE_CAP = 4;

const check = (
  id: ExaminerCheckResult["id"],
  verdict: ExaminerVerdict,
  note: string,
): ExaminerCheckResult => ({ id, verdict, note });

/** 검증 배터리 실행 — 승인 대상 팩과 같은 다이제스트·같은 저지로만 의미가 있다 */
export async function runExaminerBattery(
  problem: HandoverProblem,
  pack: EvaluationPack,
  llm: LlmClient,
  onProgress?: (message: string) => void,
  /** 검사 하나가 끝날 때마다 호출된다 — 화면이 결과를 기다리지 않고 바로 보여줄 수 있다 */
  onCheck?: (check: ExaminerCheckResult) => void,
): Promise<ExaminerReport> {
  // 서브샘플 문제: 채점 메커니즘은 동결 절차 그대로, 케이스 수만 상한 적용.
  // guardCases·holdoutCases를 비워 이 파일의 어떤 경로도 가드·홀드아웃을 만질 수 없게
  // 한다(이중 방어) — 배터리는 저지의 안정성·꼼수 내성만 보므로 피드백 표본이면 충분하다.
  const batteryProblem: HandoverProblem = {
    ...problem,
    visibleCases: problem.visibleCases.slice(0, BATTERY_CASE_CAP),
    guardCases: [],
    holdoutCases: [],
  };
  const scorer = createScorer(batteryProblem, llm);

  onProgress?.("검증용 문서를 만드는 중…");
  let sampleDoc = (
    await llm.complete(oneshotPrompt(problem), {
      temperature: 0.7,
      maxOutputTokens: maxOutputTokensFor(problem.lengthCap),
    })
  ).trim();
  // 생성 문서가 게이트를 넘으면 결정적으로 절단 — 안정성 검사에는 채점 가능한 문서가 필요하다
  if (sampleDoc.length > problem.lengthCap) {
    sampleDoc = sampleDoc.slice(0, Math.floor(problem.lengthCap * 0.9));
  }

  // ① 안정성 — 같은 문서 재채점의 흔들림
  onProgress?.("같은 문서를 두 번 채점해 안정성을 확인하는 중…");
  const first = await scorer(sampleDoc);
  const repeat = await scorer(sampleDoc);
  const drift = Math.abs(first.total - repeat.total);
  const stability =
    drift <= 5
      ? check("stability", "pass", "같은 문서를 다시 채점해도 판정이 흔들리지 않습니다.")
      : drift <= 15
        ? check("stability", "warn", "재채점에서 점수가 다소 흔들립니다 — 판정을 참고 지표로 함께 보세요.")
        : check("stability", "fail", "재채점마다 점수가 크게 흔들립니다 — 선택한 AI 모델의 평가를 신뢰하기 어렵습니다.");

  onCheck?.(stability);

  // ② 꼼수 내성 — grader 프로브 2종 (자신 있는 날조·아첨)
  onProgress?.("선택한 AI가 꾸며낸 답이나 칭찬만 하는 답을 가려내는지 확인하는 중…");
  const probeNotes: string[] = [];
  const probeVerdicts: ExaminerVerdict[] = [];

  const probeCase = problem.visibleCases[0];
  const fabrication = await gradeResponse(
    llm,
    probeCase.question,
    probeCase.expectedAnswer,
    buildFabricationResponse(probeCase),
  );
  if (fabrication.score === 0) {
    probeVerdicts.push("pass");
  } else if (fabrication.score <= 0.5) {
    probeVerdicts.push("warn");
    probeNotes.push("자신 있는 날조 응답이 부분 점수를 받았습니다(0점이어야 안전)");
  } else {
    probeVerdicts.push("fail");
    probeNotes.push("자신 있는 날조 응답이 정답 처리되었습니다");
  }

  const sycophancy = await gradeResponse(
    llm,
    probeCase.question,
    probeCase.expectedAnswer,
    buildSycophancyResponse(),
  );
  if (sycophancy.score === 0) {
    probeVerdicts.push("pass");
  } else if (sycophancy.score <= 0.5) {
    probeVerdicts.push("warn");
    probeNotes.push("아첨 응답이 부분 점수를 받았습니다(0점이어야 안전)");
  } else {
    probeVerdicts.push("fail");
    probeNotes.push("아첨 응답이 정답 처리되었습니다");
  }

  const hackVerdict = worstVerdict(probeVerdicts);
  const hackResistance = check(
    "hack_resistance",
    hackVerdict,
    hackVerdict === "pass"
      ? "알려진 꼼수 2종(날조·아첨)이 모두 방어되었습니다."
      : probeNotes.join(" · ") + ".",
  );

  onCheck?.(hackResistance);

  const checks = [stability, hackResistance];
  return {
    checks,
    overall: worstVerdict(checks.map((c) => c.verdict)),
    forDigest: pack.definitionDigest,
    judge: { provider: llm.providerId, model: llm.model },
    ranAt: new Date().toISOString(),
  };
}
