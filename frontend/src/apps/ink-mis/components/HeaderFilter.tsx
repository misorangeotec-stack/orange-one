/**
 * A filter on EVERY column heading, the way a spreadsheet does it.
 *
 * The filters used to live in a row of their own under the headings, which only had room for
 * four of them — the planner could not filter on stock, cover, or a consignment's quantities at
 * all. A funnel on each heading scales to thirty columns without costing a row of screen.
 *
 * Three kinds, because a column is one of three things:
 *   text    contains-match, for names and codes
 *   list    tick the values, for anything with a fixed vocabulary
 *   number  from / to, for every quantity and every day count
 *
 * THE PANEL IS POSITIONED FIXED, not absolutely inside the heading. The table scrolls inside a
 * box with its own overflow, and an absolutely-placed panel is clipped by it — the filter would
 * open and be invisible. Fixed coordinates taken from the button escape that box.
 *
 * A funnel fills in when its filter is on, so a narrowed table always says which column narrowed
 * it — otherwise a filter left on from yesterday reads as missing data.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Filter } from "lucide-react";
import { Input } from "@hub/components/ui/input";
import { Button } from "@hub/components/ui/button";

export interface ColumnFilter {
  text?: string;
  list?: string[];
  min?: number;
  max?: number;
}

export const isFilterActive = (f: ColumnFilter | undefined): boolean =>
  Boolean(f && ((f.text ?? "").trim() || f.list?.length || f.min !== undefined || f.max !== undefined));

export default function HeaderFilter({
  kind,
  value,
  options = [],
  onChange,
}: {
  kind: "text" | "list" | "number";
  value: ColumnFilter | undefined;
  /** For `list`: every value the column can take, in the order they should be offered. */
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

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label="Filter this column"
        title={active ? "Filtered — click to change" : "Filter this column"}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm align-middle ${
          active ? "bg-primary text-primary-foreground" : "text-muted-foreground/60 hover:text-foreground"
        }`}
      >
        <Filter className="h-3 w-3" />
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

            {kind === "list" && (
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {options.length === 0 && (
                  <p className="text-xs text-muted-foreground">Nothing to filter on yet.</p>
                )}
                {options.map((o) => {
                  const on = value?.list?.includes(o) ?? false;
                  return (
                    <label key={o} className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => {
                          const cur = value?.list ?? [];
                          const next = on ? cur.filter((v) => v !== o) : [...cur, o];
                          set({ list: next.length ? next : undefined });
                        }}
                      />
                      <span className="truncate" title={o}>
                        {o || "(blank)"}
                      </span>
                    </label>
                  );
                })}
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
