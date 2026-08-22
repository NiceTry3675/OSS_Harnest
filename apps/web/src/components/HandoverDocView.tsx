/** 인수인계 문서 뷰 — 산출물 원문 표시 */
export function HandoverDocView({ doc }: { doc: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 8 }}>
        {doc.length.toLocaleString()}자
      </div>
      <pre
        style={{
          whiteSpace: "pre-wrap",
          fontFamily: "inherit",
          fontSize: 14,
          lineHeight: 1.7,
          margin: 0,
        }}
      >
        {doc}
      </pre>
    </div>
  );
}
