import { useRef } from "react";
import { cn } from "@/shared/lib/cn";
import { advanceFocus } from "@/shared/lib/advanceFocus";

/**
 * The portal's "pick one of two or three" FORM control — the answers sit on the
 * page instead of behind a dropdown click.
 *
 * Generalised from OCPI's local `YesNo`, which already had the right look: h-9
 * buttons that line up with `TextInput` in a form grid.
 *
 * ⚠ THIS IS NOT `PillToggle`, AND THE TWO ARE KEPT APART ON PURPOSE. PillToggle
 *   is a VIEW SWITCH — This week / All time — so it always shows one option
 *   selected and cannot represent "not answered yet". A form field must be able
 *   to look blank, which is the whole reason this component exists. It also
 *   wraps; PillToggle is `whitespace-nowrap` and would overflow a form column on
 *   "With the machine / Separate shipment". Do not merge them.
 *
 * ⚠ ONLY FOR A FIXED VOCABULARY DECLARED IN CODE — never a master list, however
 *   few rows it holds today. There are three companies and the OCPI dryer master
 *   went from zero rows to six in one evening; a strip sized to today's data
 *   breaks the first time somebody adds a row, and nobody connects the broken
 *   layout to the master they edited.
 */

export interface Choice {
  value: string;
  label: string;
}

export default function ChoiceButtons({
  options,
  value,
  onChange,
  clearable,
  disabled,
  autoAdvance,
  ariaLabel,
  className,
}: {
  options: Choice[];
  /** `null` / `""` means UNANSWERED, and renders with nothing selected. */
  value: string | null;
  onChange: (value: string) => void;
  /**
   * Offer a way back to blank — an ✕, and clicking the selected option again.
   * Mirrors `Combobox.clearable`: opt-in, for OPTIONAL fields only. A required
   * field must NOT set it, or the form gains a way to un-answer something it
   * will then refuse to submit.
   */
  clearable?: boolean;
  disabled?: boolean;
  /** Move focus to the next field after a pick, matching `Combobox.autoAdvance`. */
  autoAdvance?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const selected = value === null || value === "" ? null : value;
  const index = selected === null ? -1 : options.findIndex((o) => o.value === selected);

  const pick = (v: string) => {
    if (disabled) return;
    // Clicking the selected option again is the second way back to blank, for
    // the same reason Combobox grew an ✕: without one, an optional field can be
    // answered but never un-answered.
    if (clearable && v === selected) {
      onChange("");
      return;
    }
    onChange(v);
    if (autoAdvance) setTimeout(() => advanceFocus(ref.current), 0);
  };

  /**
   * Arrow keys move AND select, which is how a radio group behaves everywhere.
   *
   * ⚠ `preventDefault` stops ↓ scrolling the page, and `stopPropagation` stops it
   *   reaching a `ScrollableTable` that would scroll instead — the same guard
   *   `Combobox` and `MultiSelect` carry for exactly this reason.
   */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled || options.length === 0) return;
    const fwd = e.key === "ArrowRight" || e.key === "ArrowDown";
    const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
    if (!fwd && !back) return;
    e.preventDefault();
    e.stopPropagation();
    const from = index < 0 ? (fwd ? -1 : 0) : index;
    const next = (((from + (fwd ? 1 : -1)) % options.length) + options.length) % options.length;
    onChange(options[next].value);
    const btns = ref.current?.querySelectorAll<HTMLButtonElement>("button[role='radio']");
    btns?.[next]?.focus();
  };

  return (
    <div ref={ref} className={cn("flex items-center gap-2", className)}>
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        // flex-wrap, so a long pair stacks instead of running out of the column.
        className="flex flex-wrap gap-2"
      >
        {options.map((o, i) => {
          const on = o.value === selected;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              // Roving tabindex: one stop for the whole group, on the selected
              // option — or the first, when nothing is answered yet.
              tabIndex={on || (index < 0 && i === 0) ? 0 : -1}
              onClick={() => pick(o.value)}
              className={cn(
                "h-9 min-w-[72px] rounded-lg border px-3 text-[13px] font-medium transition",
                on
                  ? "border-orange bg-orange text-white"
                  : "border-line bg-white text-navy hover:border-orange/50",
                disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>

      {clearable && selected !== null && !disabled && (
        <button
          type="button"
          aria-label="Clear"
          title="Clear"
          onClick={() => onChange("")}
          className="shrink-0 text-grey-2 transition hover:text-ink"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

/**
 * The yes/no case, which is most of them.
 *
 * ⚠ NULL IS NOT FALSE. A question nobody has answered and a question answered
 *   "No" are different facts — the OCPI writers clear a hidden branch to null and
 *   read `coalesce(x,'no')`, so collapsing the two here would answer questions on
 *   the salesperson's behalf.
 */
export function YesNoButtons({
  value,
  onChange,
  clearable,
  disabled,
  autoAdvance,
  ariaLabel,
  className,
}: {
  value: boolean | null;
  onChange: (value: boolean | null) => void;
  clearable?: boolean;
  disabled?: boolean;
  autoAdvance?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <ChoiceButtons
      options={[
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ]}
      value={value === null ? null : value ? "yes" : "no"}
      onChange={(v) => onChange(v === "" ? null : v === "yes")}
      clearable={clearable}
      disabled={disabled}
      autoAdvance={autoAdvance}
      ariaLabel={ariaLabel}
      className={className}
    />
  );
}
