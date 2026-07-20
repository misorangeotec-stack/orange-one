/**
 * Profit & Loss, per company, from the ConnectWave (Tally) mirror.
 *
 * Laid out the way Tally prints it: a trading account (Opening Stock / Purchases / Direct Expenses vs
 * Sales / Direct Incomes / Closing Stock, ending in Gross Profit c/o), then the profit & loss account
 * (Indirect Expenses / Nett Profit vs Gross Profit b/f + Indirect Incomes).
 *
 * See lib/financialStatements.ts for the arithmetic and why Tally's figure and the mirror's ledger
 * rollup are both carried. No FY selector — one statement per company, as of its last sync.
 *
 * Page chrome (company filter, reconcile toggle, export, the per-company card) lives in
 * components/TallyReportFrame, shared with the Balance Sheet and every future Tally report.
 */
import { TrendingUp } from "lucide-react";
import { Badge } from "@hub/components/ui/badge";
import { StatementColumn, fmtAmount } from "@hub/components/StatementTree";
import TallyReportFrame, {
  TallyBand,
  companyLabel,
  rangePeriod,
} from "@hub/components/TallyReportFrame";
import { useFinancialStatements } from "@hub/lib/useFinancialStatements";
import { buildPnl, findings, makeGapExplainer } from "@hub/lib/financialStatements";
import { exportPnlXlsx } from "@hub/lib/exportFinancialStatements";

export default function ProfitLossReport() {
  const { companies, linesByCompany, loading, error } = useFinancialStatements();
  const rootsOf = (guid: string) => linesByCompany[guid] ?? [];

  return (
    <TallyReportFrame
      title="Profit & Loss"
      icon={TrendingUp}
      subtitle="Trading and profit & loss account, straight from Tally. Click any line to open it up."
      companies={companies}
      loading={loading}
      error={error}
      periodLabel={rangePeriod}
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
