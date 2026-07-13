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

/** A missing value reads the same everywhere — and never reads as data. */
const EMPTY = <span className="font-normal text-grey-2">—</span>;

export function Field({
  label,
  value,
  children,
  className,
}: {
  label: string;
  /** Plain content. null / undefined / "" / "—" all render the muted placeholder. */
  value?: ReactNode;
  /** Rich content (links, chips, lists). Wins over `value` when both are given. */
  children?: ReactNode;
  className?: string;
}) {
  const body = children ?? value;
  // Callers already in the tree hand us a literal "—" for absent people/dates; treat
  // that as blank too, so an em-dash never arrives dressed up as a real value.
  const blank = body === null || body === undefined || body === "" || body === "—";
  return (
    <div className={cn("min-w-0", className)}>
      <div className={FIELD_LABEL_CLASS}>{label}</div>
      <div className={cn("mt-1", FIELD_VALUE_CLASS)}>{blank ? EMPTY : body}</div>
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
