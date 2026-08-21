import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/shared/lib/cn";
import { matchesSearch } from "@/shared/lib/search";
import { menuHeightFor, placeMenu, type MenuPos } from "@/shared/lib/menuPlacement";

export interface MultiOption {
  value: string;
  label: string;
  icon?: ReactNode;
  /**
   * Sticky heading this option sits under, mirroring {@link Combobox}'s `group`.
   *
   * This is what lets ONE picker stand in for several: the HR requisition form
   * has ~113 skills spanning five categories, and five separate dropdowns on one
   * screen reads as five times the work. Grouped, it is one familiar control with
   * a search box. Options without a group render exactly as they always did, so
   * every existing call site is untouched.
   */
  group?: string;
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
  triggerLabel,
  disabled,
  className,
  triggerClassName,
  align = "left",
  searchable,
  chips,
  onCreate,
  createLabel = (q) => `Add “${q}”`,
  maxRender,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  options: MultiOption[];
  /** Shown on the trigger when nothing is selected (means "all"). */
  placeholder?: string;
  /**
   * A FIXED trigger word, replacing the usual "this, that / 3 selected" summary.
   *
   * For a filter, the summary IS the answer — you want to read what you picked
   * without opening the menu. For a picker whose selection is the table itself
   * (QueueTable's column chooser), the summary is noise: "9 selected" names
   * nothing you can act on, while the count pill beside it already carries the
   * number. Such a control wants to say "Columns" and stay saying it.
   */
  triggerLabel?: string;
  disabled?: boolean;
  className?: string;
  /** Extra classes on the trigger button — used to slim it down inside a table cell. */
  triggerClassName?: string;
  align?: "left" | "right";
  /** Force the search box on/off; default: show once there are more than 6 options. */
  searchable?: boolean;
  /**
   * List the selection as removable tags under the control.
   *
   * The trigger collapses to "11 selected" past two options, which is right in a
   * filter bar — you set it and move on. It is wrong when the selection IS the
   * answer: on the requisition form the skills are prefilled from a JD, and
   * "11 selected" asks the HOD to open a menu and scroll to check work they did
   * not do. Opt-in, so the filter bars stay compact.
   */
  chips?: boolean;
  /**
   * Called with the typed term when it matches nothing, mirroring
   * {@link Combobox}. The requisition form hands it to the master-request modal,
   * so a HOD who needs a skill the master doesn't have is never stuck choosing
   * between the wrong option and no option.
   */
  onCreate?: (label: string) => void;
  createLabel?: (q: string) => string;
  /**
   * Cap how many matches are DRAWN, and say so when the cap bites.
   *
   * ⚠ OPT-IN, because it changes nothing for the ~190 existing call sites and
   *   must not. This list renders one <li> per match with no virtualisation, so
   *   a caller handing it a whole Tally stock book — 8,340 items for one company
   *   — stalls the dropdown on every keystroke. The cap draws the first N and
   *   tells the reader there are more, which a scrollbar into eight thousand
   *   rows never did.
   *
   * ⚠ IT ALSO DISARMS "Select all", and that is the point rather than a side
   *   effect. Select all acts on the SHOWN options (see below), so under a cap
   *   it adds at most N — where uncapped it would silently commit every one of
   *   the 8,340 matches in a single click.
   */
  maxRender?: number;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [pos, setPos] = useState<MenuPos | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const showSearch = searchable ?? (!!onCreate || options.length > 6);
  const selectedSet = new Set(values);
  const selected = options.filter((o) => selectedSet.has(o.value));
  const selectedLabels = selected.map((o) => o.label);
  const summary =
    triggerLabel ??
    (selectedLabels.length === 0
      ? placeholder
      : selectedLabels.length <= 2
        ? selectedLabels.join(", ")
        : `${selectedLabels.length} selected`);
  /** A fixed label is the control's name, not a placeholder, so it never greys out. */
  const summaryIsPlaceholder = !triggerLabel && selectedLabels.length === 0;

  const toggle = (value: string) => {
    onChange(selectedSet.has(value) ? values.filter((v) => v !== value) : [...values, value]);
  };

