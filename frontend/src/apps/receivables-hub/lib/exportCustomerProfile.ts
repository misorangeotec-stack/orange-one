/**
 * exportCustomerProfile.ts — the Excel export for Reports → Insights → Customer Profile.
 *
 * House rules this follows (same as exportCustomerCategory.ts):
 *  1. WYSIWYG with the screen — the same buckets, the same bands, the same sort order.
 *  2. Money is written as NUMBERS with an INR `z` format, never as pre-formatted strings, so the
 *     workbook stays sortable and summable.
 *  3. A percentage is never summed.
 *
 * Note this is the FIRST ConnectWave-backed master report to carry an export button — the others
 * (Sales / Receivables / Payables / Income / Expense / Sales Gain / the dashboards / Stock
 * Analysis) have none. It deliberately follows the established receivables export convention
 * rather than inventing a new one.
 */
import * as XLSX from "xlsx-js-style";
import { saveAs } from "file-saver";

import { HEADER_STYLE, GRAND_TOTAL_STYLE, styleRow } from "./xlsxStyle";
import {
  bandTotals, dmy, journeys, segmentOf,
  type CustomerProfileData, type CustomerRow, type SegmentConfig,
} from "./customerProfile";

const INR_FMT = '₹#,##,##0.00;[Red]-₹#,##,##0.00';
const PCT_FMT = '0.00"%"';

export interface CustomerProfileExportMeta {
  company: string;
  fy: string;
  asAt: string | null;
  inactiveDays: number;
}

const num = (v: number, z = INR_FMT) => ({ v: Number(v) || 0, t: "n" as const, z });
const txt = (v: string | null | undefined) => ({ v: v ?? "", t: "s" as const });

function sheetFromAoa(aoa: unknown[][], widths: number[], headerRow0: number, freezeCols = 1) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = widths.map((w) => ({ wch: w }));
  ws["!freeze"] = { xSplit: freezeCols, ySplit: headerRow0 + 1 };
  return ws;
}

/* --------------------------------------------------------------- sheets */

function buildSummary(data: CustomerProfileData, cfg: SegmentConfig, meta: CustomerProfileExportMeta) {
  const k = data.kpi;
  const bands = bandTotals(data.customers, cfg);

  const aoa: unknown[][] = [
    ["Customer Profile"],
    ["Company", meta.company],
    ["Financial Year", `FY ${meta.fy}`],
    ["Figures as at", meta.asAt ? dmy(meta.asAt) : ""],
    ["Prior year", `FY ${data.meta.prior_fy}`],
    ["Book begins", data.meta.book_from ? `FY ${data.meta.book_from}` : ""],
    [],
    ["Segment", "Customers", "Pending Receivable", "Total Sales"],
    ["New Customers", k.new_count, num(k.new_recv), num(k.new_sales)],
    ["Existing Customers", k.existing_count, num(k.existing_recv), num(k.existing_sales)],
    ["Non Active Customers (current year)", k.nonactive_count, num(k.nonactive_recv), num(k.nonactive_sales)],
    ["Old Customers", k.old_count, num(k.old_recv), ""],
    [],
    ["Band", "Customers", "Total Sales", "Rule"],
    ["Small", bands.Small.count, num(bands.Small.total), `0% – ${cfg.small_max_pct}% of total sales`],
    ["Medium", bands.Medium.count, num(bands.Medium.total), `${cfg.small_max_pct}% – ${cfg.medium_max_pct}%`],
    ["Large", bands.Large.count, num(bands.Large.total), `above ${cfg.medium_max_pct}%`],
  ];

  const ws = sheetFromAoa(aoa, [38, 14, 20, 20, 42], 7, 1);
  styleRow(ws, 7, 4, HEADER_STYLE);
  styleRow(ws, 13, 4, HEADER_STYLE);
  return ws;
}

function buildCustomers(rows: CustomerRow[], cfg: SegmentConfig) {
  const header = [
    "Name", "Sales Person", "Lifecycle", "Segment", "Last Invoice", "Days Since Invoice",
    "Invoices", "Total Sales", "Average Sales", "Prior Year Sales",
    "Share of Year %", "Pending Receivables", "Overdue",
  ];
  const aoa: unknown[][] = [header];

  let sales = 0;
  let recv = 0;
  for (const r of rows) {
    sales += Number(r.cy_sales) || 0;
    recv += Number(r.receivable) || 0;
    aoa.push([
      txt(r.name),
      txt(r.salesperson),
      txt(r.lifecycle),
      txt(segmentOf(r.cy_share, cfg) ?? ""),
      txt(dmy(r.last_invoice)),
      r.days_since ?? "",
      r.invoices,
      num(r.cy_sales),
      num(r.avg_sales),
      num(r.py_sales),
      num(r.cy_share, PCT_FMT),
      num(r.receivable),
      num(r.overdue),
    ]);
  }
  // Share % is deliberately NOT totalled — a sum of percentages is not a percentage.
  aoa.push(["Total", "", "", "", "", "", "", num(sales), "", "", "", num(recv), ""]);

  const ws = sheetFromAoa(aoa, [42, 20, 14, 12, 15, 19, 11, 18, 18, 18, 16, 20, 16], 0, 1);
  styleRow(ws, 0, header.length, HEADER_STYLE);
  styleRow(ws, aoa.length - 1, header.length, GRAND_TOTAL_STYLE);
  return ws;
}

