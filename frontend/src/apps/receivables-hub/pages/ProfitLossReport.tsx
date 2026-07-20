/**
 * Profit & Loss, per company, from the ConnectWave (Tally) mirror.
 *
 * Laid out the way Tally prints it: a trading account (Opening Stock / Purchases / Direct Expenses vs
 * Sales / Direct Incomes / Closing Stock, ending in Gross Profit c/o), then the profit & loss account
 * (Indirect Expenses / Nett Profit vs Gross Profit b/f + Indirect Incomes).
 *
 * See lib/financialStatements.ts for the arithmetic and why Tally's figure and the mirror's ledger
 * rollup are both carried.
 *
 * FROM / TO DATE. Our ledger column is each ledger's full closing balance, which includes future-dated
 * (post-dated) vouchers; Tally's own report is "as of" a date and excludes them. So the two disagree by
 * exactly the out-of-window entries. The date window (To defaults to the snapshot's as-of date) trims
 * our column to match — see adjustRootsAsOf / fetchOutOfWindow. The Tally column is a fixed snapshot and
 * cannot be re-sliced, so the comparison is exact at To = the as-of date; other dates move our side only.
 *
 * Page chrome (company filter, reconcile toggle, export, the per-company card) lives in
 * components/TallyReportFrame, shared with the Balance Sheet and every future Tally report.
 */
import { useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";
import { Badge } from "@hub/components/ui/badge";
import { StatementColumn, fmtAmount } from "@hub/components/StatementTree";
import TallyReportFrame, { TallyBand, companyLabel } from "@hub/components/TallyReportFrame";
import { useFinancialStatements, useAsOfAdjustment } from "@hub/lib/useFinancialStatements";
import { buildPnl, findings, makeGapExplainer, adjustRootsAsOf, type FsNode } from "@hub/lib/financialStatements";
import { exportPnlXlsx } from "@hub/lib/exportFinancialStatements";
import { formatDateDMY } from "@hub/lib/utils";

export default function ProfitLossReport() {
  const { companies, linesByCompany, loading, error } = useFinancialStatements();

  // Window defaults: From = earliest book start, To = latest as-of (the snapshot date). Empty state
  // means "use the default", so the controls need no companies loaded to render.
  const defFrom = useMemo(
    () => companies.map((c) => c.fromDate).sort()[0] ?? "",
    [companies],
  );
  const defTo = useMemo(
    () => companies.map((c) => c.asOf).sort().slice(-1)[0] ?? "",
    [companies],
  );
  const [fromIso, setFromIso] = useState("");
  const [toIso, setToIso] = useState("");
  const effFrom = fromIso || defFrom;
  const effTo = toIso || defTo;

  const oowCompanies = useMemo(
    () => companies.map((c) => ({ companyGuid: c.companyGuid, fromDate: c.fromDate })),
    [companies],
  );
  const { adjByCompany } = useAsOfAdjustment(oowCompanies, effFrom || null, effTo || null);

  // Trim each company's tree to the window once, then read the adjusted `ours`/`gap` everywhere.
  const adjustedByGuid = useMemo(() => {
    const m: Record<string, FsNode[]> = {};
    for (const c of companies) {
      m[c.companyGuid] = adjustRootsAsOf(linesByCompany[c.companyGuid] ?? [], adjByCompany[c.companyGuid] ?? {});
    }
    return m;
  }, [companies, linesByCompany, adjByCompany]);
  const rootsOf = (guid: string) => adjustedByGuid[guid] ?? [];

  const dateInput =
    "h-8 rounded-input border border-border bg-surface px-2 text-xs text-foreground";

  return (
    <TallyReportFrame
      title="Profit & Loss"
      icon={TrendingUp}
      subtitle="Trading and profit & loss account, straight from Tally. Click any line to open it up."
      companies={companies}
      loading={loading}
      error={error}
      periodLabel={() => `${formatDateDMY(effFrom)} to ${formatDateDMY(effTo)}`}
      filters={
        <div
          className="flex flex-wrap items-center gap-2"
          title="Our column drops vouchers dated after the To date, to match Tally's 'as of' report. The Tally column is a fixed snapshot as of its sync — it lines up exactly when To is the sync date."
        >
          <label className="text-xs font-medium text-muted-foreground">From</label>
          <input type="date" value={effFrom} onChange={(e) => setFromIso(e.target.value)} className={dateInput} />
          <label className="text-xs font-medium text-muted-foreground">To</label>
          <input type="date" value={effTo} onChange={(e) => setToIso(e.target.value)} className={dateInput} />
        </div>
      }
      reconcile={{
        items: (shown) =>
          shown.flatMap((c) => findings(rootsOf(c.companyGuid), companyLabel(c), "Profit & Loss")),
      }}
      onExport={(shown, showReconcile) =>
        exportPnlXlsx(
          shown.map((c) => ({ company: c, view: buildPnl(rootsOf(c.companyGuid), c) })),
          showReconcile,
        )
      }
      companyBadge={(c) => {
        const { nettProfit } = buildPnl(rootsOf(c.companyGuid), c);
        const profit = nettProfit >= 0;
        return (
          <Badge
            variant="outline"
            className={
              profit
                ? "text-emerald-700 border-emerald-300 bg-emerald-50"
                : "text-destructive border-destructive/40 bg-destructive/5"
            }
          >
            {profit ? "Nett Profit" : "Nett Loss"} {fmtAmount(Math.abs(nettProfit))}
          </Badge>
        );
      }}
    >
      {(c, showReconcile) => {
        const roots = rootsOf(c.companyGuid);
        const v = buildPnl(roots, c);
        const isExplained = makeGapExplainer(roots);
        return (
          <>
            {/* Trading account */}
            <TallyBand
              left={
                <StatementColumn
                  title="Particulars"
                  rows={v.left.rows}
                  total={v.left.total}
                  totalOurs={v.left.totalOurs}
                  showReconcile={showReconcile}
                  isExplained={isExplained}
                  footRows={
                    v.grossProfit >= 0
                      ? [{ label: "Gross Profit c/o", amount: v.grossProfit, ours: v.grossProfitOurs }]
                      : undefined
                  }
                />
              }
              right={
                <StatementColumn
                  title="Particulars"
                  rows={v.right.rows}
                  total={v.right.total}
                  totalOurs={v.right.totalOurs}
                  showReconcile={showReconcile}
                  isExplained={isExplained}
                  footRows={
                    v.grossProfit < 0
                      ? [{ label: "Gross Loss c/o", amount: -v.grossProfit, ours: -v.grossProfitOurs }]
                      : undefined
                  }
                />
              }
            />
            {/* Profit & loss account */}
            <TallyBand
              topBorder
              left={
                <StatementColumn
                  title="Particulars"
                  rows={v.left2.rows}
                  total={v.left2.total}
                  totalOurs={v.left2.totalOurs}
                  showReconcile={showReconcile}
                  isExplained={isExplained}
                  footRows={
                    v.nettProfit >= 0
                      ? [{ label: "Nett Profit", amount: v.nettProfit, ours: v.nettProfitOurs }]
                      : undefined
                  }
                />
              }
              right={
                <StatementColumn
                  title="Particulars"
                  rows={v.right2.rows}
                  total={v.right2.total}
                  totalOurs={v.right2.totalOurs}
                  showReconcile={showReconcile}
                  isExplained={isExplained}
                  footRows={[
                    ...(v.grossProfit >= 0
                      ? [{ label: "Gross Profit b/f", amount: v.grossProfit, ours: v.grossProfitOurs }]
                      : []),
                    ...(v.nettProfit < 0
                      ? [{ label: "Nett Loss", amount: -v.nettProfit, ours: -v.nettProfitOurs }]
                      : []),
                  ]}
                />
              }
            />
          </>
        );
      }}
    </TallyReportFrame>
  );
}
