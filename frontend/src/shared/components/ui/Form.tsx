import { forwardRef, useState } from "react";
import type { ReactNode, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/shared/lib/cn";

const fieldBase =
  "w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[14px] text-ink placeholder:text-grey-2 " +
  "outline-none transition focus:border-orange focus:ring-4 focus:ring-orange/10 disabled:bg-page disabled:text-grey-2";

/**
 * `anchor` is an optional DOM id, so something elsewhere on the page can scroll
 * to this field and focus it — OCPI's "what is still missing" panel does exactly
 * that, from `FIELD_ANCHOR` in apps/ocpi/lib/completeness.ts.
 *
 * ⚠ `scroll-mt-24` GOES WITH IT AND IS NOT COSMETIC. The portal's `Topbar` is
 *   `sticky top-0` and 68px tall, so a plain `scrollIntoView` parks the label
 *   underneath it. 96px clears the bar with a little air above.
 */
export function FieldLabel({ label, required, hint, anchor, strong, children }: { label: string; required?: boolean; hint?: ReactNode; anchor?: string; strong?: boolean; children: ReactNode }) {
  return (
    <label id={anchor} className={anchor ? "block scroll-mt-24" : "block"}>
      {/* Baseline-aligned with the label pinned: a hint long enough to wrap used to
          vertically re-centre the label and collide with it.

          ⚠ AND IT WRAPS, because pinning the label alone was not enough. `shrink-0`
            stops the LABEL being squeezed, which pushed the squeeze onto the hint
            instead: beside a long label like "Did the customer provide any of this?"
            the hint was crushed to a two-character column, spilled one word per line
            down the page and landed on top of the next field. `basis-40` says the hint
            would like 10rem, and `flex-wrap` drops it onto its own full-width line when
            it cannot have that. A row that fits today is unchanged — the hint simply
            grows into the space it already had. */}
      <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 mb-1.5">
        {/* `strong` is opt-in and defaults OFF, so the ~200 existing call sites
            across every app are untouched. Complaint uses it because its form is
            read as a list of questions rather than a dense entry grid. */}
        <span className={cn("text-[13px] text-navy shrink-0", strong ? "font-bold" : "font-medium")}>
          {label}
          {required && <span className="text-orange"> *</span>}
        </span>
        {hint && (
          <span className="text-[11px] text-grey-2 text-right leading-snug min-w-0 grow basis-40">{hint}</span>
        )}
      </span>
      {children}
    </label>
  );
}

/**
 * The same heading as `FieldLabel`, as a plain `div` — for a field whose control is a
 * GROUP of buttons rather than one input.
 *
 * ⚠ THIS EXISTS BECAUSE `FieldLabel` IS A `<label>`. A label forwards any click on its
 *   text to its first labelable descendant, and `<button>` is labelable — so wrapping
 *   `ChoiceButtons` in a FieldLabel means clicking the question silently presses the
 *   FIRST option. On the General Purchase intake form that answered "Location" as
 *   "Plant" for anyone who clicked the word, with nothing on screen to say so
 *   (verified on the production build, 28-09-2026). It also gives the button the whole
 *   label text as its accessible name, which breaks `getByRole('radio', { name })`.
 *
 * Use `FieldLabel` around ONE input, textarea or select. Use this above anything else.
 */
export function FieldHeading({ label, required, hint }: { label: string; required?: boolean; hint?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 mb-1.5">
      <span className="text-[13px] font-medium text-navy shrink-0">
        {label}
        {required && <span className="text-orange"> *</span>}
      </span>
      {hint && <span className="text-[11px] text-grey-2 text-right leading-snug min-w-0 grow basis-40">{hint}</span>}
    </div>
  );
}

/** forwardRef so a parent can drive focus — LineGrid moves the caret cell to cell. */
export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className, ...props }, ref) {
    return <input ref={ref} className={cn(fieldBase, className)} {...props} />;
  }
);

/** Password field with a show/hide toggle. Pass the same props as TextInput (minus `type`). */
export function PasswordInput({ className, type: _type, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input type={show ? "text" : "password"} className={cn(fieldBase, "pr-10", className)} {...props} />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        title={show ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex items-center pr-3 text-grey-2 hover:text-orange transition"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TextArea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(fieldBase, "resize-none", className)} {...props} />;
  }
);

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(fieldBase, "cursor-pointer appearance-none bg-no-repeat", className)} {...props}>
      {children}
    </select>
  );
}