function buildJourney(data: CustomerProfileData, cfg: SegmentConfig) {
  const j = journeys(data.customers, cfg);
  const header = ["Direction", "Name", "Segment", "Prior Year Sales"];
  const aoa: unknown[][] = [header];
  for (const r of j.positive) aoa.push(["Positive", txt(r.name), txt(r.segment), num(r.weight)]);
  for (const r of j.negative) aoa.push(["Negative", txt(r.name), txt(r.segment), num(r.weight)]);
  if (aoa.length === 1) aoa.push(["", "No Data Found.", "", ""]);

  const ws = sheetFromAoa(aoa, [12, 42, 22, 20], 0, 2);
  styleRow(ws, 0, header.length, HEADER_STYLE);
  return ws;
}

function buildInactive(data: CustomerProfileData, days: number) {
  const header = [
    "Name", "Sales Person", "Last Invoice", "Days Since", "This Year", "Prior Year",
    "Pending Receivables", "Overdue",
  ];
  const aoa: unknown[][] = [
    [`Customers with no invoice in ${days} days`],
    header,
  ];
  for (const r of data.inactive) {
    aoa.push([
      txt(r.name), txt(r.salesperson), txt(dmy(r.last_invoice)), r.days_since ?? "",
      num(r.cy_sales), num(r.py_sales), num(r.receivable), num(r.overdue),
    ]);
  }
  const ws = sheetFromAoa(aoa, [42, 20, 15, 13, 18, 18, 20, 16], 1, 1);
  styleRow(ws, 1, header.length, HEADER_STYLE);
  return ws;
}

/** "About this export" — what the numbers mean and where they deliberately differ. */
function buildAbout(data: CustomerProfileData, cfg: SegmentConfig, meta: CustomerProfileExportMeta) {
  const aoa: unknown[][] = [
    ["About this export"],
    [],
    ["Report", "Customer Profile (Insights)"],
    ["Company", meta.company],
    ["Financial Year", `FY ${meta.fy}`],
    ["Figures as at", meta.asAt ? dmy(meta.asAt) : ""],
    ["Generated", new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })],
    ["Customers in file", data.customers.length],
    ["Segment bands", `Small ≤ ${cfg.small_max_pct}%, Medium ≤ ${cfg.medium_max_pct}%, Large above`],
    [],
    ["What these numbers mean"],
    ["Existing", "Sold to this year AND present last year."],
    ["New", "In this year's roster but not Existing. It is a residual, so a customer with prior-year invoices whose year nets negative appears here."],
    ["Non Active", "Present last year, absent this year. Its Total Sales is the PRIOR year."],
    ["Old", "Absent from both years. Needs a third year in the book to ever be non-zero."],
    ["Average Sales", "Total Sales divided by SALES invoices only — credit notes and returns count in the money but not the divisor."],
    ["Segment", "Share of this year's POSITIVE sales. A customer whose year nets to zero or below is left unbanded rather than counted as Small."],
    ["Pending Receivables", "The customer's open receivable from the Tally books."],
    [],
    ["Deliberate differences from Talligence"],
    ["Pending Receivable", "Talligence prints ₹23.77 Cr for Existing Customers, which exceeds this company's entire debtor book; their own customer table agrees with these figures to the rupee, so the Tally-true number ships."],
    ["Non Active count", "Ours counts each customer once. Talligence lists a pre-rename ledger as an extra row while excluding its money from its own total."],
    ["Sales Person", "Filled from the customer muster. Talligence leaves it blank because Tally has no salesperson dimension."],
  ];
  const ws = sheetFromAoa(aoa, [22, 110], 0, 1);
  return ws;
}

/* ---------------------------------------------------------------- export */

export function exportCustomerProfileXlsx(
  data: CustomerProfileData,
  cfg: SegmentConfig,
  meta: CustomerProfileExportMeta,
): void {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildSummary(data, cfg, meta), "Segmental Statistics");
  XLSX.utils.book_append_sheet(wb, buildCustomers(data.customers, cfg), "Customers");
  XLSX.utils.book_append_sheet(wb, buildJourney(data, cfg), "Journey");
  XLSX.utils.book_append_sheet(wb, buildInactive(data, meta.inactiveDays), "Gone Quiet");
  XLSX.utils.book_append_sheet(wb, buildAbout(data, cfg, meta), "About this export");

  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const stamp = (meta.asAt ?? "").replace(/[^0-9]/g, "") || "current";
  saveAs(
    new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `Customer-Profile_${meta.fy}_${stamp}.xlsx`,
  );
}
