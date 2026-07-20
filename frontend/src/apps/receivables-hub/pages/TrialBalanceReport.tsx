/**
 * Trial Balance, per company, from the ConnectWave (Tally) mirror.
 *
 * Built from ledger-level balances (v_ledger_detail), not the two-level v_fs_line the Balance Sheet and
 * P&L use — Tally's TB shows a Debit and a Credit on the same group row, which needs the leaf-level
 * Dr/Cr split. See lib/trialBalance.ts for the arithmetic, the four adjustments, and why two of the
 * four books legitimately do not balance.
 *
 * No FY selector: the mirror holds one master snapshot per company, so the route is in FY_PINNED_ROUTES.
 * Page chrome (company filter, reconcile toggle, export, per-company card) is the shared TallyReportFrame.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Calculator } from "lucide-react";
import { Badge } from "@hub/components/ui/badge";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import TallyReportFrame, { companyLabel, rangePeriod } from "@hub/components/TallyReportFrame";
import { TrialBalanceTree } from "@hub/components/TrialBalanceTree";
import { useFinancialStatements } from "@hub/lib/useFinancialStatements";
import {
  buildTrialBalance,
  loadTrialBalanceLedgers,
  tbFindings,
  type TbLedgerRow,
} from "@hub/lib/trialBalance";
import { exportTrialBalanceXlsx } from "@hub/lib/exportFinancialStatements";
import { fmtAmount } from "@hub/components/StatementTree";

export default function TrialBalanceReport() {
  const { companies, linesByCompany, loading, error } = useFinancialStatements();

  // The chart of accounts (companies + v_fs_line roots) comes from the shared cache; the ledger detail
  // is a second fetch, keyed to the set of companies so it refetches only when that set changes.
  const guids = useMemo(() => companies.map((c) => c.companyGuid).sort(), [companies]);
  const {
    data: ledgersByCompany,
    isLoading: ledgersLoading,
    error: ledgersError,
  } = useQuery<Record<string, TbLedgerRow[]>>({
    queryKey: ["trialBalanceLedgers", "v1", guids],
    queryFn: () => loadTrialBalanceLedgers(guids),
    enabled: guids.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const ledgersOf = (guid: string) => ledgersByCompany?.[guid] ?? [];
  const rootsOf = (guid: string) => linesByCompany[guid] ?? [];
  const viewOf = (c: (typeof companies)[number]) =>
    buildTrialBalance(ledgersOf(c.companyGuid), rootsOf(c.companyGuid), c);

  const busy = loading || ledgersLoading;
  const err = error ?? (ledgersError instanceof Error ? ledgersError.message : null);

  return (
    <TallyReportFrame
      title="Trial Balance"
      icon={Calculator}
      subtitle="Every group's Debit and Credit, straight from Tally. Click any line to open it up."
      companies={companies}
      loading={busy}
      error={err}
      periodLabel={rangePeriod}
      reconcile={{
        items: (shown) => shown.flatMap((c) => tbFindings(viewOf(c), companyLabel(c))),
      }}
      onExport={(shown, showReconcile) =>
        exportTrialBalanceXlsx(
          shown.map((c) => ({ company: c, view: viewOf(c) })),
          showReconcile,
        )
      }
      companyBadge={(c) => {
        const { difference } = viewOf(c);
        return Math.abs(difference) < 0.5 ? (
          <Badge variant="outline" className="text-emerald-700 border-emerald-300 bg-emerald-50">
            Balanced
          </Badge>
        ) : (
          <Badge variant="outline" className="text-destructive border-destructive/40 bg-destructive/5">
            Out by {fmtAmount(Math.abs(difference))}
          </Badge>
        );
      }}
    >
      {(c, showReconcile) => (
        <div className="p-3">
          <ScrollableTable className="rounded-lg border border-border" maxHeight="max-h-[70vh]">
            <TrialBalanceTree view={viewOf(c)} showReconcile={showReconcile} />
          </ScrollableTable>
        </div>
      )}
    </TallyReportFrame>
  );
}
