import * as XLSX from "xlsx-js-style";
import { saveAs } from "file-saver";
import JSZip from "jszip";
import type { AgingBuckets } from "@hub/lib/types";
import { sumOutstanding } from "@hub/lib/receivables";
import { HEADER_STYLE, TOTAL_STYLE, GRAND_TOTAL_STYLE, styleRow } from "@hub/lib/xlsxStyle";

export type RiskCategory = "critical" | "high" | "medium" | "low";

export interface ExportCustomerRow {
  id: string;
  name: string;
  salesPerson: string;
  salesPersons?: string[];
  company?: string;
  location?: string;
  companies?: string[];
  locations?: string[];
  sales: number;
  receipts: number;
  /** Manual Other Payments — folded into the exported "Collected" column. */
  otherPayments?: number;
  creditNotes: number;
  outstanding: number;
  overdue: number;
  maxOverdueDays: number;
  creditPeriod: number;
  creditLimit: number;
  utilization: number;
  risk: RiskCategory;
  agingBuckets: AgingBuckets;
}

export interface ActiveFiltersSummary {
  search?: string;
  riskLevels?: string[];
  aging?: string;
  customerSegment?: string;
  balance?: string;
  saleTypes?: string[];
}

export interface BuildWorkbookOptions {
  customers: ExportCustomerRow[];
  filters: ActiveFiltersSummary;
  asOfDate: string;
  title: string;
}

const riskOrder: RiskCategory[] = ["critical", "high", "medium", "low"];
const riskLabel: Record<RiskCategory, string> = {
  critical: "Critical", high: "High", medium: "Medium", low: "Low",
};

const INR_FMT = '_-"\u20B9"* #,##0_-;-"\u20B9"* #,##0_-;_-"\u20B9"* "-"_-;_-@_-';
const PCT_FMT = '0.0"%"';

interface PivotSlice { customers: number; outstanding: number; overdue: number; }
interface PivotRow {
  salesperson: string;
  totalCustomers: number;
  totalSales: number;
  totalOutstanding: number;
  totalOverdue: number;
  critical: PivotSlice;
  high: PivotSlice;
  medium: PivotSlice;
  low: PivotSlice;
}

function emptyPivot(sp: string): PivotRow {
  return {
    salesperson: sp,
    totalCustomers: 0, totalSales: 0, totalOutstanding: 0, totalOverdue: 0,
    critical: { customers: 0, outstanding: 0, overdue: 0 },
    high:     { customers: 0, outstanding: 0, overdue: 0 },
    medium:   { customers: 0, outstanding: 0, overdue: 0 },
    low:      { customers: 0, outstanding: 0, overdue: 0 },
  };
}

function buildPivot(customers: ExportCustomerRow[]): PivotRow[] {
  const map = new Map<string, PivotRow>();
  for (const c of customers) {
    const sp = c.salesPerson || "Others";
    const row = map.get(sp) ?? emptyPivot(sp);
    row.totalCustomers   += 1;
    row.totalSales       += c.sales;
    row.totalOutstanding += c.outstanding;
    row.totalOverdue     += c.overdue;
    const slice = row[c.risk];
    slice.customers   += 1;
    slice.outstanding += c.outstanding;
    slice.overdue     += c.overdue;
    map.set(sp, row);
  }
  return [...map.values()].sort((a, b) => b.totalOutstanding - a.totalOutstanding);
}

function filtersToStrings(f: ActiveFiltersSummary): string[][] {
  const rows: string[][] = [];
  rows.push(["Search",           f.search && f.search.trim() ? f.search : "—"]);
  rows.push(["Risk Levels",      f.riskLevels && f.riskLevels.length ? f.riskLevels.map(r => r.charAt(0).toUpperCase() + r.slice(1)).join(", ") : "All"]);
  rows.push(["Aging Bucket",     f.aging && f.aging !== "all" ? f.aging : "All"]);
  rows.push(["Customer Segment", f.customerSegment && f.customerSegment !== "all" ? f.customerSegment : "All"]);
  rows.push(["Balance",          f.balance && f.balance !== "all" ? f.balance : "All"]);
  rows.push(["Sale Types",       f.saleTypes && f.saleTypes.length ? f.saleTypes.join(", ") : "All"]);
  return rows;
}

