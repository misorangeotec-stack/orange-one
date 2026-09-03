/**
 * exportDebtorAnalysisXlsx.ts — the Debtor Analysis Dashboard as a workbook.
 *
 * Same contract as the PDF exporter: it takes the finished `DebtorAnalysisReport` and nothing
 * else, so the screen, the document and the spreadsheet are three renderings of one object
 * rather than three implementations of one calculation.
 *
 * ── Numbers, not formatted strings ────────────────────────────────────────────────────────
 * Where the screen and the PDF print "111.00 L", this writes `111` as a NUMBER. The whole point
 * of the workbook is that finance re-cuts the figures themselves, and a column of strings sorts
 * lexically, will not sum, and turns every cell into a parsing job. The unit is stated in the
 * header instead — every money column on the Quarterly and Monthly sheets is in LAKHS, and the
 * KPI sheet carries the underlying rupee figure, which is what a reader tying back to Tally
 * actually needs.
 *
 * `exportSheetsToXlsx` adds an "About this export" sheet on its own, carrying the filters and
 * notes passed below — so the caveats travel with the file rather than being left on the screen
 * the sender was looking at.
 */
import { exportSheetsToXlsx } from "@/shared/lib/exportXlsx";
import { GRAND_TOTAL_STYLE, TOTAL_STYLE } from "@hub/lib/xlsxStyle";
import { formatDateDMY } from "@hub/lib/utils";
import type {
  DebtorAnalysisReport, DebtorChip, DebtorMonthRow, DebtorQuarterRow,
} from "@hub/lib/debtorAnalysis";

/** Two decimals, and a real zero rather than a hyphen — this is a number column. */
const n2 = (v: number | null | undefined): number => Math.round((v ?? 0) * 100) / 100;

/** Avg Coll Days is genuinely absent for a bucket with no matched receipts. An empty cell says
 *  so; a 0 would read as "collected the same day", which is the opposite of the truth. */
const days = (v: number | null | undefined): string | number => (v === null || v === undefined ? "" : v);

type KpiRow = DebtorChip & { band: string };

