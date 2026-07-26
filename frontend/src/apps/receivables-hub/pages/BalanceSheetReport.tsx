/**
 * Balance Sheet, per company, from the ConnectWave (Tally) mirror.
 *
 * Numbers come from Tally's own Trial Balance; the mirror's ledger rollup sits alongside as the
 * reconcile counterpart (toggle "Show reconcile"). See lib/financialStatements.ts for why both are
 * carried and for the two adjustments Tally itself makes (closing stock into Current Assets, and the
 * P&L A/c ledger already containing the period result).
 *
 * AS-OF DATE. Our ledger column is each ledger's full closing balance, which includes future-dated
 * (post-dated) vouchers; Tally's report is "as of" a date and excludes them, so the two disagree by
 * exactly the out-of-window entries. A Balance Sheet is a single instant, so it takes ONE "As of" date
 * (defaults to the snapshot's as-of); our column drops vouchers dated after it — see adjustRootsAsOf /
 * fetchOutOfWindow. The Tally column is a fixed snapshot and cannot be re-sliced, so the comparison is
 * exact at "As of" = the sync date; earlier dates move our side only.
 *
 * Page chrome (company filter, reconcile toggle, export, the per-company card) lives in
 * components/TallyReportFrame, shared with the P&L and every future Tally report.
 */
import { useMemo, useState } from "react";
import { AlertTriangle, Scale } from "lucide-react";
import { Badge } from "@hub/components/ui/badge";
import { StatementColumn, fmtAmount } from "@hub/components/StatementTree";
import TallyReportFrame, { TallyBand, companyLabel } from "@hub/components/TallyReportFrame";
import { useFinancialStatements, useAsOfAdjustment } from "@hub/lib/useFinancialStatements";
import { buildBalanceSheet, findings, makeGapExplainer, adjustRootsAsOf, type FsNode } from "@hub/lib/financialStatements";
import { exportBalanceSheetXlsx } from "@hub/lib/exportFinancialStatements";
import { formatDateDMY } from "@hub/lib/utils";

export default function BalanceSheetReport() {
  const { companies, linesByCompany, loading, error } = useFinancialStatements();

  // A Balance Sheet is as-of a single date. Default = latest snapshot as-of; empty state = the default.
  const defTo = useMemo(() => companies.map((c) => c.asOf).sort().slice(-1)[0] ?? "", [companies]);
  const [toIso, setToIso] = useState("");
  const effTo = toIso || defTo;

  const oowCompanies = useMemo(
    () => companies.map((c) => ({ companyGuid: c.companyGuid, fromDate: c.fromDate })),
    [companies],
  );
  // From is internal = the FY-start floor (never a user control on a BS — a cumulative balance has no
  // "from"). Passing floor as `from` means only vouchers dated AFTER the As-of date get removed.
  const { adjByCompany } = useAsOfAdjustment(oowCompanies, null, effTo || null);

  const adjustedByGuid = useMemo(() => {
    const m: Record<string, FsNode[]> = {};
    for (const c of companies) {
      m[c.companyGuid] = adjustRootsAsOf(linesByCompany[c.companyGuid] ?? [], adjByCompany[c.companyGuid] ?? {});
    }
    return m;
  }, [companies, linesByCompany, adjByCompany]);
  const rootsOf = (guid: string) => adjustedByGuid[guid] ?? [];

  const dateInput = "h-8 rounded-input border border-border bg-surface px-2 text-xs text-foreground";

  return (
    <TallyReportFrame
      title="Balance Sheet"
      icon={Scale}
      subtitle="What the business owns and owes, straight from Tally. Click any line to open it up."
      companies={companies}
      loading={loading}
      error={error}
      periodLabel={() => `as on ${formatDateDMY(effTo)}`}
      filters={
        <div
          className="flex flex-wrap items-center gap-2"
          title="Our column drops vouchers dated after the As-of date, to match Tally's 'as of' report. The Tally column is a fixed snapshot as of its sync — it lines up exactly when As-of is the sync date."
        >
          <label className="text-xs font-medium text-muted-foreground">As of</label>
          <input type="date" value={effTo} onChange={(e) => setToIso(e.target.value)} className={dateInput} />
        </div>
      }
      reconcile={{
        items: (shown) =>
          shown.flatMap((c) => findings(rootsOf(c.companyGuid), companyLabel(c), "Balance Sheet")),
      }}
      onExport={(shown, showReconcile) =>
        exportBalanceSheetXlsx(
          shown.map((c) => ({ company: c, view: buildBalanceSheet(rootsOf(c.companyGuid), c) })),
          showReconcile,
        )
      }
      companyBadge={(c) => {
        const { difference } = buildBalanceSheet(rootsOf(c.companyGuid), c);
        return Math.abs(difference) < 0.5 ? (
          <Badge variant="outline" className="text-emerald-700 border-emerald-300 bg-emerald-50">
            Balanced
          </Badge>
        ) : (
          <Badge variant="outline" className="text-destructive border-destructive/40 bg-destructive/5 gap-1">
            <AlertTriangle className="h-3 w-3" /> Out by {fmtAmount(Math.abs(difference))}
          </Badge>
        );
      }}
    >
      {(c, showReconcile) => {
        const roots = rootsOf(c.companyGuid);
        const view = buildBalanceSheet(roots, c);
        const isExplained = makeGapExplainer(roots);
        return (
          <TallyBand
            left={
              <StatementColumn
                title="Liabilities"
                rows={view.liabilities.rows}
                total={view.liabilities.total}
                totalOurs={view.liabilities.totalOurs}
                showReconcile={showReconcile}
                isExplained={isExplained}
              />
            }
            right={
              <StatementColumn
                title="Assets"
                rows={view.assets.rows}
                total={view.assets.total}
                totalOurs={view.assets.totalOurs}
                showReconcile={showReconcile}
                isExplained={isExplained}
              />
            }
          />
        );
      }}
    </TallyReportFrame>
  );
}
