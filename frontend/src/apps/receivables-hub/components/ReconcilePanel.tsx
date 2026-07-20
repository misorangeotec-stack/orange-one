/**
 * Reconcile summary: the lines where Tally's own figure disagrees with the ledgers we mirror.
 *
 * This is the point of carrying both numbers. A bulk Ledger collection under-reports forex and
 * bill-wise ledgers, so vouchers can be missing from our side — measured at Rs 2.04 cr of sales on the
 * import-heavy book. Findings usually appear in PAIRS that offset (a Sundry Debtors gap against a
 * matching Sales gap): that signature means specific invoices, not a systematic drift.
 *
 * Lines that differ BY DESIGN (Current Assets, Profit & Loss A/c) are filtered out upstream in
 * `findings()` — listing them here would bury the real ones.
 */
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { fmtAmount } from "@hub/components/StatementTree";
import type { FsFinding } from "@hub/lib/financialStatements";

export function ReconcilePanel({ items }: { items: FsFinding[] }) {
  if (items.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        <span className="font-medium">Nothing unexplained.</span>
        <span className="text-emerald-700/90">
          Any gap still shown in the statement is marked <span className="font-semibold">ok</span> — it is a
          provisional bill Tally carries but has not posted to a ledger (goods delivered but not yet invoiced,
          or received but not yet billed), or stock and period profit, which sit on one side only.
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2.5 border-b border-border bg-muted/30">
        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
        <span className="text-sm font-semibold text-foreground">
          {items.length} line{items.length === 1 ? "" : "s"} on this statement disagree with Tally
        </span>
        <span className="text-xs text-muted-foreground">
          — an indented account sits inside the group shown above it; expand that group to find it.
          Gaps that offset each other point at the same missing vouchers.
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/20">
              <th className="text-left py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Company</th>
              <th className="text-left py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Account</th>
              <th className="text-right py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">Tally</th>
              <th className="text-right py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">Our ledgers</th>
              <th className="text-right py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">Gap</th>
            </tr>
          </thead>
          <tbody>
            {items.map((f, i) => (
              <tr key={`${f.company}-${f.name}-${i}`} className="border-b border-border/40">
                <td className="py-2 px-3 text-sm text-muted-foreground">{f.company}</td>
                <td className="py-2 px-3 text-sm text-foreground">
                  {f.path.length > 0 && (
                    <span className="text-muted-foreground">{f.path.join(" › ")} › </span>
                  )}
                  <span className="font-medium">{f.name}</span>
                </td>
                <td className="py-2 px-3 text-right text-sm tabular-nums whitespace-nowrap">{fmtAmount(f.tally)}</td>
                <td className="py-2 px-3 text-right text-sm tabular-nums whitespace-nowrap text-muted-foreground">{fmtAmount(f.ours)}</td>
                <td className="py-2 px-3 text-right text-sm tabular-nums whitespace-nowrap font-medium text-destructive">
                  {fmtAmount(f.gap)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
