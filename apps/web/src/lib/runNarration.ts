/** 관제실 활동 콘솔 서술 — 런타임 호출 앞뒤와 체크포인트 통지에 사람이 읽는 설명을 붙인다.
 *  표시 전용이다: 점수·채택 판단에는 관여하지 않고, 승인된 팩의 기준 이름·가중치만 읽는다.
 *  템플릿별 분기는 없다 — adjustments 키를 번역하지 않고 "조정"으로만 표기한다(사유 문장은
 *  템플릿이 violations 끝에 넣어 준다). */

import type { EvaluationPack, LoopCheckpoint, RoundRecord, ScoreResult } from "@harnest/contracts";
import type { TemplateRuntime } from "../templates";
import { appendStream, setStreamStatus } from "./activityLog";

/** 합계 산식 — "합계 52.3점 = 80.0×0.80 + 0.0×0.20 − 10.0(조정)". 기준이 하나뿐이고 조정도
 *  없으면 등식을 붙이지 않는다. 조정이 있으면 기준이 하나여도 붙인다 — 부분 점수와 합계가
 *  다른데 산식이 없으면 숫자를 믿을 수 없다. */
export function scoreEquation(r: ScoreResult, pack: EvaluationPack): string {
  const terms = Object.entries(r.parts).map(([id, value]) => {
    const weight = pack.criteria.find((c) => c.id === id)?.weight ?? 0;
    return value.toFixed(1) + "×" + weight.toFixed(2);
  });
  const adjustments = Object.entries(r.adjustments ?? {}).filter(
    ([, value]) => Number.isFinite(value) && value !== 0,
  );
  const total = "합계 " + r.total.toFixed(1) + "점";
  if (terms.length <= 1 && adjustments.length === 0) return total;
  let equation = terms.join(" + ");
  for (const [, value] of adjustments) {
    // 양수 조정(가점)도 허용한다 — 부호는 값이 정한다
    equation += (value < 0 ? " − " : " + ") + Math.abs(value).toFixed(1) + "(조정)";
  }
  return total + " = " + equation;
}

/** 채점 결과 한 건을 콘솔 줄로 — 어떤 기준에 비추어 몇 점이고 합계가 어떻게 나왔는지 */
export function scoreLines(r: ScoreResult, pack: EvaluationPack): string[] {
  const scored = Object.entries(r.parts).map(([id, value]) => {
    const def = pack.criteria.find((c) => c.id === id);
    const label = def?.label ?? id;
    const weight = def?.weight ?? 0;
    return (
      "기준「" + label + "」" +
      (def ? " 가중치 " + Math.round(weight * 100) + "%" : "") +
      " → " + value.toFixed(1) + "점"
    );
  });
  const gateNames = pack.gates.map((g) => "「" + g.label + "」").join(" ");
  return [
    ...scored,
    ...(pack.gates.length > 0
      ? ["필수 조건" + gateNames + " " + (r.gateRejected ? "위반 — 점수와 무관하게 탈락합니다" : "통과")]
      : []),
    scoreEquation(r, pack),
    ...(r.violations.length > 0
      ? ["", "이 기준을 아직 채우지 못한 질문", ...r.violations.map((v) => "  · " + v)]
      : ["", "기준에 비추어 지적할 것이 없습니다."]),
  ];
}

/** 채택 결정 한 건의 사유 — 점수만으로는 이유를 알 수 없다.
 *  채택 조건은 셋을 모두 넘어야 한다: 필수 조건 · 중간 점검 비퇴보 · 엄격한 점수 개선. */
