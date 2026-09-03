/** 케이스 목록의 용도 배지 — 세 용도(개선용·중간 점검용·최종 확인용) 모두 질문마다 표시된다. */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WizardCaseList, type CasePair } from "./WizardCaseList";

const pairs: CasePair[] = [
  { question: "월 마감은 며칠까지?", expectedAnswer: "5영업일" },
  { question: "전표는 누가 올리나?", expectedAnswer: "담당자" },
  { question: "세금계산서 수집 기한은?", expectedAnswer: "1~2일" },
];

describe("WizardCaseList 용도 배지", () => {
  it("세 용도 모두 질문마다 배지를 붙이고 힌트에 개수를 함께 적는다 — 개선용도 무표시가 아니다", () => {
    const html = renderToStaticMarkup(
      <WizardCaseList
        pairs={pairs}
        minPairs={3}
        maxPairs={30}
        uses={["visible", "guard", "holdout"]}
        split={{ holdout: 1, guard: 1 }}
        onChange={() => {}}
      />,
    );
    expect(html).toContain(">개선용</span>");
    expect(html).toContain(">중간 점검용</span>");
    expect(html).toContain("숨김 · 최종 확인용");
    expect(html).toContain("개선용 1개");
    expect(html).toContain("중간 점검용 1개");
    expect(html).toContain("최종 확인용 1개");
  });

  it("용도가 아직 계산되지 않았으면(uses 없음) 배지를 붙이지 않고 정하는 중이라고만 알린다", () => {
    const html = renderToStaticMarkup(
      <WizardCaseList pairs={pairs} minPairs={3} maxPairs={30} onChange={() => {}} />,
    );
    expect(html).not.toContain(">개선용</span>");
    expect(html).not.toContain(">중간 점검용</span>");
    expect(html).not.toContain("최종 확인용</span>");
    expect(html).toContain("용도(개선용·중간 점검용·최종 확인용)를 정하는 중");
  });

  it("제출되지 않는 쌍(null 용도)에는 배지가 없고 개선용 개수에도 들어가지 않는다", () => {
    const html = renderToStaticMarkup(
      <WizardCaseList
        pairs={[...pairs, { question: "미확인 초안", expectedAnswer: "답", needsConfirm: true }]}
        minPairs={3}
        maxPairs={30}
        uses={["visible", "visible", "holdout", null]}
        split={{ holdout: 1, guard: 0 }}
        onChange={() => {}}
      />,
    );
    expect(html.match(/>개선용<\/span>/g)?.length).toBe(2);
    expect(html).toContain("개선용 2개");
    expect(html).toContain("중간 점검용 0개");
  });
});