  const filtered = useMemo(
    () => (q.trim() ? options.filter((o) => matchesSearch(q, o.label)) : options),
    [q, options]
  );
  const searching = q.trim().length > 0;

  /**
   * What is actually DRAWN. Identical to `filtered` unless a caller asked for a
   * cap — see `maxRender`. Everything downstream reads this rather than
   * `filtered`, so "shown" means one thing throughout: on screen, selectable,
   * and reachable by Select all.
   */
  const visible = useMemo(
    () => (maxRender && filtered.length > maxRender ? filtered.slice(0, maxRender) : filtered),
    [filtered, maxRender],
  );
  const truncated = visible.length < filtered.length;

  /**
   * `visible` split into sections, in the order each group FIRST appears — so
   * the caller controls section order by ordering its options, and never has to
   * pass a separate list of groups. Ungrouped options collect under "" and render
   * headerless, which is what keeps the ungrouped call sites pixel-identical.
   */
  const grouped = useMemo(() => {
    const out: { group: string; options: MultiOption[] }[] = [];
    const byGroup = new Map<string, MultiOption[]>();
    for (const o of visible) {
      const g = o.group ?? "";
      let bucket = byGroup.get(g);
      if (!bucket) {
        bucket = [];
        byGroup.set(g, bucket);
        out.push({ group: g, options: bucket });
      }
      bucket.push(o);
    }
    return out;
  }, [visible]);

  // Select all / Clear all act on the *shown* options: with a search active,
  // "Select all" adds the matches to the selection rather than picking everyone,
  // and "Clear all" drops just the matches. Unfiltered, both behave as before.
  // Offer creation only when the term doesn't already match an option exactly.
  const trimmed = q.trim();
  const canCreate =
    !!onCreate && trimmed.length > 0 && !options.some((o) => o.label.toLowerCase() === trimmed.toLowerCase());

  const create = () => {
    if (!onCreate) return;
    onCreate(trimmed);
    setOpen(false);
    setQ("");
  };

  const shownValues = visible.map((o) => o.value);
  const allShownSelected = shownValues.length > 0 && shownValues.every((v) => selectedSet.has(v));
  const noneShownSelected = shownValues.every((v) => !selectedSet.has(v));
  const selectAllShown = () => onChange([...new Set([...values, ...shownValues])]);
  const clearAllShown = () =>
    onChange(searching ? values.filter((v) => !shownValues.includes(v)) : []);

