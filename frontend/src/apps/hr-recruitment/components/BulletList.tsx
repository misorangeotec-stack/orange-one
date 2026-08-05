import { useRef } from "react";
import { TextInput } from "@/shared/components/ui/Form";
import { cn } from "@/shared/lib/cn";

/**
 * A list of short lines — the requisition's "What will this person do?".
 *
 * A textarea would have been fewer moving parts, but this is filled by a HOD a
 * few times a year, and a textarea silently asks them to remember a convention
 * ("one per line") that nothing on screen states. Numbered rows show the shape of
 * the answer before a word is typed, and the count in the hint tells them when
 * they've done enough.
 *
 * Enter on the last row adds the next one, so a whole list can be typed without
 * ever reaching for the mouse. Enter mid-list moves focus down instead of
 * inserting, because re-ordering half-written bullets is not what anyone means by
 * pressing Enter in the middle of a form.
 *
 * Storage is newline-joined text (`fms_hr_requisitions.key_responsibilities`),
 * which is also how a job title's `default_responsibilities` template arrives —
 * so a pre-filled list and a hand-typed one are the same thing on the way out.
 */
export default function BulletList({
  values,
  onChange,
  placeholder,
  disabled,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  // Always render at least one row: an empty list with no input is a dead end.
  const rows = values.length > 0 ? values : [""];

  const commit = (next: string[]) => {
    // Never store a trailing blank — it would come back as an empty bullet.
    while (next.length > 1 && next[next.length - 1].trim() === "") next.pop();
    onChange(next);
  };

  const setAt = (i: number, v: string) => {
    const next = [...rows];
    next[i] = v;
    onChange(next);
  };

  const removeAt = (i: number) => {
    const next = rows.filter((_, j) => j !== i);
    commit(next.length ? next : [""]);
    requestAnimationFrame(() => refs.current[Math.max(0, i - 1)]?.focus());
  };

  const addAfter = (i: number) => {
    const next = [...rows];
    next.splice(i + 1, 0, "");
    onChange(next);
    requestAnimationFrame(() => refs.current[i + 1]?.focus());
  };

  return (
    <div className="space-y-2">
      {rows.map((v, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="shrink-0 w-5 text-right text-[12px] tabular-nums text-grey-2">{i + 1}.</span>
          <TextInput
            ref={(el) => {
              refs.current[i] = el;
            }}
            value={v}
            disabled={disabled}
            placeholder={i === 0 ? placeholder : ""}
            onChange={(e) => setAt(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault(); // never submit the form from inside the list
              if (i === rows.length - 1) addAfter(i);
              else refs.current[i + 1]?.focus();
            }}
          />
          <button
            type="button"
            onClick={() => removeAt(i)}
            disabled={disabled || (rows.length === 1 && !v)}
            aria-label={`Remove point ${i + 1}`}
            className={cn(
              "shrink-0 flex items-center justify-center w-7 h-7 rounded-lg text-grey-2 transition",
              "hover:bg-line hover:text-navy disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
            )}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => addAfter(rows.length - 1)}
        disabled={disabled}
        className="ml-7 text-[12.5px] font-semibold text-orange hover:underline disabled:text-grey-2 disabled:no-underline"
      >
        + Add another
      </button>
    </div>
  );
}

/** Newline-joined text → rows, dropping blanks. The storage format both ways. */
export const bulletsFromText = (text: string | null): string[] =>
  (text ?? "")
    .split("\n")
    .map((l) => l.replace(/^[-•*\s]+/, "").trim())
    .filter(Boolean);

/** Rows → newline-joined text, or null when nothing was written. */
export const bulletsToText = (rows: string[]): string | null => {
  const clean = rows.map((r) => r.trim()).filter(Boolean);
  return clean.length ? clean.join("\n") : null;
};
