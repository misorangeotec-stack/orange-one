/**
 * What to order — the one question this whole report exists to answer.
 *
 * ─── THE NUMBER ──────────────────────────────────────────────────────────────────────────
 *
 *   to order = month max level − (stock + ETA + at port + plant orders)
 *
 * Month max level is the planner's own target (three-month average × lead time × safety), and
 * supply already arranged counts against it, exactly as it does in the table's Total column.
 * A line at or above its target contributes nothing; a line with no target set contributes
 * nothing either, because a shortfall against an unset target is not a fact.
 *
 * ─── THE FORM: SMALL MULTIPLES, ONE PANEL PER CATEGORY ───────────────────────────────────
 *
 * One panel per category across a single strip, each holding a mini bar chart of ITS GROUPS.
 * Categories are how the ink is bought; groups are what an order is actually placed against.
 * Both live on screen at once, which the earlier drill-down could not do — it made the planner
 * click a category, read a number, and click again before seeing anything they could act on.
 *
 * Bars are scaled WITHIN their panel, not across the strip. Sublimation's 38,173 would flatten
 * Chemical's 210 to a hairline, and the comparison that matters inside a panel is between that
 * category's own groups; the panel heading carries the category total for comparing across.
 *
 * Five bars a panel, the rest folded into one "Other groups" bar that still opens, so a
 * category with twenty groups cannot stretch the strip.
 *
 * Clicking a bar opens that group's inks in a full-width table BELOW the strip — the room for
 * six columns is there and not inside a 260px panel.
 *
 * ITEMS WITH NO CATEGORY ARE NOT DRAWN. They can carry real order quantities, so the strip says
 * how many and how much, rather than letting them vanish quietly.
 *
 * It follows the table: whatever is filtered, or whichever company tab is open, is what is
 * counted. Two different answers on one screen would be worse than none.
 */
import { useMemo, useState } from "react";
import { INK_CATEGORIES, fmtDays, fmtQty, type InkRow } from "../lib/inkMis";

/** Bars per panel before the tail is folded away. */
const BARS = 5;
const BAR_COLOR = "#FF6A1F"; // the Hub's accent, and the only hue here — a single series

export function reorderQty(r: InkRow): number {
  if (r.monthMaxLevel <= 0) return 0;
  return Math.max(0, r.monthMaxLevel - (r.stock + r.incoming + r.plant));
}

interface BucketItem {
  key: string;
  label: string;
  stock: number;
  incoming: number;
  target: number;
  qty: number;
  daysCover: number | null;
}

interface Group {
  name: string;
  qty: number;
  items: BucketItem[];
}

interface Panel {
  name: string;
  qty: number;
  groups: Group[];
}

