import * as XLSX from "xlsx-js-style";
import { saveAs } from "file-saver";
import { todayIso, formatDateTime } from "@/shared/lib/time";

/**
 * Excel export for the Recurring Tasks page. The caller (RecurringList) resolves
 * ids to display names and passes print-ready rows, same as exportTasks. One
 * "Recurring Tasks" sheet + a "Filters Applied" sheet recording what narrowed the
 * export (e.g. "Assigned to: Dimple"). Dates are dd-mm-yyyy.
 */

export interface RecurringExportRow {
  title: string;
  description: string;
  type: string; // Daily / Weekly / Monthly / Quarterly / As and When
  frequency: string; // "Every Mon, Thu", "Quarterly — 7 days before quarter-end"
  assignedBy: string;
  assignedTo: string;
  department: string;
  locations: string;
  reminder: string; // "3 days before" / "No"
  status: string; // Active / Paused
  createdOn: string; // dd-mm-yyyy
}

const COLUMNS: { header: string; key: keyof RecurringExportRow; width: number }[] = [
  { header: "Task", key: "title", width: 36 },
  { header: "Description", key: "description", width: 44 },
  { header: "Type", key: "type", width: 13 },
  { header: "Frequency", key: "frequency", width: 36 },
  { header: "Assigned By", key: "assignedBy", width: 18 },
  { header: "Assigned To", key: "assignedTo", width: 18 },
  { header: "Department", key: "department", width: 18 },
  { header: "Locations", key: "locations", width: 22 },
  { header: "Reminder", key: "reminder", width: 15 },
  { header: "Status", key: "status", width: 10 },
  { header: "Created On", key: "createdOn", width: 13 },
];

const HEADER_STYLE = {
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 },
  fill: { fgColor: { rgb: "0B1F3A" } }, // navy — matches the portal shell
  alignment: { vertical: "center" },
};

/** Apply a style across a whole row (0-indexed), creating blank cells as needed. */
function styleRow(ws: XLSX.WorkSheet, row: number, ncols: number, style: object): void {
  const sheet = ws as Record<string, unknown>;
  for (let c = 0; c < ncols; c++) {
    const addr = XLSX.utils.encode_cell({ r: row, c });
    const cell = (sheet[addr] as { s?: object; t?: string; v?: unknown }) ?? { t: "s", v: "" };
    cell.s = { ...(cell.s ?? {}), ...style };
    sheet[addr] = cell;
  }
}

function buildRecurringSheet(rows: RecurringExportRow[]): XLSX.WorkSheet {
  const header = COLUMNS.map((c) => c.header);
  const aoa: string[][] = [header, ...rows.map((r) => COLUMNS.map((c) => r[c.key]))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = COLUMNS.map((c) => ({ wch: c.width }));
  ws["!freeze"] = { xSplit: 1, ySplit: 1 }; // freeze the Task column + header row
  const lastCol = XLSX.utils.encode_col(COLUMNS.length - 1);
  ws["!autofilter"] = { ref: `A1:${lastCol}${rows.length + 1}` };
  styleRow(ws, 0, COLUMNS.length, HEADER_STYLE);
  return ws;
}

function buildFiltersSheet(filters: string[], count: number): XLSX.WorkSheet {
  const aoa: string[][] = [];
  aoa.push(["Recurring Tasks — Export"]);
  aoa.push([`Generated: ${formatDateTime(new Date().toISOString())}`]);
  aoa.push([`Rows exported: ${count}`]);
  aoa.push([]);
  aoa.push(["Active filters"]);
  if (filters.length) filters.forEach((f) => aoa.push([f]));
  else aoa.push(["None — every recurring task in the current view"]);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 64 }];
  styleRow(ws, 0, 1, HEADER_STYLE);
  styleRow(ws, 4, 1, HEADER_STYLE);
  return ws;
}

/**
 * Build and download an .xlsx of the given recurring-task rows.
 * @param rows     the full filtered + sorted set on screen (all pages)
 * @param filters  human-readable active-filter labels (for the Filters sheet)
 * @param fileTag  optional name for the file, e.g. the assignee ("Dimple")
 */
export function exportRecurringToXlsx(rows: RecurringExportRow[], filters: string[], fileTag?: string): void {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildRecurringSheet(rows), "Recurring Tasks");
  XLSX.utils.book_append_sheet(wb, buildFiltersSheet(filters, rows.length), "Filters Applied");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const tag = fileTag ? `_${fileTag.replace(/[^\w-]+/g, "-")}` : "";
  saveAs(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `Recurring-Tasks${tag}_${todayIso()}.xlsx`,
  );
}
