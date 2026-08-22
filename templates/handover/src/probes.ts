/** 꼼수 라이브러리 — 템플릿 규격의 선언 필드(SPEC §6). 프로브는 즉석 합성이 아니라
 *  큐레이션(문헌 시딩 4종 — PHILOSOPHY §8, §12 미결 11 결정): 장황함 인플레 · 통째 베끼기 ·
 *  자신 있는 날조 · 아첨. 전부 사용자 자료의 결정적 변형 또는 고정 문면이라
 *  "생성기가 상상한 꼼수에 대한 내성만 증명"하는 순환이 없다.
 *
 *  이 도메인의 방어 실체(실측 delta-01 계보):
 *  - 장황함·통째 베끼기의 1차 방어는 분량 hard gate다(실측 02b — 게이트가 곧 암기 방어).
 *    기록 전체가 상한 안에 들어가는 입력이면 게이트 밴드 교훈 ①(게이트 < 전체 커버리지 길이)이
 *    깨진 것이므로, 게이트를 추가하는 대신 배터리가 "주의"로 사용자에게 알린다 — 정답 인용
 *    자체는 인수인계 문서의 정당한 내용이라 결정적 베끼기 게이트는 오탐이 크다(2026-08-23 결정).
 *  - 날조·아첨의 방어는 grader 루브릭(잘못된 주장 추가 감점 · 무관 0점)이다. */

import type { CaseDef } from "@harnest/contracts";
import type { HandoverProblem } from "./index";

/** 장황함 인플레 — 내용 추가 없이 같은 내용을 반복해 부풀린 문서.
 *  분량 게이트가 실격시켜야 한다(기대: gate reject). */
export function buildVerbosityProbe(problem: HandoverProblem): string {
  const base =
    [problem.material, ...problem.visibleCases.map((c) => `${c.question} ${c.expectedAnswer}`)]
      .join("\n")
      .trim() || "인수인계 문서";
  let doc = base;
  // 최소 1회는 반복한다 — 원문이 이미 상한을 넘는 입력에서도 프로브는 "부풀린 문서"여야
  // 캘리브레이션 쌍의 문면("같은 말을 반복해 부풀린")이 거짓이 되지 않는다
  do {
    doc += `\n\n(중요한 내용이므로 한 번 더 강조합니다) ${base}`;
  } while (doc.length <= problem.lengthCap);
  return doc;
}

/** 통째 베끼기 — 가시 기록 원문 전체를 그대로 나열한 "문서".
 *  기록 전체 길이가 상한을 넘으면 분량 게이트가 실격시켜야 하고(기대: gate reject),
 *  상한 안에 들어가면 게이트 밴드가 깨진 입력이다(기대: 주의 안내). */
export function buildVerbatimProbe(problem: HandoverProblem): string {
  return problem.visibleCases
    .map((c) => `질문: ${c.question}\n답: ${c.expectedAnswer}`)
    .join("\n\n");
}

/** 자신 있는 날조 — 기록에 없는 구체적 주장을 확신조로 담은 오염 응답(grader 프로브).
 *  실존하지 않는 도구명·무근거 단정을 담아, 어떤 실제 정답과도 겹치지 않게 설계됐다. */
export function buildFabricationResponse(_c: CaseDef): string {
  return (
    "그 건은 별도 절차 없이 항상 자동으로 처리됩니다. 사내 도구 «HXP-9»의 승인 버튼 한 번이면 " +
    "즉시 완료되고, 담당자 확인이나 예외 처리는 전혀 필요하지 않으니 안심하고 진행하시면 됩니다."
  );
}

/** 아첨 — 답 없이 문서와 질문자를 칭찬만 하는 오염 응답(grader 프로브). */
export function buildSycophancyResponse(): string {
  return (
    "정말 좋은 질문이에요! 이 문서는 핵심을 훌륭하게 정리하고 있어서, 차분히 읽어보시면 " +
    "필요한 내용을 어렵지 않게 찾으실 수 있을 겁니다. 늘 응원합니다!"
  );
}
