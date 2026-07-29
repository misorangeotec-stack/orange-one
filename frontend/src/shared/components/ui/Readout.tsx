import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

/**
 * Read-only display type — the counterpart to `Form.tsx`.
 *
 * `Form.tsx` is for values you type INTO; this is for values you READ. They must
 * not share a label style: `FieldLabel` renders its label in `text-navy`, the very
 * same colour as a value, which is exactly the confusion this module exists to end.
 *
 * A label and its value differ on FOUR signals at once — size, colour, case and
 * letter-spacing — so neither can be mistaken for the other at a glance. A section
 * heading in turn outranks a field label on colour and a hairline rule. Before this
 * existed, every screen hand-rolled the pair and the app drifted into six different
 * label sizes; in the candidate drawer the section headings ended up byte-identical
 * to the field labels, leaving nothing for the eye to latch onto.
 *
 * `grey` (#64748B), not `grey-2` (#8A99B0): grey-2 on white is ~2.9:1, which fails
 * the WCAG AA floor of 4.5:1. The old labels were not merely subtle, they were
 * unreadable.
 */
export const FIELD_LABEL_CLASS = "text-[11px] font-semibold uppercase tracking-wide text-grey";
export const FIELD_VALUE_CLASS = "text-[14px] font-semibold text-navy";
export const SECTION_HEADING_CLASS = "text-[12px] font-semibold uppercase tracking-wide text-navy";

/**
 * How loudly a VALUE is set.
 *
 * `strong` — the DEFAULT and the original: a value the reader came to look up, on
 *            a detail page where it IS the content.
 * `quiet`  — a dense recap where a dozen values are read at once. Semibold on
 *            every one of them emphasises none of them, and sitting above a
 *            form's own inputs a bold recap reads as though the recap were the
 *            thing to fill in.
 *
 * A PROP, not a `className`: `cn` (shared/lib/cn.ts) is a plain joiner, NOT
 * tailwind-merge, so `className="font-normal"` would leave BOTH weight classes on
 * the element and Tailwind emits `font-semibold` later in its own scale — the
 * override would silently do nothing. A prop SWAPS the class instead of appending
 * it, and keeps "quiet" an enumerated member of this module rather than a seventh
 * hand-rolled label style out in some app.
 */
export type FieldEmphasis = "strong" | "quiet";
export const FIELD_VALUE_QUIET_CLASS = "text-[14px] font-normal text-navy";

/** A missing value reads the same everywhere — and never reads as data. */
const EMPTY = <span className="font-normal text-grey-2">—</span>;

export function Field({
  label,
  value,
  children,
  className,
  emphasis = "strong",
}: {
  label: string;
  /** Plain content. null / undefined / "" / "—" all render the muted placeholder. */
  value?: ReactNode;
  /** Rich content (links, chips, lists). Wins over `value` when both are given. */
  children?: ReactNode;
  className?: string;
  /** Defaults to the original look, so every existing call site is untouched. */
  emphasis?: FieldEmphasis;
}) {
  const body = children ?? value;
  // Callers already in the tree hand us a literal "—" for absent people/dates; treat
  // that as blank too, so an em-dash never arrives dressed up as a real value.
  const blank = body === null || body === undefined || body === "" || body === "—";
  return (
    <div className={cn("min-w-0", className)}>
      <div className={FIELD_LABEL_CLASS}>{label}</div>
      {/* EMPTY carries its own font-normal on a CHILD span, so the placeholder
          renders identically under either emphasis. */}
      <div className={cn("mt-1", emphasis === "quiet" ? FIELD_VALUE_QUIET_CLASS : FIELD_VALUE_CLASS)}>
        {blank ? EMPTY : body}
      </div>
    </div>
  );
}

/**
 * A label and value on ONE line — the spec-sheet row, for a dense recap.
 *
 * `Field` stacks the label ABOVE the value, which is right when a value is the
 * content of the page. In a recap of a dozen facts it costs two lines per fact
 * and shouts twelve uppercase labels at once; ten of them read as clutter, and
 * any fact whose value is short leaves most of its row empty.
 *
 * So this is a different PRIMITIVE, not a restyle of `Field`: the label sits in a
 * fixed-width gutter, quiet and sentence-case, and the value sits beside it. Ten
 * facts become ten lines instead of twenty, and the eye gets one scan column of
 * labels instead of a ragged staircase.
 *
 * Use `Field` when a value is what the reader came for; use `FieldRow` when they
 * are skimming many at once.
 */
// `leading-5` on BOTH halves is what keeps a wrapped value (a long product name,
// an address) from closing up into a solid block, and keeps the label sitting on
// the same baseline as the value's first line.
export const FIELD_ROW_LABEL_CLASS = "text-[12.5px] leading-5 text-grey";
export const FIELD_ROW_VALUE_CLASS = "text-[13.5px] leading-5 text-navy";

export function FieldRow({
  label,
  value,
  children,
  className,
}: {
  label: string;
  value?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const body = children ?? value;
  const blank = body === null || body === undefined || body === "" || body === "—";
  return (
    <div className={cn("flex items-baseline gap-3 min-w-0", className)}>
      {/* Fixed gutter so every label in a column starts at the same x — that
          single alignment is most of what makes a long list feel calm. */}
      <span className={cn("w-[124px] shrink-0", FIELD_ROW_LABEL_CLASS)}>{label}</span>
      <span className={cn("min-w-0 flex-1", FIELD_ROW_VALUE_CLASS)}>{blank ? EMPTY : body}</span>
    </div>
  );
}

export function SectionHeading({
  children,
  right,
  className,
}: {
  children: ReactNode;
  /** Optional trailing content on the same baseline — a count, a due chip, an action. */
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // `first:mt-0` so a heading that opens a panel doesn't push a gap above itself.
        "mt-6 flex items-baseline justify-between gap-3 border-b border-line pb-2 first:mt-0",
        className,
      )}
    >
      <h3 className={SECTION_HEADING_CLASS}>{children}</h3>
      {right}
    </div>
  );
}
