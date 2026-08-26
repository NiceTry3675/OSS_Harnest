import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CurveChart } from "./CurveChart";
import { ExperimentTree } from "./ExperimentTree";
import { IntroTour } from "./IntroTour";
import { ScoreHero } from "./ScoreHero";

describe("관제실 빈 상태와 단일 기준점", () => {
  it("빈 곡선만 안내 문구를 보이고 라운드 0 점수는 실제 점으로 그린다", () => {
    const empty = renderToStaticMarkup(<CurveChart curve={[]} />);
    expect(empty).toContain("실행을 시작하면 점수가 여기에 그려집니다");
    expect(empty).not.toContain("<svg");

    const ceiling = renderToStaticMarkup(<CurveChart curve={[100]} />);
    expect(ceiling).not.toContain("실행을 시작하면 점수가 여기에 그려집니다");
    expect(ceiling).toContain("<svg");
    expect(ceiling).toContain("시작 100점");
    expect(ceiling).toContain("<circle");
  });

  it("라운드 기록이 비어 있어도 실행 상태를 추측하지 않는다", () => {
    const html = renderToStaticMarkup(<ExperimentTree tree={[]} />);
    expect(html).toContain("기록된 라운드 판정이 없습니다.");
    expect(html).not.toContain("실행을 시작하면");
  });
});

describe("수치 예시와 산출물 중립 문구", () => {
  it("첫 방문 안내에 근거 없는 점수와 완료 시간을 표시하지 않는다", () => {
    const html = renderToStaticMarkup(<IntroTour open onClose={() => {}} />);
    expect(html).not.toContain("49.9");
    expect(html).not.toContain("92.5");
    expect(html).not.toContain("2분");
    // 문구는 다듬을 수 있지만, 개선에 쓰지 않는 질문이 있다는 사실은 안내 그림에 남아야 한다(SPEC §50).
    // 설명글은 지금 보고 있는 장만 DOM에 들어가므로, 그림 안의 문구로 확인한다.
    expect(html).toContain("개선에 쓰지 않은 질문으로 시작과 끝을 따로 잽니다");
  });

  it("점수 머리는 템플릿 종류와 무관한 산출물 문구를 쓴다", () => {
    const html = renderToStaticMarkup(
      <ScoreHero
        score={80}
        baseline={70}
        round={1}
        maxRounds={3}
        statusLabel="실행 중"
        running
      />,
    );
    expect(html).toContain("처음 만든 산출물은");
    expect(html).not.toContain("처음 만든 문서는");
  });
});
