/** 모델 고르기 — 목록이 수십 개까지 늘어나므로 찾아서 고른다.
 *
 *  브라우저 기본 드롭다운은 검색이 안 되고 폭·글꼴이 화면과 따로 논다.
 *  여기서는 입력칸에 치면서 걸러 고르고, 목록에 없는 이름도 그대로 쓸 수 있다. */

import { useEffect, useRef, useState } from "react";
import type { AvailableModel } from "../lib/llm";
import { preferredModels } from "../lib/modelChoice";

export function ModelPicker({
  id,
  invalid = false,
  describedBy,
  models,
  value,
  placeholder,
  busy,
  disabled,
  onChange,
}: {
  /** 입력칸의 id — 바깥 label의 htmlFor와 검증 실패 시 포커스 이동(failValidation)이 이 값을 찾는다 */
  id?: string;
  /** 검증에 걸린 상태 — aria-invalid로 보조기기에 알린다 */
  invalid?: boolean;
  /** 오류 문구 요소의 id — aria-describedby로 연결한다 */
  describedBy?: string;
  models: AvailableModel[];
  value: string;
  placeholder: string;
  busy: boolean;
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // 바깥을 누르면 닫는다
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const needle = query.trim().toLowerCase();
  // 찾을 때는 전체에서 찾는다 — 추린 목록 밖에 있어도 이름을 알면 바로 고를 수 있어야 한다
  const pool = needle || showAll ? models : preferredModels(models);
  const shown = needle
    ? pool.filter(
        (m) => m.label.toLowerCase().includes(needle) || m.id.toLowerCase().includes(needle),
      )
    : pool;
  const hiddenCount = models.length - preferredModels(models).length;

  const picked = models.find((m) => m.id === value);

  return (
    <div className="picker" ref={boxRef}>
      <input
        id={id}
        className="picker-input"
        value={open ? query : (picked?.label ?? value)}
        placeholder={busy ? "모델을 찾는 중…" : placeholder}
        disabled={disabled}
        aria-label="채점에 쓸 모델"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onFocus={() => {
          setQuery("");
          setOpen(true);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          // 목록에 없는 이름도 직접 쓸 수 있어야 한다
          onChange(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter" && shown.length > 0) {
            e.preventDefault();
            onChange(shown[0].id);
            setOpen(false);
          }
        }}
      />
      {busy ? <span className="picker-spin" aria-hidden="true" /> : null}

      {open && models.length > 0 ? (
        <div className="picker-list" role="listbox">
          {shown.length === 0 ? (
            <div className="picker-empty">
              찾는 모델이 없습니다 — 적은 이름을 그대로 씁니다.
            </div>
          ) : (
            shown.map((m) => (
              <button
                key={m.id}
                type="button"
                role="option"
                aria-selected={m.id === value}
                className={`picker-row${m.id === value ? " is-on" : ""}`}
                onClick={() => {
                  onChange(m.id);
                  setOpen(false);
                }}
              >
                <span className="picker-name">{m.label}</span>
                <span className="picker-id">{m.id}</span>
              </button>
            ))
          )}
          {!needle && !showAll && hiddenCount > 0 ? (
            <button type="button" className="picker-more" onClick={() => setShowAll(true)}>
              자주 쓰지 않는 {hiddenCount}개 더 보기
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
