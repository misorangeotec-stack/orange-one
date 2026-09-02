/**
 * exportDebtorAnalysisPdf.ts — the Debtor Analysis Dashboard as a branded A4 PDF.
 *
 * ── Why it takes the finished report and nothing else ─────────────────────────────────────
 * The single argument is the same `DebtorAnalysisReport` the screen renders. Not the customer,
 * not the trend, not the vouchers — the finished object, with every figure already formatted by
 * debtorAnalysis.ts. So there is no second implementation of the arithmetic and no second
 * formatter, and the document a reader forwards cannot quietly disagree with the screen the
 * sender was looking at. Anything this file computes for itself is a bug waiting to happen.
 *
 * ── Vector, not a screenshot ──────────────────────────────────────────────────────────────
 * Built on shared/lib/pdfBrand, so the text is real text: selectable, searchable, sharp at any
 * zoom, and a tenth the file size. The hub's other customer export (exportCustomer.ts) renders
 * its PDF by html2canvas-ing the DOM, which produces an image of a report; pdfBrand's own header
 * names that as the thing not to copy.
 *
 * ── Layout ────────────────────────────────────────────────────────────────────────────────
 * One page at the source artefact's sixteen months, with room to spare — but the window grows a
 * row per month, so both tables are given an explicit `maxY` and an `onNewPage`, and the note
 * block is height-checked BEFORE it is drawn (jsPDF cannot undo a draw).
 */
import { jsPDF } from "jspdf";
import {
  BRAND, CONTENT_W, MARGIN, MINI_CARD_H,
  type Ctx, type PdfColumn, type RowKind,
  drawTable, footer, gradientRect, headerBand, loadBrandAssets, metaStrip, miniCard,
  pageWash, registerBrandFonts, sectionHeading, text,
} from "@/shared/lib/pdfBrand";
import { formatDateDMY } from "@hub/lib/utils";
import {
  fmtLakhsCell, fmtCollDays,
  type DebtorAnalysisReport, type DebtorMonthRow, type DebtorQuarterRow,
} from "@hub/lib/debtorAnalysis";

/** Bottom limit before a table breaks. Leaves room for the footer. */
const MAX_Y = 841.89 - 52;

const TITLE_BAR_H = 24;
const CARD_GAP = 4;

type QRow = DebtorQuarterRow & { _kind: RowKind };
type MRow = DebtorMonthRow & { _kind: RowKind };

/** A filename a file system will accept, on any of the three platforms this runs on. */
const safeFileName = (s: string): string =>
  s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

const quarterCells: PdfColumn<QRow>[] = [
  {
    header: "Quarter", width: 2.6, align: "left",
    // The artefact stacks "Q1 FY25" over "(Apr-Jun 25)". drawTable is single-line by contract
    // — one pdf.text per cell at a fixed row height — so the two are joined on one line in a
    // wider column rather than adding a ninth column to a table that already has eight.
    value: (r) => (r.span ? `${r.label} · ${r.span}` : r.label),
  },
  { header: "Sales",         width: 1,   align: "right", value: (r) => fmtLakhsCell(r.sales) },
  { header: "Receipts",      width: 1,   align: "right", value: (r) => fmtLakhsCell(r.receipts) },
  { header: "Cr Notes",      width: 1,   align: "right", value: (r) => fmtLakhsCell(r.creditNotes) },
  {
    header: "Chq Returns", width: 1.15, align: "right",
    value: (r) => fmtLakhsCell(r.chequeReturns),
    color: (r) => (r.chequeReturns > 0 ? BRAND.red : undefined),
  },
  { header: "Avg O/S",       width: 1,   align: "right", value: (r) => fmtLakhsCell(r.avgOutstanding) },
  {
    header: "Avg OD", width: 1, align: "right",
    value: (r) => fmtLakhsCell(r.avgOverdue),
    color: (r) => ((r.avgOverdue ?? 0) > 0 ? BRAND.red : undefined),
  },
  { header: "Avg Coll Days", width: 1.25, align: "right", value: (r) => fmtCollDays(r.avgCollDays) },
];

