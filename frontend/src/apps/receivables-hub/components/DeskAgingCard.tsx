import { type CSSProperties } from "react";
import { Clock } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@hub/components/ui/card";
import { formatDateDMY } from "@hub/lib/utils";
import type { Customer, CustomerDetail } from "@hub/lib/types";

/**
 * The Aging Breakdown card of the customer page (pages/CustomerDetail.tsx), run across EVERY ledger
 * the Collection Desk is showing — same two lenses, same buckets, same colours, same rules:
 *
 *   Overdue Aging   — days past the DUE date: the ledger's own `agingBuckets` (invoice-level, the
 *                     opening balance excluded), summed.
 *   Bill Date Aging — days since the INVOICE date: every open bill (due or not) invoiced in the hub's
 *                     FY period, as Tally's Pending Bills — `billDateKeyOf` is a copy of the customer
 *                     page's, so one customer reads the same here as on its own page.
 *
 * Clicking a bucket narrows the whole desk (totals and list) to the customers with money in it.
 */

export type AgingBasis = "overdue" | "billDate";

export const AGING_BUCKETS = [
  { label: "0–30 days",    key: "0_30",     color: "hsl(142, 71%, 45%)" },
  { label: "31–60 days",   key: "31_60",    color: "hsl(82, 70%, 42%)"  },
  { label: "61–90 days",   key: "61_90",    color: "hsl(47, 96%, 48%)"  },
  { label: "91–120 days",  key: "91_120",   color: "hsl(30, 90%, 52%)"  },
  { label: "121–180 days", key: "121_180",  color: "hsl(20, 90%, 50%)"  },
  { label: "180+ days",    key: "180_plus", color: "hsl(var(--destructive))" },
] as const;
const CREDIT_COLOR = "hsl(152, 60%, 36%)";

const FY_RANGES: Record<string, [string, string]> = {
  fy2526: ["2025-04-01", "2026-03-31"],
  fy2627: ["2026-04-01", "2027-03-31"],
};

/** The bill-date period: one FY selected = that FY; both (the default) = no lower bound. */
export function billPeriodOf(selectedFYs: string[], asOfDate: string): { from: string; to: string } {
  const p = selectedFYs.length === 1 ? FY_RANGES[selectedFYs[0]] ?? null : null;
  return { from: p?.[0] ?? "", to: p && p[1] < asOfDate ? p[1] : asOfDate };
}

const daysBetween = (from: string, to: string): number =>
  Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000);

function billDateKeyOf(billDate: string | undefined, pending: number, period: { from: string; to: string }, asOfDate: string): string | null {
  if (Math.abs(pending) < 0.5 || !billDate || !asOfDate) return null;
  if ((period.from && billDate < period.from) || billDate > period.to) return null;
  const age = daysBetween(billDate, asOfDate);
  if (age <= 30)  return "0_30";
  if (age <= 60)  return "31_60";
  if (age <= 90)  return "61_90";
  if (age <= 120) return "91_120";
  if (age <= 180) return "121_180";
  return "180_plus";
}

/** One ledger's money per bucket under a lens. */
export function ledgerAging(
  c: Customer, detail: CustomerDetail | undefined, basis: AgingBasis,
  period: { from: string; to: string }, asOfDate: string,
): { buckets: Record<string, number>; bills: number } {
  if (basis === "overdue") {
    return { buckets: { ...(c.agingBuckets as unknown as Record<string, number>) }, bills: 0 };
  }
  const buckets: Record<string, number> = {};
  let bills = 0;
  for (const inv of detail?.invoices ?? []) {
    const k = billDateKeyOf(inv.date, inv.pending, period, asOfDate);
    if (!k) continue;
    buckets[k] = (buckets[k] ?? 0) + inv.pending;
    bills += 1;
  }
  return { buckets, bills };
}