/** Format a JS Date as DD-MM-YYYY (numeric, dashes). */
function ddmmyyyy(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

function formatDateLong(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return ddmmyyyy(d);
}

function buildSummarySheet(opts: BuildWorkbookOptions): XLSX.WorkSheet {
  const { customers, title, asOfDate } = opts;
  const pivot = buildPivot(customers);

  const totals = {
    salespersons: new Set(customers.map(c => c.salesPerson || "Others")).size,
    customers: customers.length,
    sales: customers.reduce((s, c) => s + c.sales, 0),
    outstanding: sumOutstanding(customers),
    overdue: customers.reduce((s, c) => s + c.overdue, 0),
  };

  const aoa: (string | number)[][] = [];
  aoa.push([title]);
  aoa.push([`As of ${formatDateLong(asOfDate)}`]);
  aoa.push([]);
  aoa.push(["Salespersons", totals.salespersons]);
  aoa.push(["Total Customers", totals.customers]);
  aoa.push(["Total Sales", totals.sales]);
  aoa.push(["Total Outstanding", totals.outstanding]);
  aoa.push(["Total Overdue", totals.overdue]);
  aoa.push([]);

  // Pivot headers (two rows)
  aoa.push([
    "Salesperson",
    "Totals", "", "", "",
    "Critical", "", "",
    "High", "", "",
    "Medium", "", "",
    "Low", "", "",
  ]);
  aoa.push([
    "",
    "Customers", "Sales", "Outstanding", "Overdue",
    "Customers", "Outstanding", "Overdue",
    "Customers", "Outstanding", "Overdue",
    "Customers", "Outstanding", "Overdue",
    "Customers", "Outstanding", "Overdue",
  ]);

  for (const r of pivot) {
    aoa.push([
      r.salesperson,
      r.totalCustomers, r.totalSales, r.totalOutstanding, r.totalOverdue,
      r.critical.customers, r.critical.outstanding, r.critical.overdue,
      r.high.customers,     r.high.outstanding,     r.high.overdue,
      r.medium.customers,   r.medium.outstanding,   r.medium.overdue,
      r.low.customers,      r.low.outstanding,      r.low.overdue,
    ]);
  }

  // Grand total row
  aoa.push([
    "TOTAL",
    pivot.reduce((s, r) => s + r.totalCustomers, 0),
    pivot.reduce((s, r) => s + r.totalSales, 0),
    pivot.reduce((s, r) => s + r.totalOutstanding, 0),
    pivot.reduce((s, r) => s + r.totalOverdue, 0),
    ...riskOrder.flatMap(risk => [
      pivot.reduce((s, r) => s + r[risk].customers, 0),
      pivot.reduce((s, r) => s + r[risk].outstanding, 0),
      pivot.reduce((s, r) => s + r[risk].overdue, 0),
    ]),
  ]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Merges for banner + grouped headers
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 16 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 16 } },
    // Pivot grouped headers (row index 9)
    { s: { r: 9, c: 1 }, e: { r: 9, c: 4 } },   // Totals
    { s: { r: 9, c: 5 }, e: { r: 9, c: 7 } },   // Critical
    { s: { r: 9, c: 8 }, e: { r: 9, c: 10 } },  // High
    { s: { r: 9, c: 11 }, e: { r: 9, c: 13 } }, // Medium
    { s: { r: 9, c: 14 }, e: { r: 9, c: 16 } }, // Low
  ];

  ws["!cols"] = [
    { wch: 30 },
    { wch: 11 }, { wch: 16 }, { wch: 18 }, { wch: 16 },
    { wch: 11 }, { wch: 18 }, { wch: 16 },
    { wch: 11 }, { wch: 18 }, { wch: 16 },
    { wch: 11 }, { wch: 18 }, { wch: 16 },
    { wch: 11 }, { wch: 18 }, { wch: 16 },
  ];

  // Number formats: KPI amount rows (Sales, Outstanding, Overdue) and pivot amount columns
  applyNumberFormat(ws, "B6", INR_FMT); // Total Sales
  applyNumberFormat(ws, "B7", INR_FMT); // Total Outstanding
  applyNumberFormat(ws, "B8", INR_FMT); // Total Overdue

  const firstPivotDataRow = 12; // 1-indexed row number where salesperson rows start (after two header rows)
  const lastPivotDataRow  = firstPivotDataRow + pivot.length; // includes grand total
  for (let row = firstPivotDataRow; row <= lastPivotDataRow; row++) {
    applyNumberFormat(ws, `C${row}`, INR_FMT);
    applyNumberFormat(ws, `D${row}`, INR_FMT);
    applyNumberFormat(ws, `E${row}`, INR_FMT);
    applyNumberFormat(ws, `G${row}`, INR_FMT);
    applyNumberFormat(ws, `H${row}`, INR_FMT);
    applyNumberFormat(ws, `J${row}`, INR_FMT);
    applyNumberFormat(ws, `K${row}`, INR_FMT);
    applyNumberFormat(ws, `M${row}`, INR_FMT);
    applyNumberFormat(ws, `N${row}`, INR_FMT);
    applyNumberFormat(ws, `P${row}`, INR_FMT);
    applyNumberFormat(ws, `Q${row}`, INR_FMT);
  }

  // Freeze header row of the pivot block
  ws["!freeze"] = { xSplit: 0, ySplit: 11 };

  // Styling: banner + pivot headers black/white/bold; KPI rows green; grand total stronger green.
  const NC = 17;
  styleRow(ws, 0, NC, HEADER_STYLE);
  styleRow(ws, 9, NC, HEADER_STYLE);
  styleRow(ws, 10, NC, HEADER_STYLE);
  for (let r = 3; r <= 7; r++) styleRow(ws, r, NC, TOTAL_STYLE); // KPI total rows
  styleRow(ws, 11 + pivot.length, NC, GRAND_TOTAL_STYLE);        // grand TOTAL row

  return ws;
}

