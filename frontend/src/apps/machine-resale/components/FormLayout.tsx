import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

/**
 * Copied from Service Engineering (`apps/service-engineering/components/FormLayout.tsx`) so the
 * Machine Resale forms line up the same way as the house forms. One addition: `aside`, a control
 * on the label line drawn OUTSIDE the <label> (the per-field website switch), so a click on the
 * field's name never presses it.
 *
 * The layout:
 *
 * - FormSection: a titled group of fields on a grid (3 columns on the page, 1 in a popup).
 * - FormField: every field is the same three bands, each of FIXED height:
 *     1. the label, with any remark right-aligned on the same line and cut to one line
 *     2. the control
 *     3. one line under it for the error or a short note, kept even when empty
 *   Fixed bands are what keep a row level: a field with a remark or an error is exactly as
 *   tall as one without, so the controls across a row always sit on one line.
 * - FormActions: the buttons, right-aligned under a rule, on every form and popup. Pass the
 *   PRIMARY button first: it is first in Tab order (so moving on from the last field lands on
 *   Save, never on Cancel) and is still drawn on the right.
 *
 * Keep remarks short: one line, cut with the full text on hover.
 */

export function FormSection({ title, cols = 3, children }: { title?: string; cols?: 1 | 2 | 3; children: ReactNode }) {
  return (
    <section className="space-y-3">
      {title && (
        <h3 className="border-b border-line pb-2 text-[12px] font-semibold uppercase tracking-wide text-grey">{title}</h3>
      )}
      <div
        className={cn(
          "grid gap-x-6 gap-y-2",
          cols === 3 ? "md:grid-cols-3" : cols === 2 ? "md:grid-cols-2" : "grid-cols-1",
        )}
      >
        {children}
      </div>
    </section>
  );
}

export function FormField({
  label,
  required,
  hint,
  note,
  error,
  span = 1,
  group,
  name,
  aside,
  children,
}: {
  label: string;
  required?: boolean;
  /** Remark beside the label, one line. */
  hint?: string;
  /** Short note under the control, one line; an error replaces it. */
  note?: string;
  error?: string | null;
  /** Columns this field spans in a 3-column section. */
  span?: 1 | 2 | 3;
  /**
   * The control is a GROUP of buttons (choice buttons): render a <div>, never a <label>, or a
   * click on the label presses the first button.
   */
  group?: boolean;
  /** Field key, so a failed save can move focus to the first field in error. */
  name?: string;
  /** A control on the label line, outside the <label>. Takes the place of `hint` there. */
  aside?: ReactNode;
  children: ReactNode;
}) {
  const Wrap = group ? "div" : "label";
  const bottom = error || note || "";
  const spanCls = cn("block min-w-0", span === 2 && "md:col-span-2", span === 3 && "md:col-span-3");
  const field = (
    <Wrap data-field={name} className={aside ? "block min-w-0" : spanCls}>
      <span className="mb-1.5 flex h-5 items-baseline justify-between gap-3">
        <span className="shrink-0 text-[13px] font-medium text-navy">
          {label}
          {required && <span className="text-orange"> *</span>}
        </span>
        {hint && !aside && (
          <span className="min-w-0 truncate text-right text-[11px] text-grey-2" title={hint}>
            {hint}
          </span>
        )}
      </span>
      {children}
      <span
        className={cn("mt-1 block h-4 truncate text-[11.5px] leading-4", error ? "font-medium text-red-600" : "text-grey")}
        title={bottom || undefined}
      >
        {bottom}
      </span>
    </Wrap>
  );
  if (!aside) return field;
  return (
    <div className={cn("relative", spanCls)} data-vis-wrap="">
      <div className="absolute right-0 top-0 z-[1] flex h-5 items-center">{aside}</div>
      {field}
    </div>
  );
}

/** Choice buttons are shorter than an input; this holds them to an input's height so a row stays level. */
export function ControlRow({ children }: { children: ReactNode }) {
  return <div className="flex min-h-[42px] items-center">{children}</div>;
}

export function FormActions({ left, children }: { left?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
      <div className="min-w-0 text-[12.5px]">{left}</div>
      <div className="flex flex-row-reverse gap-2">{children}</div>
    </div>
  );
}