export function describeAdoption(last: RoundRecord): { why: string; detail: string } {
  const why = last.adopted
    ? "개선안 채택"
    : last.gateRejected
      ? "필수 조건 위반"
      : !last.guardSafe
        ? "중간 점검 점수 기준 미달"
        : "점수 개선 없음";
  const gap = last.candidateScore - last.championScore;
  const guard =
    last.candidateGuardScore === null
      ? ""
      : ` 중간 점검 점수는 ${last.candidateGuardScore.toFixed(1)}점으로 ${
          last.guardSafe ? "허용 범위 안입니다" : "허용 범위보다 낮습니다"
        }.`;
  const detail = last.gateRejected
    ? "새 개선안이 필수 조건을 지키지 않아 점수를 비교하지 않고 제외했습니다."
    : !last.guardSafe
      ? `새 개선안의 중간 점검 점수${
          last.candidateGuardScore === null ? "가" : ` ${last.candidateGuardScore.toFixed(1)}점이`
        } 허용 범위보다 낮아 현재 결과물을 유지했습니다.`
      : last.adopted
        ? `새 개선안의 종합 점수 ${last.candidateScore.toFixed(1)}점이 현재 결과물보다 ${gap.toFixed(1)}점 높아 채택했습니다.${guard}`
        : `새 개선안의 종합 점수 ${last.candidateScore.toFixed(1)}점이 현재 결과물의 ${last.championScore.toFixed(1)}점보다 높지 않아 현재 결과물을 유지했습니다. 동점도 바꾸지 않습니다.${guard}`;
  return { why, detail };
}

/** 루프가 무엇을 보고 어떻게 고쳐 쓰는지를 화면으로 흘린다. 생성기는 "지금 산출물이 못 채운 것"을
 *  받아 그것만 보강한다 — 그게 이 루프의 추론이다. 런타임 자체는 그대로 호출만 한다. */
export function narrateRuntime(base: TemplateRuntime, pack: EvaluationPack): TemplateRuntime {
  return {
    ...base,
    ...(base.planStrategy === undefined
      ? {}
      : {
          planStrategy: async (champion, rng, feedback) => {
            const strategy = await base.planStrategy!(champion, rng, feedback);
            // 케이스를 다 맞히면 남는 여지는 짧게 쓰는 쪽뿐이다 — 그 사정을 먼저 밝힌다
            const why =
              feedback.championViolations.length === 0
                ? "공개 질문은 모두 답할 수 있습니다. 내용을 더해도 점수가 오르지 않으니, 짧게 만드는 쪽만 남았습니다."
                : `아직 못 채운 질문이 ${feedback.championViolations.length}개 있습니다.`;
            appendStream(
              why + "\n\n" + strategy.summary,
              `${feedback.round}회차 — 이번엔 ${strategy.label ?? strategy.key}`,
            );
            return strategy;
          },
        }),
    generate: async (champion, rng, feedback, strategy) => {
      const misses = feedback.championViolations;
      const body =
        misses.length > 0
          ? "지금 산출물이 못 채운 것" + "\n" +
            misses.map((v) => "  · " + v).join("\n") + "\n" + "\n" +
            "이 항목들을 보강해 다시 씁니다. 나머지는 건드리지 않습니다."
          : "못 채운 질문이 없습니다. 답에 필요한 사실은 그대로 두고, 군더더기를 덜어 더 짧게 씁니다.";
      appendStream(
        body,
        feedback.round + "회차 — 무엇을 고칠지 정합니다 (현재 " +
          feedback.championScore.toFixed(1) + "점)",
      );
      return base.generate(champion, rng, feedback, strategy);
    },
    scorer: async (artifact) => {
      const r = await base.scorer(artifact);
      appendStream(scoreLines(r, pack).join("\n"), "채점 결과");
      return r;
    },
  };
}

/** 체크포인트 통지마다 마지막 회차의 채택 결정을 한 번만 서술한다 — 체크포인트는 같은 회차에
 *  여러 번 올 수 있다(일시정지·재개·완료 전이). */
export function createCheckpointNarrator(): (cp: LoopCheckpoint<unknown>) => void {
  let lastLoggedRound = -1;
  return (cp) => {
    const last = cp.tree[cp.tree.length - 1];
    if (last === undefined || last.round === lastLoggedRound) return;
    lastLoggedRound = last.round;
    const { why, detail } = describeAdoption(last);
    appendStream(detail, `${last.round}회차 채택 결정 — ${why}`);
    setStreamStatus(`${last.round}회차 — ${why}`);
  };
}