function buildCustomersSheet(opts: BuildWorkbookOptions): XLSX.WorkSheet {
  const { customers } = opts;

  const header = [
    "Customer ID", "Customer Name", "Sales Person(s)", "Company", "Location",
    "Sales", "Collected", "Credit Notes", "Outstanding", "Overdue",
    "Max OD Days", "Credit Limit", "Utilization %", "Risk",
    "0-30", "31-60", "61-90", "91-120", "121-180", "180+",
  ];

  const rows = customers.map(c => [
    c.id,
    c.name,
    c.salesPersons && c.salesPersons.length ? c.salesPersons.join(", ") : c.salesPerson,
    c.companies && c.companies.length ? c.companies.join(", ") : (c.company ?? ""),
    c.locations && c.locations.length ? c.locations.join(", ") : (c.location ?? ""),
    c.sales, c.receipts + (c.otherPayments ?? 0), c.creditNotes, c.outstanding, c.overdue,
    c.maxOverdueDays, c.creditLimit, c.utilization,
    riskLabel[c.risk],
    c.agingBuckets?.["0_30"]   ?? 0,
    c.agingBuckets?.["31_60"]  ?? 0,
    c.agingBuckets?.["61_90"]  ?? 0,
    c.agingBuckets?.["91_120"] ?? 0,
    c.agingBuckets?.["121_180"]?? 0,
    c.agingBuckets?.["180_plus"] ?? 0,
  ]);

  const totals = [
    "TOTAL", "", "", "", "",
    customers.reduce((s, c) => s + c.sales, 0),
    customers.reduce((s, c) => s + c.receipts + (c.otherPayments ?? 0), 0),
    customers.reduce((s, c) => s + c.creditNotes, 0),
    sumOutstanding(customers),
    customers.reduce((s, c) => s + c.overdue, 0),
    "", "", "",  "",
    customers.reduce((s, c) => s + (c.agingBuckets?.["0_30"]   ?? 0), 0),
    customers.reduce((s, c) => s + (c.agingBuckets?.["31_60"]  ?? 0), 0),
    customers.reduce((s, c) => s + (c.agingBuckets?.["61_90"]  ?? 0), 0),
    customers.reduce((s, c) => s + (c.agingBuckets?.["91_120"] ?? 0), 0),
    customers.reduce((s, c) => s + (c.agingBuckets?.["121_180"]?? 0), 0),
    customers.reduce((s, c) => s + (c.agingBuckets?.["180_plus"] ?? 0), 0),
  ];

  const ws = XLSX.utils.aoa_to_sheet([header, totals, ...rows]);

  ws["!cols"] = [
    { wch: 10 }, { wch: 34 }, { wch: 22 }, { wch: 12 }, { wch: 12 },
    { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    { wch: 12 }, { wch: 14 }, { wch: 13 }, { wch: 10 },
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
  ];

  // Number formats — rows 2 onwards (1-indexed)
  const lastRow = rows.length + 2;
  const amountCols = ["F", "G", "H", "I", "J", "L", "O", "P", "Q", "R", "S", "T"];
  for (let row = 2; row <= lastRow; row++) {
    amountCols.forEach(col => applyNumberFormat(ws, `${col}${row}`, INR_FMT));
    applyNumberFormat(ws, `M${row}`, PCT_FMT);
  }

  ws["!freeze"] = { xSplit: 2, ySplit: 1 };
  ws["!autofilter"] = { ref: `A1:T${lastRow}` };

  // Header row black/white/bold; TOTAL row (row index 1) stronger green.
  styleRow(ws, 0, header.length, HEADER_STYLE);
  styleRow(ws, 1, header.length, GRAND_TOTAL_STYLE);

  return ws;
}

function buildFiltersSheet(opts: BuildWorkbookOptions): XLSX.WorkSheet {
  const { filters, asOfDate, title } = opts;
  const aoa: (string | number)[][] = [];
  aoa.push([title]);
  const _now = new Date();
  const _gen = `${ddmmyyyy(_now)} ${String(_now.getHours()).padStart(2, "0")}:${String(_now.getMinutes()).padStart(2, "0")}`;
  aoa.push([`Report generated: ${_gen}`]);
  aoa.push([`As-of date: ${formatDateLong(asOfDate)}`]);
  aoa.push([]);
  aoa.push(["Active Filter", "Value"]);
  for (const row of filtersToStrings(filters)) aoa.push(row);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 22 }, { wch: 50 }];
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
  styleRow(ws, 0, 2, HEADER_STYLE); // title
  styleRow(ws, 4, 2, HEADER_STYLE); // "Active Filter / Value" header
  return ws;
}