export function DeskAgingCard({
  ledgers, customerDetail, asOfDate, period, basis, onBasis, selected, onToggle, onClear, fmt, fmtAxis,
}: {
  ledgers: Customer[];
  customerDetail: Record<string, CustomerDetail>;
  asOfDate: string;
  period: { from: string; to: string };
  basis: AgingBasis;
  onBasis: (b: AgingBasis) => void;
  selected: Set<string>;
  onToggle: (key: string) => void;
  onClear: () => void;
  fmt: (n: number) => string;
  fmtAxis: (n: number) => string;
}) {
  const sums: Record<string, number> = {};
  let bills = 0;
  for (const c of ledgers) {
    const a = ledgerAging(c, customerDetail[c.id], basis, period, asOfDate);
    for (const [k, v] of Object.entries(a.buckets)) sums[k] = (sums[k] ?? 0) + (v ?? 0);
    bills += a.bills;
  }
  const byBillDate = basis === "billDate";
  const data = AGING_BUCKETS.map(({ label, key, color }) => {
    const amount = sums[key] ?? 0;
    return { label, key, color: amount < 0 ? CREDIT_COLOR : color, amount };
  }).filter((d) => (byBillDate ? Math.abs(d.amount) >= 0.5 : d.amount > 0.5));
  const totalGross = data.reduce((s, d) => s + Math.max(0, d.amount), 0);
  const total = data.reduce((s, d) => s + d.amount, 0);
  const periodText = period.from
    ? `${formatDateDMY(period.from)} to ${formatDateDMY(period.to)}`
    : `up to ${formatDateDMY(period.to)}`;

  return (
    <Card className="rounded-card border-border bg-surface">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 min-w-0">
            <Clock className="h-4 w-4 text-destructive shrink-0" />
            {byBillDate ? "Bill Date Aging Breakdown" : "Overdue Aging Breakdown"}
            <span className="text-xs font-normal text-muted-foreground ml-1">
              {byBillDate
                ? <>— all pending bills invoiced {periodText}, aged from the invoice date (as Tally's Pending Bills)</>
                : <>— invoice-level only; opening balance excluded</>}
              {" "}· customers shown below · click a bucket to list only those customers
            </span>
          </CardTitle>
          <div className="flex items-center rounded-full border border-border bg-surface p-0.5 shrink-0">
            {([
              { id: "overdue", label: "Overdue Aging" },
              { id: "billDate", label: "Bill Date Aging" },
            ] as const).map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => onBasis(o.id)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  basis === o.id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {byBillDate ? "No pending bills for the customers shown." : "Nothing is overdue for the customers shown."}
          </p>
        ) : (
          <>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={fmtAxis} width={72} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--surface))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "var(--radius)",
                      fontSize: 12,
                    }}
                    formatter={(v: number) => [fmt(v), byBillDate ? "Pending" : "Overdue"]}
                  />
                  <Bar dataKey="amount" radius={[4, 4, 0, 0]} maxBarSize={72} cursor="pointer"
                    onClick={(entry: { key?: string }) => entry.key && onToggle(entry.key)}>
                    {data.map((d) => (
                      <Cell key={d.key} fill={d.color} opacity={selected.size === 0 || selected.has(d.key) ? 1 : 0.35} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 pt-3 border-t border-border flex flex-col sm:flex-row gap-4">
              <div className="flex-1 space-y-1.5">
                {data.map((d) => {
                  const active = selected.has(d.key);
                  return (
                    <div
                      key={d.key}
                      onClick={() => onToggle(d.key)}
                      className={`flex items-center justify-between gap-3 px-3 py-1.5 rounded-input cursor-pointer transition-colors ${
                        active ? "ring-1 ring-offset-0" : "bg-muted/40 hover:bg-muted/70"
                      }`}
                      style={(active ? { backgroundColor: `${d.color}18` } : {}) as CSSProperties}
                    >
                      <span className="text-xs text-muted-foreground w-24 shrink-0">{d.label}</span>
                      <span className="text-xs font-bold font-mono" style={{ color: d.color }}>{fmt(d.amount)}</span>
                      <span className="text-[10px] text-muted-foreground w-10 text-right shrink-0">
                        {totalGross > 0 && d.amount > 0 ? `${((d.amount / totalGross) * 100).toFixed(1)}%` : "—"}
                      </span>
                    </div>
                  );
                })}
                {selected.size > 0 && (
                  <button type="button" onClick={onClear} className="text-[11px] text-primary hover:underline">
                    Show all buckets
                  </button>
                )}
              </div>
              <div className={`flex items-center justify-center rounded-input px-6 py-3 shrink-0 border ${
                byBillDate ? "bg-primary/10 border-primary/20" : "bg-destructive/10 border-destructive/20"
              }`}>
                <div className="text-center">
                  <p className={`text-[10px] font-medium uppercase tracking-wide ${byBillDate ? "text-primary" : "text-destructive"}`}>
                    {byBillDate ? "Total Pending" : "Total Overdue"}
                  </p>
                  <p className={`text-xl font-bold font-mono mt-1 ${byBillDate ? "text-primary" : "text-destructive"}`}>{fmt(total)}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {byBillDate
                      ? `${bills} bill${bills === 1 ? "" : "s"} invoiced ${periodText}`
                      : "bills only, before On Account"}
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
