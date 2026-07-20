import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Download, type LucideIcon } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { MultiSelect } from "@hub/components/MultiSelect";
import { ReconcilePanel } from "@hub/components/ReconcilePanel";
import type { FsCompany, FsFinding } from "@hub/lib/financialStatements";
import { formatDateDMY } from "@hub/lib/utils";

/**
 * Shared chrome for every Tally-mirror report.
 *
 * The Balance Sheet and P&L pages each hand-rolled ~70 near-identical lines of this —
 * the back-link, the company filter, the reconcile toggle, the export button, the
 * loading/error/empty triple, and the per-company card with its header strip. One frame
 * now owns all of it so a third Tally report is a body, not another copy.
 *
 * It deliberately does NOT call useFinancialStatements(). That hook reads v_fs_line /
 * v_fs_company specifically; baking it in would make the frame useless for Trial Balance,
 * Ledger Voucher, Bill-wise Outstanding and Sales Register, which read entirely different
 * views. Data comes in as props — the frame is dumb on purpose.
 *
 * The statement body itself is components/StatementTree, which is the actual Tally-look
 * engine (Particulars left, amount right, Dr side beside Cr side, drill-down collapsed by
 * default). This is the chrome around it.
 */

/**
 * The least a company has to be for the frame to label and filter it. `FsCompany`
 * satisfies it; a future report reading some other view can supply its own shape.
 */
export interface TallyCompanyLike {
  companyGuid: string;
  company: string;
  location: string;
  rawName: string;
}

export interface TallyReportFrameProps<C extends TallyCompanyLike> {
  title: string;
  icon: LucideIcon;
  subtitle: string;
  companies: C[];
  loading: boolean;
  error: string | null;
  /** Omit to drop the reconcile toggle — a report with no ledger rollup to compare against. */
  reconcile?: { items: (shown: C[]) => FsFinding[] };
  onExport?: (shown: C[], showReconcile: boolean) => void;
  /** The date band under the company name, e.g. "as on 31-03-2026". */
  periodLabel: (c: C) => string;
  /** Right-hand badge on a company's header strip (Balanced / Nett Profit / …). */
  companyBadge?: (c: C) => React.ReactNode;
  /** Extra controls in the Filters strip, beside the company picker. */
  filters?: React.ReactNode;
  emptyMessage?: string;
  children: (company: C, showReconcile: boolean) => React.ReactNode;
}

/** "COMPANY — LOCATION", or just the company when it has no location. */
export function companyLabel(c: TallyCompanyLike): string {
  return c.location ? `${c.company} — ${c.location}` : c.company;
}

/** Balance-sheet style band: a single instant. */
export const asOnPeriod = (c: FsCompany): string => `as on ${formatDateDMY(c.asOf)}`;

/** P&L style band: a period. */
export const rangePeriod = (c: FsCompany): string =>
  `${formatDateDMY(c.fromDate)} to ${formatDateDMY(c.asOf)}`;

/**
 * One Dr-beside-Cr row of the statement. The Balance Sheet uses a single band
 * (Liabilities | Assets); the P&L stacks two (trading account, then P&L account).
 */
export function TallyBand({
  left,
  right,
  topBorder,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
  topBorder?: boolean;
}) {
  return (
    <div className={`flex flex-col lg:flex-row gap-px bg-border ${topBorder ? "border-t border-border" : ""}`}>
      <div className="flex-1 bg-surface p-3">{left}</div>
      <div className="flex-1 bg-surface p-3">{right}</div>
    </div>
  );
}

export default function TallyReportFrame<C extends TallyCompanyLike>({
  title,
  icon: Icon,
  subtitle,
  companies,
  loading,
  error,
  reconcile,
  onExport,
  periodLabel,
  companyBadge,
  filters,
  emptyMessage = "No company has a statement yet. A company must be open in Tally when the connector syncs.",
  children,
}: TallyReportFrameProps<C>) {
  const [picked, setPicked] = useState<string[]>([]);
  const [showReconcile, setShowReconcile] = useState(false);

  const options = useMemo(() => companies.map(companyLabel), [companies]);
  const shown = useMemo(
    () => (picked.length === 0 ? companies : companies.filter((c) => picked.includes(companyLabel(c)))),
    [companies, picked],
  );

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <Link
            to="/outstanding-dashboard/reports?cat=tally"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1"
          >
            <ArrowLeft className="h-3 w-3" /> Tally Reports
          </Link>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Icon className="h-6 w-6 text-primary" /> {title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {reconcile && (
            <Button
              variant={showReconcile ? "default" : "outline"}
              onClick={() => setShowReconcile((s) => !s)}
              className="h-9 gap-1.5 rounded-button"
            >
              {showReconcile ? "Hide reconcile" : "Show reconcile"}
            </Button>
          )}
          {onExport && (
            <Button
              onClick={() => onExport(shown, showReconcile)}
              className="h-9 gap-1.5 rounded-button bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Download className="h-4 w-4" /> Export
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/60">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-2">Filters</span>
        <div className="pt-2">
          <MultiSelect
            options={options}
            value={picked}
            onChange={setPicked}
            allLabel="All Companies"
            noun="companies"
            triggerClassName="h-8 w-56 text-xs rounded-input"
          />
        </div>
        {filters && <div className="pt-2">{filters}</div>}
      </div>

      {reconcile && showReconcile && !loading && !error && shown.length > 0 && (
        <ReconcilePanel items={reconcile.items(shown)} />
      )}

      {loading ? (
        <div className="py-16 text-center text-muted-foreground">Loading…</div>
      ) : error ? (
        <div className="py-16 text-center text-destructive">{error}</div>
      ) : shown.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground">{emptyMessage}</div>
      ) : (
        shown.map((c) => (
          <div key={c.companyGuid} className="rounded-lg border border-border bg-surface overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-border bg-muted/30">
              <div>
                <div className="font-semibold text-foreground">{companyLabel(c)}</div>
                <div className="text-xs text-muted-foreground">
                  {c.rawName} · {periodLabel(c)}
                </div>
              </div>
              {companyBadge?.(c)}
            </div>
            {children(c, showReconcile)}
          </div>
        ))
      )}
    </div>
  );
}
