/**
 * The one editable cell in the lab's grid (KPI-3, read-only).
 *
 * A reader types the target nobody has stated, or the mark for a line no data can
 * reach, and the score moves as they type. That is the lab's whole argument: the open
 * questions get answered by trying numbers against real figures, not by discussing them.
 *
 * ⚠ THE ARROW-KEY GUARD IS NOT OPTIONAL. This sits inside a ScrollableTable, which
 *   moves on ↑/↓. Without stopPropagation the table scrolls out from under the cell
 *   being typed into — the same trap Combobox and MultiSelect already carry a guard
 *   for. Nothing typed here is ever written to the database (see lib/manual.ts).
 */
import { useEffect, useState } from "react";

export default function NumberCell({
  value,
  onChange,
  suffix,
  placeholder,
  title,
  max,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  suffix?: string;
  placeholder?: string;
  title?: string;
  max?: number;
}) {
  // Kept as text while typing so "1." and "" are legal intermediate states; a controlled
  // number input would fight the reader on every keystroke.
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => {
    setText(value === null ? "" : String(value));
  }, [value]);

  const commit = (raw: string) => {
    const t = raw.trim();
    if (t === "") return onChange(null);
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0) return;
    onChange(max !== undefined ? Math.min(n, max) : n);
  };

  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <input
        type="number"
        inputMode="decimal"
        min={0}
        max={max}
        step="any"
        value={text}
        title={title}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          commit(e.target.value);
        }}
        onKeyDown={(e) => {
          // The table owns ↑/↓ otherwise, and would scroll instead of stepping the number.
          if (e.key === "ArrowUp" || e.key === "ArrowDown") e.stopPropagation();
        }}
        className="w-[72px] rounded border border-orange/50 bg-orange/[0.04] px-1.5 py-0.5 text-right text-[12px] tabular-nums text-navy outline-none focus:border-orange focus:ring-1 focus:ring-orange/30"
      />
      {suffix && <span className="text-[11px] text-grey-2">{suffix}</span>}
    </span>
  );
}
