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
 * ─── THE FORM: BUCKETS, NOT BARS ─────────────────────────────────────────────────────────
 *
 * This was a bar chart by group. It read well but stood nearly 400px tall on a screen whose
 * job is the table underneath, and the planner asked for the height back. Six or seven figures
 * compared at a glance do not need a plot: a row of small totals says the same thing in one
 * line, and the comparison that matters — which bucket is biggest — survives fine in numbers.
 *
 * The buckets are CATEGORIES (Reactive, Sublimation, Pigment, Disperse, Chemical, Others),
 * which is how the planner buys. Groups still appear, but inside an opened bucket, where they
 * organise the list rather than setting the shape of the screen.
 *
 * Opening one shows its inks with the working, not just the answer: stock, what is on the way,
 * the target and the shortfall those produce. A bare shortfall cannot be argued with — it does
 * not say whether the number is large because stock is low or because the target is high.
 *
 * It follows the table: whatever is filtered, or whichever company tab is open, is what is
 * counted. Two different answers on one screen would be worse than none.
 */
import { useMemo, useState } from "react";
import { INK_CATEGORIES, fmtDays, fmtQty, type InkRow } from "../lib/inkMis";

const UNSET = "Not set";

export function reorderQty(r: InkRow): number {
  if (r.monthMaxLevel <= 0) return 0;
  return Math.max(0, r.monthMaxLevel - (r.stock + r.incoming + r.plant));
}

interface BucketItem {
  key: string;
  label: string;
  group: string;
  stock: number;
  incoming: number;
  target: number;
  qty: number;
  daysCover: number | null;
}

interface Bucket {
  name: string;
  qty: number;
  items: BucketItem[];
}

export default function ReorderChart({ rows, unit = "KGS" }: { rows: InkRow[]; unit?: string }) {
  const [open, setOpen] = useState<string | null>(null);

  const buckets = useMemo<Bucket[]>(() => {
    const by = new Map<string, Bucket>();
    for (const r of rows) {
      const qty = reorderQty(r);
      if (qty <= 0) continue;
      const name = r.category?.trim() || UNSET;
      const b = by.get(name) ?? { name, qty: 0, items: [] };
      b.qty += qty;
      b.items.push({
        key: r.key,
        // The description, never the code: the planner reads these lines by name.
        label: r.description || r.itemCode,
        group: r.group,
        stock: r.stock,
        incoming: r.incoming + r.plant,
        target: r.monthMaxLevel,
        qty,
        daysCover: r.daysCover,
      });
      by.set(name, b);
    }
    // The planner's own category order, so the buckets do not reshuffle as quantities move.
    // Anything uncategorised sits last, where it reads as work still to do.
    const order = [...INK_CATEGORIES, UNSET];
    const out = [...by.values()].sort(
      (a, b) => order.indexOf(a.name) - order.indexOf(b.name),
    );
    out.forEach((b) => b.items.sort((x, y) => y.qty - x.qty));
    return out;
  }, [rows]);

  const total = buckets.reduce((t, b) => t + b.qty, 0);

  if (!buckets.length) {
    return (
      <div className="rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground">
        <strong className="text-foreground">Nothing to order.</strong> Every line shown is at or
        above its month max level, or has no lead time set — which is what gives a line a target
        to fall short of.
      </div>
    );
  }

  const shown = buckets.find((b) => b.name === open);

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <span className="text-sm font-semibold">To order</span>
        <span className="text-sm tabular-nums">
          {fmtQty(total)} <span className="text-xs text-muted-foreground">{unit}</span>
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          Target less stock and supply arranged. Click a bucket for its inks.
        </span>
      </div>

      <div className="flex flex-wrap gap-2 px-3 pb-3">
        {buckets.map((b) => {
          const isOpen = b.name === open;
          return (
            <button
              key={b.name}
              type="button"
              onClick={() => setOpen(isOpen ? null : b.name)}
              aria-expanded={isOpen}
              title={`${b.items.length} ink${b.items.length === 1 ? "" : "s"} to order`}
              className={`rounded-md border px-3 py-1.5 text-left transition-colors ${
                isOpen ? "border-primary bg-primary/10" : "hover:bg-muted/60"
              }`}
            >
              <div className="text-[11px] text-muted-foreground">
                {isOpen ? "▾" : "▸"} {b.name}
              </div>
              <div className="text-sm font-semibold tabular-nums">{fmtQty(b.qty)}</div>
            </button>
          );
        })}
      </div>

      {shown && (
        <div className="overflow-x-auto border-t px-3 py-2">
          <table className="w-full min-w-[40rem] text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1 text-left font-normal">Ink</th>
                <th className="py-1 text-left font-normal">Group</th>
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
                  <td className="py-1 pr-3 text-muted-foreground">{it.group}</td>
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
                <td className="py-1 font-medium" colSpan={2}>
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
