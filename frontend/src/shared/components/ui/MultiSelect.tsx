import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/shared/lib/cn";
import { matchesSearch } from "@/shared/lib/search";

export interface MultiOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

/**
 * Multi-select dropdown, styled to match {@link Combobox}. Holds an array of
 * selected values; an empty array means "no filter" (i.e. all). The menu stays
 * open while toggling options so several can be picked at once, and a search box
 * appears once the list is long enough to be worth filtering (people pickers run
 * to hundreds of names). Select all / Clear all act on what's currently shown, so
 * searching then "Select all" adds just the matches.
 */
export default function MultiSelect({
  values,
  onChange,
  options,
  placeholder = "Any",
  disabled,
  className,
  align = "left",
  searchable,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  options: MultiOption[];
  /** Shown on the trigger when nothing is selected (means "all"). */
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  align?: "left" | "right";
  /** Force the search box on/off; default: show once there are more than 6 options. */
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number; minWidth: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const showSearch = searchable ?? options.length > 6;
  const selectedSet = new Set(values);
  const selectedLabels = options.filter((o) => selectedSet.has(o.value)).map((o) => o.label);
  const summary =
    selectedLabels.length === 0
      ? placeholder
      : selectedLabels.length <= 2
        ? selectedLabels.join(", ")
        : `${selectedLabels.length} selected`;

  const toggle = (value: string) => {
    onChange(selectedSet.has(value) ? values.filter((v) => v !== value) : [...values, value]);
  };

  const filtered = useMemo(
    () => (q.trim() ? options.filter((o) => matchesSearch(q, o.label)) : options),
    [q, options]
  );
  const searching = q.trim().length > 0;

  // Select all / Clear all act on the *shown* options: with a search active,
  // "Select all" adds the matches to the selection rather than picking everyone,
  // and "Clear all" drops just the matches. Unfiltered, both behave as before.
  const shownValues = filtered.map((o) => o.value);
  const allShownSelected = shownValues.length > 0 && shownValues.every((v) => selectedSet.has(v));
  const noneShownSelected = shownValues.every((v) => !selectedSet.has(v));
  const selectAllShown = () => onChange([...new Set([...values, ...shownValues])]);
  const clearAllShown = () =>
    onChange(searching ? values.filter((v) => !shownValues.includes(v)) : []);

  // Position the portalled menu under the trigger using fixed coords so it
  // escapes any `overflow-hidden` ancestor (e.g. a Card) that would clip it.
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
    // Land the caret in the search box so you can just start typing a name.
    if (showSearch) setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, showSearch]);

  // Drop the query when the menu closes, so reopening starts from the full list.
  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  return (
    <div className={cn("relative", className)} ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={cn(
          "w-full flex items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2.5 text-[14px] text-left transition",
          "outline-none focus:border-orange focus:ring-4 focus:ring-orange/10",
          disabled ? "bg-page text-grey-2 cursor-not-allowed" : "text-ink hover:border-[#d9e2f0] cursor-pointer",
          open && "border-orange ring-4 ring-orange/10"
        )}
      >
        <span className={cn("flex-1 truncate", selectedLabels.length === 0 && "text-grey-2")}>{summary}</span>
        {selectedLabels.length > 0 && (
          <span className="shrink-0 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-orange-soft text-orange text-[11px] font-semibold">
            {selectedLabels.length}
          </span>
        )}
        <svg className={cn("text-grey-2 transition-transform shrink-0", open && "rotate-180")} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && pos && createPortal(
        <div
          ref={menuRef}
          tabIndex={-1}
          // Marks an open portalled menu, so an enclosing Modal knows to let
          // Escape close just this menu instead of the whole dialog.
          data-portal-menu=""
          style={{ position: "fixed", top: pos.top, left: pos.left, right: pos.right, minWidth: pos.minWidth }}
          className="z-[70] w-max max-w-[320px] bg-white border border-line rounded-xl shadow-card overflow-hidden outline-none"
        >
          {showSearch && (
            <div className="p-2 border-b border-line">
              <div className="relative">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-grey-2" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                <input
                  ref={inputRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search…"
                  className="w-full rounded-lg border border-line bg-page pl-8 pr-2 py-1.5 text-[13px] text-ink placeholder:text-grey-2 outline-none focus:border-orange"
                />
              </div>
            </div>
          )}
          {options.length > 0 && (
            <div className="px-2 py-1.5 border-b border-line flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">
                {searching
                  ? `${filtered.length} match${filtered.length === 1 ? "" : "es"}`
                  : values.length > 0
                    ? `${values.length} selected`
                    : `${options.length} option${options.length === 1 ? "" : "s"}`}
              </span>
              <span className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={selectAllShown}
                  disabled={allShownSelected}
                  className="text-[12px] font-semibold text-orange hover:underline disabled:text-grey-2 disabled:no-underline disabled:cursor-not-allowed"
                >
                  {searching ? "Select matches" : "Select all"}
                </button>
                <button
                  type="button"
                  onClick={clearAllShown}
                  disabled={searching ? noneShownSelected : values.length === 0}
                  className="text-[12px] font-semibold text-orange hover:underline disabled:text-grey-2 disabled:no-underline disabled:cursor-not-allowed"
                >
                  {searching ? "Clear matches" : "Clear all"}
                </button>
              </span>
            </div>
          )}
          <ul className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <li className="px-3 py-3 text-center text-[12.5px] text-grey-2">No matches</li>
            )}
            {filtered.map((o) => {
              const on = selectedSet.has(o.value);
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    onClick={() => toggle(o.value)}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-3 py-2 text-left transition",
                      on ? "bg-orange-soft/60" : "hover:bg-page"
                    )}
                  >
                    <span
                      className={cn(
                        "shrink-0 flex items-center justify-center w-[18px] h-[18px] rounded-[5px] border transition",
                        on ? "bg-orange border-orange text-white" : "border-line bg-white text-transparent"
                      )}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                    </span>
                    {o.icon && <span className="shrink-0 flex items-center">{o.icon}</span>}
                    <span className={cn("min-w-0 flex-1 text-[13.5px] truncate", on ? "text-orange font-semibold" : "text-navy")}>{o.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>,
        document.body
      )}
    </div>
  );
}