const monthCells: PdfColumn<MRow>[] = [
  { header: "Month",       width: 1.45, align: "left",  value: (r) => r.month },
  { header: "Sales",       width: 1,    align: "right", value: (r) => fmtLakhsCell(r.sales) },
  { header: "Receipts",    width: 1,    align: "right", value: (r) => fmtLakhsCell(r.receipts) },
  { header: "Cr Notes",    width: 1,    align: "right", value: (r) => fmtLakhsCell(r.creditNotes) },
  { header: "Dr Notes",    width: 1,    align: "right", value: (r) => fmtLakhsCell(r.debitNotes) },
  {
    header: "Chq Returns", width: 1.15, align: "right",
    value: (r) => fmtLakhsCell(r.chequeReturns),
    color: (r) => (r.chequeReturns > 0 ? BRAND.red : undefined),
  },
  { header: "Outstanding", width: 1.15, align: "right", value: (r) => fmtLakhsCell(r.outstanding) },
  {
    header: "Overdue", width: 1, align: "right",
    value: (r) => fmtLakhsCell(r.overdue),
    color: (r) => (r.overdue > 0 ? BRAND.red : undefined),
  },
  { header: "Avg Coll Days", width: 1.25, align: "right", value: (r) => fmtCollDays(r.avgCollDays) },
];

