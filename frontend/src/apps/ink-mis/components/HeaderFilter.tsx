/**
 * A SORT TOGGLE AND A FILTER ON EVERY COLUMN HEADING, the way a spreadsheet does it.
 *
 * The filters used to live in a row of their own under the headings, which only had room for
 * four of them — the planner could not filter on stock, cover, or a consignment's quantities at
 * all. A funnel on each heading scales to thirty columns without costing a row of screen.
 *
 * Three kinds of filter, because a column is one of three things:
 *   text    contains-match, for names and codes
 *   list    tick the values, for anything with a fixed vocabulary
 *   number  from / to, for every quantity and every day count
 *
 * ─── THE TICK-LIST IS THE PORTAL'S OWN PICKER ─────────────────────────────────────────────
 *
 * `list` does not draw its own checkboxes. It opens `@/shared/components/ui/MultiSelect`, the
 * same control behind every filter in every other module, from a funnel-shaped trigger. That is
 * not decoration: the hand-rolled list had no search box, so narrowing a column with dozens of
 * item groups meant scrolling a 256px panel; it also had no "Select all", no pinning of what you
 * had already ticked, and it spelled a blank "(blank)" where the rest of the portal spells it
 * "(Blank)". Borrowing the control means none of that can drift again, and the search box, the
 * blank handling and the arrow-key guard inside a scrolling table all come with it.
 *
 * ⚠ THE PANEL IS POSITIONED FIXED, not absolutely inside the heading, and the borrowed picker
 *   portals for the same reason. The table scrolls inside a box with its own overflow, and an
 *   absolutely-placed panel is clipped by it — the filter would open and be invisible.
 *
 * A funnel fills in when its filter is on, so a narrowed table always says which column narrowed
 * it — otherwise a filter left on from yesterday reads as missing data. The sort arrow does the
 * same job for ordering: ↕ means "sortable, not sorted by me", ▲ / ▼ mean this column owns the
 * order, so the planner is never looking at a re-ordered sheet without being told.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Filter } from "lucide-react";
import { Input } from "@hub/components/ui/input";
import { Button } from "@hub/components/ui/button";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import { filterOptionLabel } from "@/shared/lib/blankFilter";
import { isFilterActive, nextSort, type ColumnFilter, type SortState } from "../lib/grid";

// Both live in `lib/grid.ts` now, with the sorting and cascading that read them. Re-exported
// here so the screens keep importing them from the component they see on screen.
export { isFilterActive };
export type { ColumnFilter };

/** The funnel itself, shared by both triggers so an on/off filter always looks the same. */
function FunnelIcon({ active }: { active: boolean }) {
  return (
    <span
      className={`ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm align-middle ${
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground/60 hover:text-foreground"
      }`}
    >
      <Filter className="h-3 w-3" />
    </span>
  );
}

/**
 * The heading itself: click the words to sort, click the funnel to filter.
 *
 * Both live in one component so no screen can add a column with one and not the other. The
 * label is a button rather than plain text, which is what makes "every grid sorts on every
 * column" true by construction here rather than by each author remembering.
 */
export function ColumnHead({
  label,
  id,
  sort,
  setSort,
  children,
  wrap = false,
}: {
  label: ReactNode;
  id: string;
  sort: SortState;
  setSort: (next: SortState) => void;
  /** The funnel for this column, if it has one. */
  children?: ReactNode;
  /** Tiny type that wraps onto more lines instead of clipping with "…". */
  wrap?: boolean;
}) {
  const mine = sort?.key === id;
  return (
    <span className="inline-flex max-w-full items-center">
      <button
        type="button"
        onClick={() => setSort(nextSort(sort, id))}
        title="Sort on this column"
        className={`inline-flex min-w-0 items-center gap-1 text-left hover:text-foreground ${
          mine ? "text-foreground" : ""
        }`}
      >
        <span
          className={
            wrap ? "whitespace-normal break-words text-[8pt] leading-tight" : "truncate"
          }
        >
          {label}
        </span>
        <span className="shrink-0 text-[9px] leading-none">
          {mine ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
      {children}
    </span>
  );
}

export default function HeaderFilter({
  kind,
  value,
  options = [],
  onChange,
}: {
  kind: "text" | "list" | "number";
  value: ColumnFilter | undefined;
  /**
   * For `list`: every value the column can take, already narrowed by the other filters and
   * blank-folded (see `lib/grid.ts`). Drawn through `filterOptionLabel`, so the sentinel for
   * "nothing here" reads as "(Blank)" exactly as it does everywhere else in the portal.
   */
  options?: string[];
  onChange: (next: ColumnFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const active = isFilterActive(value);

  useLayoutEffect(() => {
    if (!open) return;
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    // Nudged back from the right edge so a panel opened on the last column stays on screen.
    setPos({ left: Math.min(r.left, window.innerWidth - 260), top: r.bottom + 4 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || btn.current?.contains(t)) return;
      setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const set = (patch: ColumnFilter) => onChange({ ...value, ...patch });
  const clear = () => onChange({});

  /**
   * A tick-list is the portal's picker, opened from the funnel. Nothing of the bespoke panel is
   * used, so there is no second popover to keep positioned and no second "click away to close".
   */
  if (kind === "list") {
    return (
      <MultiSelect
        className="inline-block align-middle"
        values={value?.list ?? []}
        onChange={(list) => onChange({ ...value, list: list.length ? list : undefined })}
        options={options.map((o) => ({ value: o, label: filterOptionLabel(o) }))}
        searchable
        triggerLabel={active ? "Filtered, click to change" : "Filter this column"}
        triggerClassName="align-middle"
        trigger={() => <FunnelIcon active={active} />}
      />
    );
  }

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label="Filter this column"
        title={active ? "Filtered, click to change" : "Filter this column"}
        onClick={(e) => {
          // The heading sorts on click, so the funnel must not sort on its way to opening.
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="align-middle"
      >
        <FunnelIcon active={active} />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panel}
            style={{ position: "fixed", left: pos.left, top: pos.top, zIndex: 60 }}
            className="w-64 rounded-md border bg-popover p-2 text-sm shadow-lg"
          >
            {kind === "text" && (
              <Input
                autoFocus
                className="h-8"
                placeholder="Contains…"
                value={value?.text ?? ""}
                onChange={(e) => set({ text: e.target.value })}
              />
            )}

            {kind === "number" && (
              <div className="flex items-center gap-2">
                <Input
                  autoFocus
                  type="number"
                  className="h-8"
                  placeholder="From"
                  value={value?.min ?? ""}
                  onChange={(e) =>
                    set({ min: e.target.value === "" ? undefined : Number(e.target.value) })
                  }
                />
                <span className="text-xs text-muted-foreground">to</span>
                <Input
                  type="number"
                  className="h-8"
                  placeholder="To"
                  value={value?.max ?? ""}
                  onChange={(e) =>
                    set({ max: e.target.value === "" ? undefined : Number(e.target.value) })
                  }
                />
              </div>
            )}

            <div className="mt-2 flex items-center justify-between">
              <Button size="sm" variant="ghost" onClick={clear} disabled={!active}>
                Clear
              </Button>
              <Button size="sm" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
