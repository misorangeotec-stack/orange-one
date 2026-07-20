/**
 * Balance Sheet, per company, from the ConnectWave (Tally) mirror.
 *
 * Numbers come from Tally's own Trial Balance; the mirror's ledger rollup sits alongside as the
 * reconcile counterpart (toggle "Show reconcile"). See lib/financialStatements.ts for why both are
 * carried and for the two adjustments Tally itself makes (closing stock into Current Assets, and the
 * P&L A/c ledger already containing the period result).
 *
 * There is no FY selector: the mirror stores ONE statement per company, as of its last sync. Offering a
 * date picker the data cannot honour would be a lie, so the as-of date is displayed instead. The route
 * is listed in FY_PINNED_ROUTES so the topbar selector is hidden too.
 *
 * Page chrome (company filter, reconcile toggle, export, the per-company card) lives in
 * components/TallyReportFrame, shared with the P&L and every future Tally report.
 */
import { AlertTriangle, Scale } from "lucide-react";
import { Badge } from "@hub/components/ui/badge";
import { StatementColumn, fmtAmount } from "@hub/components/StatementTree";
import TallyReportFrame, {
  TallyBand,
  asOnPeriod,
  companyLabel,
} from "@hub/components/TallyReportFrame";
import { useFinancialStatements } from "@hub/lib/useFinancialStatements";
import { buildBalanceSheet, findings, makeGapExplainer } from "@hub/lib/financialStatements";
import { exportBalanceSheetXlsx } from "@hub/lib/exportFinancialStatements";

export default function BalanceSheetReport() {
  const { companies, linesByCompany, loading, error } = useFinancialStatements();
  const rootsOf = (guid: string) => linesByCompany[guid] ?? [];

  return (
    <TallyReportFrame
      title="Balance Sheet"
      icon={Scale}
      subtitle="What the business owns and owes, straight from Tally. Click any line to open it up."
      companies={companies}
      loading={loading}
      error={error}
      periodLabel={asOnPeriod}
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