export default function ReorderChart({ rows, unit = "KGS" }: { rows: InkRow[]; unit?: string }) {
  const [open, setOpen] = useState<{ category: string; group: string } | null>(null);

  const { panels, uncategorised } = useMemo(() => {
    const by = new Map<string, Map<string, Group>>();
    let noCategoryQty = 0;
    let noCategoryCount = 0;

    for (const r of rows) {
      const qty = reorderQty(r);
      if (qty <= 0) continue;
      const category = r.category?.trim();
      if (!category) {
        noCategoryQty += qty;
        noCategoryCount++;
        continue;
      }
      const groupName = r.group?.trim() || "No group";
      const groups = by.get(category) ?? new Map<string, Group>();
      const g = groups.get(groupName) ?? { name: groupName, qty: 0, items: [] };
      g.qty += qty;
      g.items.push({
        key: r.key,
        // The description, never the code: the planner reads these lines by name.
        label: r.description || r.itemCode,
        stock: r.stock,
        incoming: r.incoming + r.plant,
        target: r.monthMaxLevel,
        qty,
        daysCover: r.daysCover,
      });
      groups.set(groupName, g);
      by.set(category, groups);
    }

    // Widened to plain strings: a category saved before the list grew (or typed into an
    // imported file) still has to sort somewhere rather than fail to compile.
    const order: string[] = [...INK_CATEGORIES];
    const out: Panel[] = [...by.entries()].map(([name, groups]) => {
      const all = [...groups.values()]
        .map((g) => ({ ...g, items: [...g.items].sort((a, b) => b.qty - a.qty) }))
        .sort((a, b) => b.qty - a.qty);
      const qty = all.reduce((t, g) => t + g.qty, 0);
      if (all.length <= BARS) return { name, qty, groups: all };
      // The tail becomes one bar rather than a run of hairlines, and still opens to its inks.
      const head = all.slice(0, BARS);
      const tail = all.slice(BARS);
      head.push({
        name: `Other groups (${tail.length})`,
        qty: tail.reduce((t, g) => t + g.qty, 0),
        items: tail.flatMap((g) => g.items).sort((a, b) => b.qty - a.qty),
      });
      return { name, qty, groups: head };
    });
    // The planner's own category order, so panels do not reshuffle as quantities move.
    out.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
    return { panels: out, uncategorised: { qty: noCategoryQty, count: noCategoryCount } };
  }, [rows]);

  const total =
    panels.reduce((t, p) => t + p.qty, 0) + uncategorised.qty;

  if (!panels.length && !uncategorised.count) {
    return (
      <div className="rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground">
        <strong className="text-foreground">Nothing to order.</strong> Every line shown is at or
        above its month max level, or has no lead time set — which is what gives a line a target
        to fall short of.
      </div>
    );
  }

  const shown = panels
    .find((p) => p.name === open?.category)
    ?.groups.find((g) => g.name === open?.group);

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
        <span className="text-sm font-semibold">To order</span>
        <span className="text-sm tabular-nums">
          {fmtQty(total)} <span className="text-xs text-muted-foreground">{unit}</span>
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          Target less stock and supply arranged. Click a bar for its inks.
        </span>
      </div>

      <div className="grid gap-3 px-3 pb-3 [grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))]">
        {panels.map((p) => {
          const max = p.groups[0]?.qty ?? 0;
          return (
            <div key={p.name} className="rounded-md border p-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-xs font-semibold">{p.name}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{fmtQty(p.qty)}</span>
              </div>
              <div className="mt-1.5 space-y-[2px]">
                {p.groups.map((g) => {
                  const isOpen = open?.category === p.name && open?.group === g.name;
                  return (
                    <button
                      key={g.name}
                      type="button"
                      aria-expanded={isOpen}
                      title={`${g.name}: ${fmtQty(g.qty)} ${unit} across ${g.items.length} ink${
                        g.items.length === 1 ? "" : "s"
                      }`}
                      onClick={() =>
                        setOpen(isOpen ? null : { category: p.name, group: g.name })
                      }
                      className={`flex w-full items-center gap-2 rounded px-1 py-[3px] text-left ${
                        isOpen ? "bg-primary/10" : "hover:bg-muted/60"
                      }`}
                    >
                      <span className="w-20 shrink-0 truncate text-[10px] text-muted-foreground">
                        {g.name}
                      </span>
                      <span className="relative h-3 flex-1">
                        <span
                          className="absolute left-0 top-0 h-3 rounded-r"
                          style={{
                            width: `${max ? Math.max((g.qty / max) * 100, 1.5) : 0}%`,
                            backgroundColor: BAR_COLOR,
                          }}
                        />
                      </span>
                      <span className="w-14 shrink-0 text-right text-[10px] tabular-nums">
                        {fmtQty(g.qty)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {uncategorised.count > 0 && (
        <p className="px-3 pb-2 text-xs text-muted-foreground">
          {uncategorised.count} ink{uncategorised.count === 1 ? "" : "s"} with no category are not
          shown here, worth <strong>{fmtQty(uncategorised.qty)}</strong> {unit}. Give them a
          category in the item master to bring them in.
        </p>
      )}

      {shown && (
        <div className="overflow-x-auto border-t px-3 py-2">
          <div className="flex items-baseline justify-between gap-2 pb-1">
            <span className="text-xs font-semibold">
              {open?.category} › {shown.name} — {shown.items.length} ink
              {shown.items.length === 1 ? "" : "s"}, {fmtQty(shown.qty)} {unit}
            </span>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setOpen(null)}
            >
              close
            </button>
          </div>
          <table className="w-full min-w-[36rem] text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1 text-left font-normal">Ink</th>
                <th className="py-1 text-right font-normal">Stock</th>
                <th className="py-1 text-right font-normal">On the way</th>
                <th className="py-1 text-right font-normal">Month max</th>
                <th className="py-1 text-right font-normal">Days cover</th>
                <th className="py-1 text-right font-semibold text-foreground">To order</th>
              </tr>
            </thead>
            <tbody>
              {shown.items.map((it) => (
                <tr key={it.key} className="border-t">
                  <td className="py-1 pr-3">{it.label}</td>
                  <td className="py-1 text-right tabular-nums">{fmtQty(it.stock)}</td>
                  <td className="py-1 text-right tabular-nums">{fmtQty(it.incoming)}</td>
                  <td className="py-1 text-right tabular-nums">{fmtQty(it.target)}</td>
                  <td className="py-1 text-right tabular-nums">{fmtDays(it.daysCover)}</td>
                  <td className="py-1 text-right font-semibold tabular-nums">{fmtQty(it.qty)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t">
                <td className="py-1 font-medium">
                  {shown.items.length} ink{shown.items.length === 1 ? "" : "s"}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {fmtQty(shown.items.reduce((t, i) => t + i.stock, 0))}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {fmtQty(shown.items.reduce((t, i) => t + i.incoming, 0))}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {fmtQty(shown.items.reduce((t, i) => t + i.target, 0))}
                </td>
                {/* Days of cover is a rate, not a quantity: summing it would be nonsense. */}
                <td className="py-1 text-right text-muted-foreground">–</td>
                <td className="py-1 text-right font-semibold tabular-nums">{fmtQty(shown.qty)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