function applyNumberFormat(ws: XLSX.WorkSheet, addr: string, fmt: string) {
  const cell = ws[addr];
  if (cell && typeof cell.v === "number") cell.z = fmt;
}

export function buildWorkbook(opts: BuildWorkbookOptions): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildSummarySheet(opts), "Summary");
  XLSX.utils.book_append_sheet(wb, buildCustomersSheet(opts), "Customers");
  XLSX.utils.book_append_sheet(wb, buildFiltersSheet(opts), "Filters Applied");
  return wb;
}

function workbookToBlob(wb: XLSX.WorkBook): Blob {
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function sanitizeFilename(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "_").slice(0, 80);
}

function dateStamp(asOfDate: string): string {
  const d = new Date(asOfDate);
  if (isNaN(d.getTime())) return asOfDate;
  return d.toISOString().slice(0, 10);
}

export function downloadConsolidated(
  customers: ExportCustomerRow[],
  filters: ActiveFiltersSummary,
  asOfDate: string,
): string {
  const wb = buildWorkbook({
    customers, filters, asOfDate,
    title: "Salesperson Risk Analysis — Consolidated Report",
  });
  const filename = `Salesperson-Risk-Report_${dateStamp(asOfDate)}.xlsx`;
  saveAs(workbookToBlob(wb), filename);
  return filename;
}

export async function downloadPerSalesperson(
  selectedNames: string[],
  customers: ExportCustomerRow[],
  filters: ActiveFiltersSummary,
  asOfDate: string,
): Promise<{ count: number; filename: string }> {
  const stamp = dateStamp(asOfDate);

  if (selectedNames.length === 0) {
    return { count: 0, filename: "" };
  }

  if (selectedNames.length === 1) {
    const name = selectedNames[0];
    const subset = customers.filter(c =>
      (c.salesPersons && c.salesPersons.includes(name)) || c.salesPerson === name
    );
    const wb = buildWorkbook({
      customers: subset,
      filters,
      asOfDate,
      title: `Risk Report — ${name}`,
    });
    const filename = `${sanitizeFilename(name)}_Risk-Report_${stamp}.xlsx`;
    saveAs(workbookToBlob(wb), filename);
    return { count: 1, filename };
  }

  const zip = new JSZip();
  for (const name of selectedNames) {
    const subset = customers.filter(c =>
      (c.salesPersons && c.salesPersons.includes(name)) || c.salesPerson === name
    );
    const wb = buildWorkbook({
      customers: subset,
      filters,
      asOfDate,
      title: `Risk Report — ${name}`,
    });
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    zip.file(`${sanitizeFilename(name)}_Risk-Report_${stamp}.xlsx`, buf);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  const filename = `Salesperson-Reports_${stamp}.zip`;
  saveAs(blob, filename);
  return { count: selectedNames.length, filename };
}

function shareSubject(salespersonName: string, asOfDate: string): string {
  return `Receivables Risk Report — ${salespersonName} — as of ${formatDateLong(asOfDate)}`;
}

function shareBody(salespersonName: string, asOfDate: string): string {
  return (
    `Hi ${salespersonName},\n\n` +
    `Please find attached the receivables risk report for your customer portfolio, ` +
    `as of ${formatDateLong(asOfDate)}.\n\n` +
    `The report includes:\n` +
    `  • A summary pivot by risk category\n` +
    `  • A customer-wise breakdown with outstanding, overdue and aging buckets\n\n` +
    `Please review and share your action plan for the Critical / High risk accounts.\n\n` +
    `Thanks,\nOrange Receivables Team`
  );
}

export function buildMailtoLink(salespersonName: string, asOfDate: string, to = ""): string {
  const subject = encodeURIComponent(shareSubject(salespersonName, asOfDate));
  const body    = encodeURIComponent(shareBody(salespersonName, asOfDate));
  return `mailto:${encodeURIComponent(to)}?subject=${subject}&body=${body}`;
}

export function buildWhatsAppLink(salespersonName: string, asOfDate: string): string {
  const text = `*${shareSubject(salespersonName, asOfDate)}*\n\n${shareBody(salespersonName, asOfDate)}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
