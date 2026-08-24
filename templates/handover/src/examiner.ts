/** 시험관 검증 배터리 + 캘리브레이션 — llm_judge 포함 루프의 승인 전 요건 실행 계층
 *  (SPEC §3 원칙 2, §5.1 — 순서·변별력·안정성·꼼수 내성, 통과/주의/실패).
 *
 *  불변식:
 *  - 배터리·캘리브레이션은 **가시 케이스만** 쓴다. 홀드아웃 채점은 라운드 0·종료 시뿐이라는
 *    구조 보장(SPEC §3 원칙 7)을 배터리에도 그대로 적용 — 이 파일 어디에도 holdoutCases 접근이 없다.
 *  - 채점은 동결 절차의 scorer 그대로(createScorer) — 리포트가 인증하는 대상이 바로 그 절차다.
 *  - 사다리 문서는 순서·변별력·안정성 검사의 입력으로만 사용한다.
 *    꼼수 프로브는 큐레이션 라이브러리(./probes.ts)에서만 가져온다.
 *  - 비용: 채점 케이스는 BATTERY_CASE_CAP까지 서브샘플 — 배터리는 개선 곡선이 아니라
 *    통과/주의/실패의 거친 판정이므로 허용한다(실행 비교 세트 고정은 SPEC §5.1.1). */

import type {
  CalibrationPairSpec,
  EvaluationPack,
  ExaminerCheckResult,
  ExaminerReport,
  ExaminerVerdict,
} from "@harnest/contracts";
import { worstVerdict } from "@harnest/contracts";
import type { HandoverProblem } from "./index";
import {
  buildFabricationResponse,
  buildSycophancyResponse,
  buildVerbatimProbe,
  buildVerbosityProbe,
} from "./probes";
import { oneshotPrompt } from "./prompts";
import { createScorer, gradeResponse, type LlmClient } from "./runtime";

/** 배터리 채점 케이스 상한 — 사다리 4회 채점 × 케이스 × 2콜이 비용 지배 항이다 */
export const BATTERY_CASE_CAP = 4;

export interface BatteryArtifacts {
  goodDoc: string;
  degradedDoc: string;
  emptyDoc: string;
  verbosityDoc: string;
  verbatimDoc: string;
  /** 사다리의 동결 절차 채점 스칼라 — 캘리브레이션 쌍의 시험관 판정 근거 */
  scores: { good: number; degraded: number; empty: number };
}

export interface ExaminerRun {
  report: ExaminerReport;
  artifacts: BatteryArtifacts;
}

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
): Promise<ExaminerRun> {
  // 서브샘플 문제: 채점 메커니즘은 동결 절차 그대로, 케이스 수만 상한 적용.
  // holdoutCases를 비워 이 파일의 어떤 경로도 홀드아웃을 만질 수 없게 한다(이중 방어).
  const batteryProblem: HandoverProblem = {
    ...problem,
    visibleCases: problem.visibleCases.slice(0, BATTERY_CASE_CAP),
    holdoutCases: [],
  };
  const scorer = createScorer(batteryProblem, llm);

  onProgress?.("검증용 문서를 만드는 중…");
  let goodDoc = (await llm.complete(oneshotPrompt(problem), { temperature: 0.7 })).trim();
  // 생성 문서가 게이트를 넘으면 결정적으로 절단 — 사다리에는 유효한 문서가 필요하다
  if (goodDoc.length > problem.lengthCap) {
    goodDoc = goodDoc.slice(0, Math.floor(problem.lengthCap * 0.9));
  }
  const degradedDoc = goodDoc.slice(0, Math.floor(goodDoc.length * 0.4));
  const emptyDoc = "이 문서는 아직 작성되지 않았습니다.";

  onProgress?.("품질 사다리(좋음·훼손·빈 문서)를 채점하는 중…");
  const good = await scorer(goodDoc);
  const degraded = await scorer(degradedDoc);
  const empty = await scorer(emptyDoc);
  onProgress?.("같은 문서를 다시 채점해 안정성을 확인하는 중…");
  const goodRepeat = await scorer(goodDoc);

  // ① 순서 — 좋은 문서 > 훼손본 > 빈 문서
  const g = good.total;
  const d = degraded.total;
  const e = empty.total;
  const ordering =
    g > d && d > e
      ? check("ordering", "pass", "품질 사다리(좋음 > 훼손 > 빈 문서)의 순서가 유지됩니다.")
      : g >= d && d >= e && g > e
        ? check("ordering", "warn", "사다리 일부 구간에서 점수가 같습니다 — 순서 자체는 유지됩니다.")
        : check("ordering", "fail", "품질 사다리가 역전됩니다 — 이 기준은 좋은 문서를 구별하지 못합니다.");

  // ② 변별력 — 좋은 문서와 빈 문서의 간격
  const gap = g - e;
  const discrimination =
    gap >= 30
      ? check("discrimination", "pass", "좋은 문서와 빈 문서의 점수가 충분히 벌어집니다.")
      : gap >= 10
        ? check("discrimination", "warn", "좋은 문서와 빈 문서의 간격이 좁습니다 — 케이스 기록을 더 채우면 나아집니다.")
        : check("discrimination", "fail", "좋은 문서와 빈 문서를 거의 구별하지 못합니다.");

  // ③ 안정성 — 같은 문서 재채점의 흔들림
  const drift = Math.abs(g - goodRepeat.total);
  const stability =
    drift <= 5
      ? check("stability", "pass", "같은 문서를 다시 채점해도 판정이 흔들리지 않습니다.")
      : drift <= 15
        ? check("stability", "warn", "재채점에서 점수가 다소 흔들립니다 — 판정을 참고 지표로 함께 보세요.")
        : check("stability", "fail", "재채점마다 점수가 크게 흔들립니다 — 이 저지 모델은 신뢰하기 어렵습니다.");

  // ④ 꼼수 내성 — 큐레이션 프로브 4종 (장황함·통째 베끼기·날조·아첨)
  onProgress?.("알려진 꼼수 4종으로 기준을 찔러보는 중…");
  const probeNotes: string[] = [];
  const probeVerdicts: ExaminerVerdict[] = [];

  const verbosityDoc = buildVerbosityProbe(problem);
  const verbosity = await scorer(verbosityDoc); // 게이트가 잡으면 모델 호출 0회
  if (verbosity.gateRejected) {
    probeVerdicts.push("pass");
  } else {
    probeVerdicts.push("fail");
    probeNotes.push("부풀린 문서가 분량 게이트를 통과했습니다");
  }

  const verbatimDoc = buildVerbatimProbe(problem);
  if (verbatimDoc.length > problem.lengthCap) {
    const verbatim = await scorer(verbatimDoc);
    if (verbatim.gateRejected) {
      probeVerdicts.push("pass");
    } else {
      probeVerdicts.push("fail");
      probeNotes.push("기록 통째 베끼기가 분량 게이트를 통과했습니다");
    }
  } else {
    // 기록 전체가 상한 안 = 게이트가 전체 커버리지 길이 위(밴드 밖, 실측 교훈 ①) — 베끼기 방어 약화
    probeVerdicts.push("warn");
    probeNotes.push(
      "기록 전체가 분량 상한 안에 들어갑니다 — 상한을 낮추면 베끼기 방어(분량 게이트)가 살아납니다. 숨김 케이스 점수를 함께 확인하세요",
    );
  }

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
      ? "알려진 꼼수 4종(장황함·통째 베끼기·날조·아첨)이 모두 방어되었습니다."
      : probeNotes.join(" · ") + ".",
  );

  const checks = [ordering, discrimination, stability, hackResistance];
  const report: ExaminerReport = {
    checks,
    overall: worstVerdict(checks.map((c) => c.verdict)),
    forDigest: pack.definitionDigest,
    judge: { provider: llm.providerId, model: llm.model },
    ranAt: new Date().toISOString(),
  };
  return {
    report,
    artifacts: {
      goodDoc,
      degradedDoc,
      emptyDoc,
      verbosityDoc,
      verbatimDoc,
      scores: { good: g, degraded: d, empty: e },
    },
  };
}

