import * as XLSX from "xlsx-js-style";
import { saveAs } from "file-saver";
import { todayIso, formatDateTime } from "@/shared/lib/time";
import { formatDateDMY } from "@/shared/lib/date";
import { labelOf } from "./transforms";
import type { Lead, Masters } from "./types";

/**
 * Excel export for the Leads Dashboard — one "Leads" sheet (the columns the
 * dashboard shows, plus contact details), and a "Filters Applied" sheet recording
 * what narrowed the export. Dates are dd-mm-yyyy to match the rest of the portal.
 */

const COLUMNS: { header: string; width: number; get: (l: Lead, m: Masters) => string | number }[] = [
  { header: "Company", width: 26, get: (l) => l.companyName },
  { header: "Person", width: 22, get: (l) => l.personName },
  { header: "Job Title", width: 20, get: (l) => l.jobTitle },
  { header: "Other Contacts", width: 26, get: (l) => l.people.slice(1).join(", ") },
  { header: "Salesperson", width: 20, get: (l) => l.salesperson },
  { header: "Mobiles", width: 26, get: (l) => l.mobiles.join(", ") },
  { header: "Emails", width: 28, get: (l) => l.emails.join(", ") },
  { header: "Interest", width: 16, get: (l, m) => labelOf(m, "interestLevels", l.interestLevelId) },
  { header: "Categories", width: 24, get: (l, m) => l.categoryIds.map((c) => labelOf(m, "categories", c)).filter(Boolean).join(", ") },
  { header: "Asked About", width: 24, get: (l, m) => l.askedAboutIds.map((a) => labelOf(m, "askedAbout", a)).filter(Boolean).join(", ") },
  { header: "Follow-up", width: 20, get: (l, m) => labelOf(m, "followUpActions", l.followUpActionId) },
  { header: "Voice Note", width: 11, get: (l) => (l.hasVoice ? "Yes" : "No") },
  { header: "Location", width: 28, get: (l) => l.location },
  { header: "Captured On", width: 14, get: (l) => formatDateDMY(l.capturedOn) },
];

const HEADER_STYLE = {
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 },
  fill: { fgColor: { rgb: "0B1F3A" } },
  alignment: { vertical: "center" },
};

function styleRow(ws: XLSX.WorkSheet, row: number, ncols: number, style: object): void {
  const sheet = ws as Record<string, unknown>;
  for (let c = 0; c < ncols; c++) {
    const addr = XLSX.utils.encode_cell({ r: row, c });
    const cell = (sheet[addr] as { s?: object; t?: string; v?: unknown }) ?? { t: "s", v: "" };
    cell.s = { ...(cell.s ?? {}), ...style };
    sheet[addr] = cell;
  }
}

function buildLeadsSheet(leads: Lead[], masters: Masters): XLSX.WorkSheet {
  const header = COLUMNS.map((c) => c.header);
  const aoa: (string | number)[][] = [header, ...leads.map((l) => COLUMNS.map((c) => c.get(l, masters)))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = COLUMNS.map((c) => ({ wch: c.width }));
  ws["!freeze"] = { xSplit: 1, ySplit: 1 };
  const lastCol = XLSX.utils.encode_col(COLUMNS.length - 1);
  ws["!autofilter"] = { ref: `A1:${lastCol}${leads.length + 1}` };
  styleRow(ws, 0, COLUMNS.length, HEADER_STYLE);
  return ws;
}

function buildFiltersSheet(filters: string[], count: number): XLSX.WorkSheet {
  const aoa: string[][] = [];
  aoa.push(["Leads Dashboard — Export"]);
  aoa.push([`Generated: ${formatDateTime(new Date().toISOString())}`]);
  aoa.push([`Rows exported: ${count}`]);
  aoa.push([]);
  aoa.push(["Active filters"]);
  if (filters.length) filters.forEach((f) => aoa.push([f]));
  else aoa.push(["None — every lead in the current view"]);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 64 }];
  styleRow(ws, 0, 1, HEADER_STYLE);
  styleRow(ws, 4, 1, HEADER_STYLE);
  return ws;
}

/** Build and download an .xlsx of the given (filtered) leads. */
export function exportLeadsToXlsx(leads: Lead[], masters: Masters, filters: string[]): void {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildLeadsSheet(leads, masters), "Leads");
  XLSX.utils.book_append_sheet(wb, buildFiltersSheet(filters, leads.length), "Filters Applied");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  saveAs(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `Leads_${todayIso()}.xlsx`);
}
