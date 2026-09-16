/**
 * What to order, by group — the one question this whole report exists to answer.
 *
 * ─── THE NUMBER ──────────────────────────────────────────────────────────────────────────
 *
 *   to order = month max level − (stock + ETA + at port)
 *
 * Month max level is the planner's own target (three-month average × lead time × safety), and
 * ink already on the water counts against it, exactly as it does in the table's Total column.
 * A line at or above its target contributes nothing; a line with no target set contributes
 * nothing either, because a shortfall against an unset target is not a fact.
 *
 * ─── THE FORM ────────────────────────────────────────────────────────────────────────────
 *
 * Magnitude compared across a handful of named things: horizontal bars, longest first, so the
 * group to deal with first is the one at the top. One series, so no legend — the heading says
 * what is plotted. Every bar is labelled, which is only safe because the list is capped at ten
 * groups; the rest fold into "Other groups" rather than becoming a wall of hairlines.
 *
 * Clicking a group opens its inks with their own figures, since "REACTIVE needs 4,000" is
 * where the question starts, not where it ends.
 *
 * It follows the table: whatever is filtered, or whichever company tab is open, is what is
 * charted. Two different answers on one screen would be worse than none.
 */
import { useMemo, useState } from "react";
import { fmtQty, type InkRow } from "../lib/inkMis";

const TOP_N = 10;
const BAR = "#FF6A1F"; // the Hub's accent, and the only hue here — a single series

export function reorderQty(r: InkRow): number {
  if (r.monthMaxLevel <= 0) return 0;
  return Math.max(0, r.monthMaxLevel - (r.stock + r.incoming));
}

interface Group {
  name: string;
  qty: number;
  items: { key: string; label: string; qty: number }[];
}

export default function ReorderChart({ rows, unit = "KGS" }: { rows: InkRow[]; unit?: string }) {
  const [open, setOpen] = useState<string | null>(null);

  const groups = useMemo<Group[]>(() => {
    const by = new Map<string, Group>();
    for (const r of rows) {
      const qty = reorderQty(r);
      if (qty <= 0) continue;
      const name = r.group?.trim() || "No group";
      const g = by.get(name) ?? { name, qty: 0, items: [] };
      g.qty += qty;
      g.items.push({ key: r.key, label: r.itemCode || r.description, qty });
      by.set(name, g);
    }
    const all = [...by.values()].sort((a, b) => b.qty - a.qty);
    all.forEach((g) => g.items.sort((a, b) => b.qty - a.qty));
    if (all.length <= TOP_N) return all;
    // Tail folded into one bar rather than a wall of hairlines; it still opens to its items.
    const head = all.slice(0, TOP_N);
    const tail = all.slice(TOP_N);
    head.push({
      name: `Other groups (${tail.length})`,
      qty: tail.reduce((t, g) => t + g.qty, 0),
      items: tail.flatMap((g) => g.items).sort((a, b) => b.qty - a.qty),
    });
    return head;
  }, [rows]);

  const total = groups.reduce((t, g) => t + g.qty, 0);
  const max = groups.length ? groups[0].qty : 0;

  if (!groups.length) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        <div className="font-medium text-foreground">Nothing to order</div>
        Every line shown is at or above its month max level — or has no lead time set yet, which
        is what gives a line a target to fall short of.
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">To order, by group</h2>
        <p className="text-xs text-muted-foreground">
          Month max level less stock and ink on the way. Click a group for its inks.
        </p>
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">
        {fmtQty(total)} <span className="text-sm font-normal text-muted-foreground">{unit}</span>
      </div>

      <div className="mt-4 space-y-[2px]">
        {groups.map((g) => {
          const isOpen = open === g.name;
          return (
            <div key={g.name}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : g.name)}
                aria-expanded={isOpen}
                title={`${g.name}: ${fmtQty(g.qty)} ${unit} across ${g.items.length} ink${g.items.length === 1 ? "" : "s"}`}
                className="flex w-full items-center gap-3 rounded px-1 py-1 text-left hover:bg-muted/60"
              >
                <span className="w-44 shrink-0 truncate text-xs text-muted-foreground">
                  {isOpen ? "▾" : "▸"} {g.name}
                </span>
                <span className="relative h-5 flex-1">
                  <span
                    className="absolute left-0 top-0 h-5 rounded-r"
                    style={{
                      width: `${max ? Math.max((g.qty / max) * 100, 0.5) : 0}%`,
                      backgroundColor: BAR,
                    }}
                  />
                </span>
                <span className="w-24 shrink-0 text-right text-xs font-medium tabular-nums">
                  {fmtQty(g.qty)}
                </span>
              </button>

              {isOpen && (
                <ul className="mb-2 ml-44 space-y-1 border-l pl-3 pt-1">
                  {g.items.map((it) => (
                    <li key={it.key} className="flex items-center gap-3 text-xs">
                      <span className="flex-1 truncate">{it.label}</span>
                      <span className="w-24 text-right tabular-nums">{fmtQty(it.qty)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
