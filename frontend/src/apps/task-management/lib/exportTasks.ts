import * as XLSX from "xlsx-js-style";
import { saveAs } from "file-saver";
import { todayIso, formatDateTime } from "@/shared/lib/time";

/**
 * Excel export for the All Tasks view. The caller (TaskBrowser) resolves ids to
 * display names and passes plain, print-ready rows so this stays store-agnostic.
 * One "Tasks" sheet (exactly the columns an admin sees, plus a few useful extras)
 * + a "Filters Applied" sheet recording what narrowed the export. Dates are
 * dd-mm-yyyy to match the rest of the app.
 */

export interface TaskExportRow {
  title: string;
  description: string;
  department: string;
  createdBy: string;
  assignedTo: string;
  type: string; // Recurring / One-off / Other
  recurrence: string;
  status: string;
  assignedOn: string; // dd-mm-yyyy
  dueDate: string; // dd-mm-yyyy
  followUp: string; // dd-mm-yyyy
  revisions: number;
  completedOn: string; // dd-mm-yyyy
  lastUpdated: string; // dd-mm-yyyy h:mm AM/PM
}

const COLUMNS: { header: string; key: keyof TaskExportRow; width: number }[] = [
  { header: "Task", key: "title", width: 42 },
  { header: "Description", key: "description", width: 44 },
  { header: "Department", key: "department", width: 18 },
  { header: "Created By", key: "createdBy", width: 18 },
  { header: "Assigned To", key: "assignedTo", width: 18 },
  { header: "Type", key: "type", width: 12 },
  { header: "Recurrence", key: "recurrence", width: 14 },
  { header: "Status", key: "status", width: 15 },
  { header: "Assigned On", key: "assignedOn", width: 13 },
  { header: "Due Date", key: "dueDate", width: 13 },
  { header: "Follow-up", key: "followUp", width: 13 },
  { header: "Revisions", key: "revisions", width: 10 },
  { header: "Completed On", key: "completedOn", width: 13 },
  { header: "Last Updated", key: "lastUpdated", width: 20 },
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

function buildTasksSheet(rows: TaskExportRow[]): XLSX.WorkSheet {
  const header = COLUMNS.map((c) => c.header);
  const aoa: (string | number)[][] = [header, ...rows.map((r) => COLUMNS.map((c) => r[c.key]))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = COLUMNS.map((c) => ({ wch: c.width }));
  ws["!freeze"] = { xSplit: 1, ySplit: 1 }; // freeze the Task column + header row
  const lastCol = XLSX.utils.encode_col(COLUMNS.length - 1);
  ws["!autofilter"] = { ref: `A1:${lastCol}${rows.length + 1}` };
  styleRow(ws, 0, COLUMNS.length, HEADER_STYLE);
  return ws;
}

function buildFiltersSheet(filters: string[], subtitle: string | undefined, count: number): XLSX.WorkSheet {
  const aoa: string[][] = [];
  aoa.push(["All Tasks — Export"]);
  aoa.push([`Generated: ${formatDateTime(new Date().toISOString())}`]);
  if (subtitle) aoa.push([subtitle]);
  aoa.push([`Rows exported: ${count}`]);
  aoa.push([]);
  aoa.push(["Active filters"]);
  if (filters.length) filters.forEach((f) => aoa.push([f]));
  else aoa.push(["None — every task in the current view"]);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 64 }];
  styleRow(ws, 0, 1, HEADER_STYLE);
  styleRow(ws, 5, 1, HEADER_STYLE);
  return ws;
}

/**
 * Build and download an .xlsx of the given task rows.
 * @param rows     the full filtered + sorted set the admin is viewing (all pages)
 * @param filters  human-readable active-filter labels (for the Filters sheet)
 * @param subtitle optional context line (e.g. the week/all-time scope)
 */
export function exportTasksToXlsx(rows: TaskExportRow[], filters: string[], subtitle?: string): void {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildTasksSheet(rows), "Tasks");
  XLSX.utils.book_append_sheet(wb, buildFiltersSheet(filters, subtitle, rows.length), "Filters Applied");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  saveAs(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `All-Tasks_${todayIso()}.xlsx`,
  );
}
