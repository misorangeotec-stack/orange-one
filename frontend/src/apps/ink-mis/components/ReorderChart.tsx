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
 * TWO LEVELS, THEN THE ITEMS. Categories first (Reactive, Sublimation, Pigment, Disperse,
 * Chemical, Others), because that is how the ink is bought. Opening one shows a bucket per GROUP
 * inside it — H-Series, Eco, KY Reactive — each with its own quantity, because "Reactive needs
 * 46,793" is not an order anybody can place. Opening a group finally lists its inks.
 *
 * Each step answers the question the one before it raises, and nothing below the level in view
 * is drawn, so the whole thing stays one or two lines tall until the planner asks for more.
 *
 * The item list shows the working, not just the answer: stock, what is on the way, the target
 * and the shortfall those produce. A bare shortfall cannot be argued with — it does not say
 * whether the number is large because stock is low or because the target is high.
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

interface Group {
  name: string;
  qty: number;
  items: BucketItem[];
}

interface Bucket {
  name: string;
  qty: number;
  groups: Group[];
}

export default function ReorderChart({ rows, unit = "KGS" }: { rows: InkRow[]; unit?: string }) {
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const buckets = useMemo<Bucket[]>(() => {
    const by = new Map<string, Map<string, Group>>();
    const totals = new Map<string, number>();
    for (const r of rows) {
      const qty = reorderQty(r);
      if (qty <= 0) continue;
      const category = r.category?.trim() || UNSET;
      const groupName = r.group?.trim() || UNSET;
      const groups = by.get(category) ?? new Map<string, Group>();
      const g = groups.get(groupName) ?? { name: groupName, qty: 0, items: [] };
      g.qty += qty;
      totals.set(category, (totals.get(category) ?? 0) + qty);
      g.items.push({
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
      groups.set(groupName, g);
      by.set(category, groups);
    }
    // The planner's own category order, so the buckets do not reshuffle as quantities move.
    // Anything uncategorised sits last, where it reads as work still to do.
    const order = [...INK_CATEGORIES, UNSET];
    const out: Bucket[] = [...by.entries()].map(([name, groups]) => ({
      name,
      qty: totals.get(name) ?? 0,
      // Groups by size: inside a category the biggest shortfall is the one to deal with first.
      groups: [...groups.values()]
        .sort((a, b) => b.qty - a.qty)
        .map((g) => ({ ...g, items: [...g.items].sort((x, y) => y.qty - x.qty) })),
    }));
    out.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
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

  const shownCategory = buckets.find((b) => b.name === openCategory);
  const shownGroup = shownCategory?.groups.find((g) => g.name === openGroup);

  /** A bucket at either level: the same small box, so the drill reads as one control. */
  const bucketButton = (
    name: string,
    qty: number,
    isOpen: boolean,
    onClick: () => void,
    hint: string,
  ) => (
    <button
      key={name}
      type="button"
      onClick={onClick}
      aria-expanded={isOpen}
      title={hint}
      className={`rounded-md border px-3 py-1.5 text-left transition-colors ${
        isOpen ? "border-primary bg-primary/10" : "hover:bg-muted/60"
      }`}
    >
      <div className="text-[11px] text-muted-foreground">
        {isOpen ? "▾" : "▸"} {name}
      </div>
      <div className="text-sm font-semibold tabular-nums">{fmtQty(qty)}</div>
    </button>
  );

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
        {buckets.map((b) =>
          bucketButton(
            b.name,
            b.qty,
            b.name === openCategory,
            () => {
              setOpenCategory(b.name === openCategory ? null : b.name);
              setOpenGroup(null);
            },
            `${b.groups.length} group${b.groups.length === 1 ? "" : "s"} to order`,
          ),
        )}
      </div>

      {shownCategory && (
        <div className="flex flex-wrap items-center gap-2 border-t bg-muted/30 px-3 py-2">
          <span className="text-xs text-muted-foreground">{shownCategory.name} by group</span>
          {shownCategory.groups.map((g) =>
            bucketButton(
              g.name,
              g.qty,
              g.name === openGroup,
              () => setOpenGroup(g.name === openGroup ? null : g.name),
              `${g.items.length} ink${g.items.length === 1 ? "" : "s"} to order`,
            ),
          )}
        </div>
      )}

      {shownGroup && (
        <div className="overflow-x-auto border-t px-3 py-2">
          <table className="w-full min-w-[40rem] text-xs">
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
              {shownGroup.items.map((it) => (
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
                  {shownGroup.items.length} ink{shownGroup.items.length === 1 ? "" : "s"}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {fmtQty(shownGroup.items.reduce((t, i) => t + i.stock, 0))}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {fmtQty(shownGroup.items.reduce((t, i) => t + i.incoming, 0))}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {fmtQty(shownGroup.items.reduce((t, i) => t + i.target, 0))}
                </td>
                {/* Days of cover is a rate, not a quantity: summing it would be nonsense. */}
                <td className="py-1 text-right text-muted-foreground">–</td>
                <td className="py-1 text-right font-semibold tabular-nums">{fmtQty(shownGroup.qty)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