export async function exportDebtorAnalysisPdf(report: DebtorAnalysisReport): Promise<void> {
  const assets = await loadBrandAssets();
  const pdf = new jsPDF({ orientation: "p", unit: "pt", format: "a4", compress: true });
  registerBrandFonts(pdf, assets);

  const TP = "{tp}";
  const ctx: Ctx = { pdf, assets, totalPagesToken: TP };
  const generatedAt = new Date().toLocaleString("en-IN");

  const startPage = (): number => {
    pageWash(pdf);
    return headerBand(ctx, {
      compact: true,
      tag: "DEBTOR ANALYSIS",
      note: report.asOfDate ? `AS OF ${formatDateDMY(report.asOfDate)}` : undefined,
    });
  };

  let y = startPage();

  // ── Title bar ────────────────────────────────────────────────────────────────────────────
  y += 14;
  gradientRect(pdf, MARGIN, y, CONTENT_W, TITLE_BAR_H, BRAND.navy, BRAND.navy2);
  text(pdf, report.title, MARGIN + CONTENT_W / 2, y + 16, {
    size: 12, bold: true, color: BRAND.white, align: "center", maxWidth: CONTENT_W - 20,
  });
  y += TITLE_BAR_H + 12;

  text(pdf, report.subline, MARGIN + CONTENT_W / 2, y, {
    size: 7, color: BRAND.grey, align: "center", maxWidth: CONTENT_W,
  });
  y += 14;

  // ── Terms of reference ───────────────────────────────────────────────────────────────────
  // metaStrip GROWS when any cell carries a note, so its return value is the y to continue at.
  // Assuming META_STRIP_H would overlap the next band the first time a note appears.
  y = metaStrip(pdf, MARGIN, y, CONTENT_W, [
    { label: "As on", value: report.asOfDate ? formatDateDMY(report.asOfDate) : "—" },
    { label: "Period", value: report.periodLabel },
    { label: "Unit", value: "₹ Lakhs" },
    {
      label: "Closing",
      value: fmtLakhsCell(report.reconciliation.actualClosing),
      note: report.reconciliation.ok ? "reconciles to the ledger" : "see the note below",
    },
  ]) + 14;

  // ── The two chip bands ───────────────────────────────────────────────────────────────────
  const drawBand = (heading: string, chips: DebtorAnalysisReport["bands"]["accountStatus"]) => {
    y = sectionHeading(pdf, MARGIN, y, heading) + 4;
    const n = Math.max(chips.length, 1);
    const w = (CONTENT_W - CARD_GAP * (n - 1)) / n;
    chips.forEach((c, i) => {
      miniCard(pdf, MARGIN + i * (w + CARD_GAP), y, w, {
        label: c.label, value: c.value, sub: c.sub, alarm: c.alarm,
      });
    });
    y += MINI_CARD_H + 14;
  };
  drawBand(`Account Status (as at ${report.asOfMonth || "—"})`, report.bands.accountStatus);
  drawBand(`Period Summary (${report.periodLabel})`, report.bands.periodSummary);

  // ── Quarterly ────────────────────────────────────────────────────────────────────────────
  if (report.quarters.length > 0) {
    y = sectionHeading(pdf, MARGIN, y, "Quarterly Summary") + 4;
    const rows: QRow[] = [
      ...report.quarters.map((q) => ({ ...q, _kind: (q.partial ? "muted" : "normal") as RowKind })),
      ...(report.quartersTotal ? [{ ...report.quartersTotal, _kind: "total" as RowKind }] : []),
    ];
    y = drawTable<QRow>(pdf, {
      x: MARGIN, y, width: CONTENT_W,
      columns: quarterCells, rows,
      rowKind: (r) => r._kind,
      rowH: 15, bodySize: 7.2, headerSize: 6.6,
      maxY: MAX_Y,
      onNewPage: () => { pdf.addPage(); return startPage() + 14; },
    }) + 14;
  }

  // ── Monthly ──────────────────────────────────────────────────────────────────────────────
  y = sectionHeading(pdf, MARGIN, y, "Monthly Analysis") + 4;
  const monthRows: MRow[] = [
    ...report.months.map((m) => ({ ...m, _kind: (m.partial ? "big" : "normal") as RowKind })),
    { ...report.monthsSummary, _kind: "grand" as RowKind },
  ];
  // Return value deliberately unused — nothing is drawn after this table (see below).
  drawTable<MRow>(pdf, {
    x: MARGIN, y, width: CONTENT_W,
    columns: monthCells, rows: monthRows,
    rowKind: (r) => r._kind,
    rowH: 13, bodySize: 7, headerSize: 6.6,
    maxY: MAX_Y,
    onNewPage: () => { pdf.addPage(); return startPage() + 14; },
  });

  // ── No commentary block ──────────────────────────────────────────────────────────────────
  // NOTHING is printed after the monthly table, and that is a deliberate instruction, not an
  // omission. Two things were dropped, in this order:
  //   1. `report.note.lines` — the action note ("we would require a minimum of X", "dispatches
  //      on advance payment terms"). A recommendation, and this file gets forwarded outside the
  //      team; the figures travel, the internal credit position does not.
  //   2. The reconciliation line and `report.caveats`. Asked for on 02-Sep-2026: the panel ran
  //      to a whole second page of prose under a one-page report.
  //
  // ⚠ THE CAVEATS ARE REAL AND THEY ARE NOW INVISIBLE HERE. A reader of the PDF alone cannot
  // tell that historical Overdue is unpopulated for most months, or that a month did not roll
  // forward. Both still show ON SCREEN and on the workbook's "About this export" sheet, so the
  // information is not lost — but if a figure in this PDF is ever queried, check the screen
  // before defending it. Do not quietly re-add a block here; it was removed on purpose.

  // ── Footers ──────────────────────────────────────────────────────────────────────────────
  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    footer(ctx, p, generatedAt, report.periodLabel);
  }
  pdf.putTotalPages(TP);

  const stamp = report.asOfDate ? formatDateDMY(report.asOfDate).replace(/-/g, "") : "";
  pdf.save(safeFileName(`Debtor Analysis - ${report.title.split(" — ")[0]}${stamp ? ` - ${stamp}` : ""}`) + ".pdf");
}