  /*
   * Position the portalled menu against the trigger using fixed coords, so it
   * escapes any `overflow-hidden` ancestor (e.g. a Card) that would clip it —
   * and against the VIEWPORT, so the bottom of the screen cannot clip it either:
   * `placeMenu` flips the list above the trigger when that is where the room is,
   * and caps its height to what fits. Same rule as Combobox; see
   * lib/menuPlacement.ts.
   */
  useLayoutEffect(() => {
    if (!open) return;
    const wantedHeight = menuHeightFor(options.length + (onCreate ? 1 : 0), {
      search: showSearch,
      header: options.length > 0, // the select-all / clear-all bar
    });
    const place = () => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      setPos(placeMenu(r, { align, wantedHeight }));
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        onKeyDown={(e) => {
          if (disabled) return;
          // Open with the arrow keys (native Enter/Space already toggles the button).
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            // An arrow key inside a scroll container would otherwise ALSO scroll it:
            // ScrollableTable claims the arrows and only bails for INPUT/TEXTAREA/SELECT,
            // never for a button. Without this, ↓ on a queue's filter scrolls the table
            // instead of opening the menu — which is exactly what a native <select> did
            // not do. Mirrors the same guard in Combobox.
            e.stopPropagation();
            setOpen(true);
          }
        }}
        className={cn(
          "w-full flex items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2.5 text-[14px] text-left transition",
          "outline-none focus:border-orange focus:ring-4 focus:ring-orange/10",
          disabled ? "bg-page text-grey-2 cursor-not-allowed" : "text-ink hover:border-[#d9e2f0] cursor-pointer",
          open && "border-orange ring-4 ring-orange/10",
          triggerClassName
        )}
      >
        <span className={cn("flex-1 truncate", summaryIsPlaceholder && "text-grey-2")}>{summary}</span>
        {selectedLabels.length > 0 && (
          <span className="shrink-0 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-orange-soft text-orange text-[11px] font-semibold">
            {selectedLabels.length}
          </span>
        )}
        <svg className={cn("text-grey-2 transition-transform shrink-0", open && "rotate-180")} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* In `options` order, so a grouped list keeps its categories together. */}
      {chips && selected.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selected.map((o) => (
            <span
              key={o.value}
              className="inline-flex items-center gap-1 rounded-full bg-orange-soft px-2.5 py-1 text-[12px] font-medium text-orange"
            >
              {o.label}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => toggle(o.value)}
                  aria-label={`Remove ${o.label}`}
                  className="text-orange/60 hover:text-orange leading-none"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {open && pos && createPortal(
        <div
          ref={menuRef}
          tabIndex={-1}
          // Marks an open portalled menu, so an enclosing Modal knows to let
          // Escape close just this menu instead of the whole dialog.
          data-portal-menu=""
          style={{
            position: "fixed",
            top: pos.top,
            bottom: pos.bottom,
            left: pos.left,
            right: pos.right,
            minWidth: pos.minWidth,
            maxHeight: pos.maxHeight,
            // The horizontal twin of maxHeight, in place of the old flat
            // `max-w-[320px]` that cut every long name to the same prefix.
            maxWidth: pos.maxWidth,
          }}
          // `flex flex-col` is what makes the capped height reach the list: the
          // search box and the select-all bar keep their size, the <ul> takes the rest.
          className="z-[70] flex flex-col w-max bg-white border border-line rounded-xl shadow-card overflow-hidden outline-none"
        >
          {showSearch && (
            <div className="shrink-0 p-2 border-b border-line">
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
            <div className="shrink-0 px-2 py-1.5 border-b border-line flex items-center justify-between gap-2">
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
          <ul className="flex-1 min-h-0 max-h-60 overflow-y-auto py-1">
            {visible.length === 0 && !canCreate && (
              <li className="px-3 py-3 text-center text-[12.5px] text-grey-2">No matches</li>
            )}
            {grouped.map((section) => (
              <li key={section.group || "__ungrouped"}>
                {section.group && (
                  <div className="sticky top-0 z-10 bg-page/95 backdrop-blur-sm px-3 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-grey-2 border-b border-line/70">
                    {section.group}
                  </div>
                )}
                <ul>
                  {section.options.map((o) => {
                    const on = selectedSet.has(o.value);
                    return (
                      <li key={o.value}>
                        <button
                          type="button"
                          onClick={() => toggle(o.value)}
                          className={cn(
                            "w-full flex items-center gap-2.5 px-3 py-2 text-left transition border-l-[3px] border-l-transparent",
                            on ? "bg-orange-soft/60" : "hover:bg-line hover:border-l-orange"
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
                          <span className={cn("min-w-0 flex-1 text-[13.5px] break-words", on ? "text-orange font-semibold" : "text-navy")}>{o.label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}

            {/* Say what is being withheld. A capped list that stays silent reads
                as "these are all of them", which is the one thing it is not. */}
            {truncated && (
              <li className="border-t border-line mt-1 px-3 py-2 text-center text-[12px] text-grey-2">
                Showing {visible.length} of {filtered.length} — keep typing to narrow.
              </li>
            )}

            {canCreate && (
              <li className={cn(visible.length > 0 && "border-t border-line mt-1 pt-1")}>
                <button
                  type="button"
                  onClick={create}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition border-l-[3px] border-l-transparent hover:bg-orange-soft/40 hover:border-l-orange"
                >
                  <span className="shrink-0 flex items-center justify-center w-5 h-5 rounded-full bg-orange-soft text-orange">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  </span>
                  <span className="min-w-0 flex-1 text-[13.5px] text-orange font-semibold break-words">{createLabel(trimmed)}</span>
                </button>
              </li>
            )}
          </ul>
        </div>,
        document.body
      )}
    </div>
  );
}
