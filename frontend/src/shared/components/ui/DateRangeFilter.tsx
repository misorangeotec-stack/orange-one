import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/shared/lib/cn";
import { formatDate, todayIso, weekStartOf, weekEndOf } from "@/shared/lib/time";

export interface DateRange {
  from: string | null; // yyyy-mm-dd, inclusive
  to: string | null; // yyyy-mm-dd, inclusive
}

/** The "no filter" value. A shared constant so every caller resets identically. */
export const EMPTY_RANGE: DateRange = { from: null, to: null };

export const isRangeActive = (r: DateRange): boolean => !!(r.from || r.to);

/**
 * Does a date fall inside the range? Both ends are inclusive, and an empty range
 * matches everything.
 *
 * NOTE the `.slice(0, 10)`: this is fed both plain ISO dates (`dueDate`) and full
 * ISO datetimes off a Postgres timestamptz (`createdAt`). Slicing takes the UTC
 * date, which is exactly what `formatDate`/`dateLabel` in shared/lib/time render
 * in the table cell — so the filter always agrees with the column it sits under.
 * Do NOT swap this for `dayKey` (shared/lib/date): that one reads the LOCAL date,
 * which differs from the displayed value for anything stamped before 05:30 IST.
 */
export function dateInRange(iso: string | null, r: DateRange): boolean {
  if (!r.from && !r.to) return true;
  if (!iso) return false; // a task with no due date isn't "due in June"
  const d = iso.slice(0, 10);
  if (r.from && d < r.from) return false;
  if (r.to && d > r.to) return false;
  return true;
}

/**
 * Stable string for a range. Needed because `useStickyState` hands back a fresh
 * object on every change, so interpolating one into usePagination's `resetKey`
 * would yield a constant "[object Object]" and the page would never reset.
 */
export const rangeKey = (r: DateRange): string => `${r.from ?? ""}~${r.to ?? ""}`;

/** Human summary of a range, e.g. for an active-filter chip. "" when unset. */
export function rangeLabel(r: DateRange): string {
  if (r.from && r.to) return `${formatDate(r.from)} → ${formatDate(r.to)}`;
  if (r.from) return `From ${formatDate(r.from)}`;
  if (r.to) return `Until ${formatDate(r.to)}`;
  return "";
}

/** Shift an ISO date by n days, in UTC — matching weekStartOf/addWeeks in time.ts. */
function shiftDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * From→to date filter, styled to match {@link Combobox} / {@link MultiSelect}.
 * An empty range means "no filter" (i.e. any date), the same convention
 * MultiSelect uses for an empty selection.
 *
 * The panel is PORTALLED to document.body with fixed coords, like the other two
 * dropdowns. That isn't cosmetic: these sit inside a table wrapped in
 * ScrollableTable's `overflow-auto` container AND inside a Card's
 * `overflow-hidden`, either of which would clip an absolutely-positioned panel.
 * The capture-phase scroll listener is what keeps it glued to its trigger while
 * the table scrolls horizontally.
 */
export default function DateRangeFilter({
  value,
  onChange,
  placeholder = "Any date",
  disabled,
  className,
  triggerClassName,
  align = "left",
}: {
  value: DateRange;
  onChange: (v: DateRange) => void;
  /** Shown on the trigger when nothing is set (means "any"). */
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Extra classes on the trigger button — used to slim it down inside a table cell. */
  triggerClassName?: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number; minWidth: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const active = isRangeActive(value);
  const summary = active ? rangeLabel(value) : placeholder;

  const apply = (next: DateRange, close = true) => {
    onChange(next);
    if (close) setOpen(false);
  };

  // Presets are built from todayIso()/weekStartOf() rather than local Date parts,
  // so their boundaries land on the same UTC days the table cells display.
  const today = todayIso();
  const presets: { label: string; range: DateRange }[] = [
    { label: "Today", range: { from: today, to: today } },
    { label: "This week", range: { from: weekStartOf(today), to: weekEndOf(today) } },
    { label: "Last 30 days", range: { from: shiftDays(today, -29), to: today } },
  ];

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      setPos({
        top: r.bottom + 4,
        minWidth: r.width,
        ...(align === "right" ? { right: window.innerWidth - r.right } : { left: r.left }),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={cn("relative", className)} ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        title={active ? rangeLabel(value) : placeholder}
        className={cn(
          "w-full flex items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2.5 text-[14px] text-left transition",
          "outline-none focus:border-orange focus:ring-4 focus:ring-orange/10",
          disabled ? "bg-page text-grey-2 cursor-not-allowed" : "text-ink hover:border-[#d9e2f0] cursor-pointer",
          open && "border-orange ring-4 ring-orange/10",
          triggerClassName,
        )}
      >
        <svg className="shrink-0 text-grey-2" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        <span className={cn("flex-1 truncate", !active && "text-grey-2")}>{summary}</span>
        {active && <span className="shrink-0 w-[7px] h-[7px] rounded-full bg-orange" />}
        <svg className={cn("text-grey-2 transition-transform shrink-0", open && "rotate-180")} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && pos && createPortal(
        <div
          ref={menuRef}
          tabIndex={-1}
          // Marks an open portalled menu, so an enclosing Modal knows to let
          // Escape close just this panel instead of the whole dialog.
          data-portal-menu=""
          style={{ position: "fixed", top: pos.top, left: pos.left, right: pos.right, minWidth: pos.minWidth }}
          className="z-[70] w-[264px] bg-white border border-line rounded-xl shadow-card overflow-hidden outline-none"
        >
          <div className="p-2.5 space-y-2">
            <label className="block">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-grey-2 mb-1">From</span>
              <input
                type="date"
                value={value.from ?? ""}
                max={value.to ?? undefined}
                onChange={(e) => apply({ ...value, from: e.target.value || null }, false)}
                className="w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] text-ink outline-none transition focus:border-orange"
              />
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-grey-2 mb-1">To</span>
              <input
                type="date"
                value={value.to ?? ""}
                min={value.from ?? undefined}
                onChange={(e) => apply({ ...value, to: e.target.value || null }, false)}
                className="w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] text-ink outline-none transition focus:border-orange"
              />
            </label>
          </div>

          <div className="px-2.5 pb-2.5 flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => apply(p.range)}
                className="rounded-pill border border-line bg-page px-2.5 py-1 text-[11.5px] font-semibold text-navy hover:border-orange hover:text-orange transition"
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="px-2.5 py-2 border-t border-line flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => apply(EMPTY_RANGE)}
              disabled={!active}
              className="text-[12px] font-semibold text-orange hover:underline disabled:text-grey-2 disabled:no-underline disabled:cursor-not-allowed"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[12px] font-semibold text-navy hover:text-orange transition"
            >
              Done
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
