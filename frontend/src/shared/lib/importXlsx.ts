import * as XLSX from "xlsx-js-style";

/**
 * Generic ".xlsx → rows" reader — the mirror of exportXlsx.ts.
 *
 * Every export this portal produces carries a trailing "About this export" sheet
 * (see exportXlsx.ts). So on the way back we read the FIRST sheet that isn't that
 * one — a round-tripped file's data sheet, not its provenance note. `xlsx-js-style`
 * is already a dependency (it reads as well as it writes); no new library.
 *
 * `sheet_to_json(..., { defval: "" })` gives one object per data row keyed by the
 * header cells, with blank cells present as "" rather than dropped — so a caller
 * can tell "column left empty" (clear the field) from "column absent" (wrong file).
 */

const ABOUT_SHEET = "About this export";

export async function parseXlsxRows(file: File): Promise<Record<string, unknown>[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const dataName = wb.SheetNames.find((n) => n !== ABOUT_SHEET) ?? wb.SheetNames[0];
  if (!dataName) throw new Error("The file has no sheets.");
  const ws = wb.Sheets[dataName];
  if (!ws) throw new Error(`Sheet "${dataName}" could not be read.`);
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
}

/**
 * Read a spreadsheet cell as a boolean. Checked columns export as "Yes"/"No", but a
 * hand-edited file may hold true/1/y/✓ — accept the common truthy spellings, treat
 * everything else (including blank) as false.
 */
export function readBool(v: unknown): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "yes" || s === "true" || s === "1" || s === "y" || s === "✓";
}