/** 캘리브레이션 쌍 구성 — 배터리가 이미 만들고 채점한 산출물을 재사용한다(추가 모델 호출 0).
 *  꼼수 쌍 1개는 필수(SPEC §5.1), 품질 쌍은 시험관 점수가 실제로 갈린 것만 —
 *  점수가 같은 쌍은 시험관이 무차별하므로 캘리브레이션 표본이 될 수 없다.
 *  A/B 위치는 다이제스트에서 파생된 결정적 무작위(리플레이 가능, 위치 편향 방지). */
export function buildCalibrationPairs(
  run: ExaminerRun,
  pack: EvaluationPack,
): CalibrationPairSpec[] {
  const { artifacts } = run;
  const flip = (i: number): boolean =>
    parseInt(pack.definitionDigest[(8 + i) % pack.definitionDigest.length] ?? "0", 16) % 2 === 1;
  const mk = (
    i: number,
    id: string,
    kind: CalibrationPairSpec["kind"],
    better: string,
    worse: string,
    basis: string,
  ): CalibrationPairSpec => {
    const swapped = flip(i);
    return {
      id,
      kind,
      a: swapped ? worse : better,
      b: swapped ? better : worse,
      examinerChoice: swapped ? "B" : "A",
      basis,
    };
  };

  const pairs: CalibrationPairSpec[] = [
    mk(
      0,
      "hack-verbosity",
      "hack_probe",
      artifacts.goodDoc,
      artifacts.verbosityDoc,
      "한쪽은 내용 추가 없이 같은 말을 반복해 부풀린 문서입니다 — 동결 절차는 분량 게이트로 실격 처리했습니다.",
    ),
  ];
  const { scores } = artifacts;
  if (scores.good !== scores.degraded) {
    pairs.push(
      mk(
        1,
        "quality-degraded",
        "quality",
        scores.good > scores.degraded ? artifacts.goodDoc : artifacts.degradedDoc,
        scores.good > scores.degraded ? artifacts.degradedDoc : artifacts.goodDoc,
        "한쪽은 문서 뒷부분이 잘려 실제 질문 커버리지가 낮습니다 — 동결 절차는 케이스 실측 점수가 높은 쪽을 택했습니다.",
      ),
    );
  }
  if (scores.degraded !== scores.empty) {
    pairs.push(
      mk(
        2,
        "quality-empty",
        "quality",
        scores.degraded > scores.empty ? artifacts.degradedDoc : artifacts.emptyDoc,
        scores.degraded > scores.empty ? artifacts.emptyDoc : artifacts.degradedDoc,
        "한쪽은 사실상 빈 문서입니다 — 동결 절차는 케이스 실측 점수가 높은 쪽을 택했습니다.",
      ),
    );
  }
  return pairs;
}

// 사용자 판정의 확정(judgeCalibration)은 템플릿 무관 조립이라 @harnest/contracts에 있다.