export async function exportDebtorAnalysisXlsx(report: DebtorAnalysisReport): Promise<void> {
  const name = report.title.split(" — ")[0];

  const kpiRows: KpiRow[] = [
    ...report.bands.accountStatus.map((c) => ({ ...c, band: "Account Status" })),
    ...report.bands.periodSummary.map((c) => ({ ...c, band: "Period Summary" })),
  ];

  const quarterRows: (DebtorQuarterRow & { _total?: boolean })[] = [
    ...report.quarters,
    ...(report.quartersTotal ? [{ ...report.quartersTotal, _total: true }] : []),
  ];

  const monthRows: (DebtorMonthRow & { _total?: boolean })[] = [
    ...report.months,
    { ...report.monthsSummary, _total: true },
  ];

  await exportSheetsToXlsx({
    fileName: `Debtor Analysis - ${name}`,
    title: report.title,
    filters: [
      `Period: ${report.periodLabel}`,
      `As on: ${report.asOfDate ? formatDateDMY(report.asOfDate) : "—"}`,
      report.subline,
    ],
    notes: [
      "Money columns on the Quarterly and Monthly sheets are in LAKHS. The KPIs sheet carries the underlying rupee figure.",
      "Quarterly flows are the sum of their months; Avg O/S and Avg OD are the average of month-end closing balances.",
      "Cheque Returns counts bounced cheques (CHQ.R) AND money paid back out to the customer on vouchers Tally did not name CHQ.R. 'of which Payments Out' is the second part — a subset of the Cheque Returns column, not an addition to it.",
      "Avg Coll Days is computed independently over each bucket's own date range — a quarter's figure is NOT the average of its months. A blank means no receipt in that period could be matched to a dated bill.",
      "On the Monthly sheet the SUMMARY TOTAL row sums the flows but carries the LAST month's Outstanding and Overdue, which are a closing position and not a total.",
      "The quarterly TOTAL excludes the partial current month; the monthly SUMMARY TOTAL includes it. Both are correct.",
      `Reconciliation: opening ${n2(report.reconciliation.openingBalance)} L plus net movement ${n2(report.reconciliation.netMovement)} L gives ${n2(report.reconciliation.expectedClosing)} L against a closing balance of ${n2(report.reconciliation.actualClosing)} L.`,
      // ⚠ `report.note.lines` — the action note ("we would require a minimum of X", "dispatches
      // on advance payment terms") is DELIBERATELY NOT WRITTEN. It is a recommendation, and a
      // workbook gets forwarded and re-cut outside the team; the figures travel, the internal
      // credit position does not. It stays on screen.
      ...report.caveats,
    ],
    sheets: [
      {
        sheetName: "KPIs",
        columns: [
          { header: "Band",  width: 18, value: (r: KpiRow) => r.band },
          { header: "Measure", width: 26, value: (r: KpiRow) => r.label },
          { header: "Shown",   width: 16, value: (r: KpiRow) => r.value },
          { header: "Value (₹ / % / days)", width: 22, value: (r: KpiRow) => (r.unavailable ? "" : r.raw) },
          { header: "Note",  width: 20, value: (r: KpiRow) => r.sub ?? "" },
        ],
        rows: kpiRows,
      },
      {
        sheetName: "Quarterly",
        columns: [
          { header: "Quarter",             width: 22, value: (r: DebtorQuarterRow) => r.label },
          { header: "Period",              width: 14, value: (r: DebtorQuarterRow) => r.span },
          { header: "Sales (L)",           width: 13, value: (r: DebtorQuarterRow) => n2(r.sales) },
          { header: "Receipts (L)",        width: 13, value: (r: DebtorQuarterRow) => n2(r.receipts) },
          { header: "Cr Notes (L)",        width: 13, value: (r: DebtorQuarterRow) => n2(r.creditNotes) },
          { header: "Dr Notes (L)",        width: 13, value: (r: DebtorQuarterRow) => n2(r.debitNotes) },
          { header: "Chq Returns (L)",     width: 15, value: (r: DebtorQuarterRow) => n2(r.chequeReturns) },
          { header: "Avg O/S (L)",         width: 13, value: (r: DebtorQuarterRow) => n2(r.avgOutstanding) },
          { header: "Avg OD (L)",          width: 13, value: (r: DebtorQuarterRow) => n2(r.avgOverdue) },
          { header: "Avg Coll Days",       width: 14, value: (r: DebtorQuarterRow) => days(r.avgCollDays) },
        ],
        rows: quarterRows,
        rowStyle: (r: DebtorQuarterRow & { _total?: boolean }) => (r._total ? GRAND_TOTAL_STYLE : undefined),
        freezeCols: 1,
      },
      {
        sheetName: "Monthly",
        columns: [
          { header: "Month",           width: 12, value: (r: DebtorMonthRow) => r.month },
          { header: "Sales (L)",       width: 13, value: (r: DebtorMonthRow) => n2(r.sales) },
          { header: "Receipts (L)",    width: 13, value: (r: DebtorMonthRow) => n2(r.receipts) },
          { header: "Cr Notes (L)",    width: 13, value: (r: DebtorMonthRow) => n2(r.creditNotes) },
          { header: "Dr Notes (L)",    width: 13, value: (r: DebtorMonthRow) => n2(r.debitNotes) },
          { header: "Chq Returns (L)", width: 15, value: (r: DebtorMonthRow) => n2(r.chequeReturns) },
          { header: "Journal Net (L)", width: 15, value: (r: DebtorMonthRow) => n2(r.journalNet) },
          { header: "of which Payments Out (L)", width: 24, value: (r: DebtorMonthRow) => n2(r.paymentsOut) },
          { header: "Movement (L)",    width: 14, value: (r: DebtorMonthRow) => n2(r.movement) },
          { header: "Outstanding (L)", width: 15, value: (r: DebtorMonthRow) => n2(r.outstanding) },
          { header: "Overdue (L)",     width: 13, value: (r: DebtorMonthRow) => n2(r.overdue) },
          { header: "Avg Coll Days",   width: 14, value: (r: DebtorMonthRow) => days(r.avgCollDays) },
          {
            header: "Note", width: 22,
            value: (r: DebtorMonthRow) =>
              r.imputed ? "No activity reported" : r.partial ? "Month not yet complete" : "",
          },
        ],
        rows: monthRows,
        rowStyle: (r: DebtorMonthRow & { _total?: boolean }) =>
          r._total ? GRAND_TOTAL_STYLE : r.partial ? TOTAL_STYLE : undefined,
        freezeCols: 1,
      },
    ],
  });
}
