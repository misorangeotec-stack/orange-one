import * as XLSX from "xlsx-js-style";

/**
 * Shared Excel cell styling for all receivables exports (xlsx-js-style adds the
 * style support the stock `xlsx` writer lacks).
 *
 *   • HEADER       — title + column-header rows: bold, black fill, white text.
 *   • SUBTOTAL     — a subtotal WITHIN a block (e.g. one sale type inside a
 *                    customer): bold, palest green — a step below TOTAL, so a
 *                    block that carries both reads subtotal → total and not as two
 *                    rows of equal weight.
 *   • TOTAL        — interim subtotal rows: bold, light-green fill.
 *   • GRAND_TOTAL  — the grand-total row: bold, stronger green — clearly distinct
 *                    from the interim totals.
 *
 * The three greens are one ladder and are meant to be read as one: palest for the
 * innermost figure, strongest for the bottom line. Keep them in that order if the
 * palette ever changes.
 */

export const HEADER_STYLE = {
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 },
  fill: { fgColor: { rgb: "000000" } },
  alignment: { vertical: "center" },
};

export const SUBTOTAL_STYLE = {
  font: { bold: true, color: { rgb: "14532D" } },
  fill: { fgColor: { rgb: "E7F6EC" } }, // palest green — a step below TOTAL_STYLE
};

export const TOTAL_STYLE = {
  font: { bold: true, color: { rgb: "14532D" } },
  fill: { fgColor: { rgb: "C6EFCE" } }, // light green
};

export const GRAND_TOTAL_STYLE = {
  font: { bold: true, color: { rgb: "FFFFFF" } },
  fill: { fgColor: { rgb: "2E7D32" } }, // strong green — distinct from interim totals
};

/**
 * Apply a style to every cell of a row (0-indexed), creating blank cells as
 * needed so the whole row carries the fill. Existing number formats (`z`) are
 * preserved. `ncols` should be the full table width so short rows (e.g. a title
 * row with one cell) still get a full-width band.
 */
export function styleRow(ws: XLSX.WorkSheet, row: number, ncols: number, style: object): void {
  const sheet = ws as Record<string, unknown>;
  for (let c = 0; c < ncols; c++) {
    const addr = XLSX.utils.encode_cell({ r: row, c });
    const cell = (sheet[addr] as { s?: object; t?: string; v?: unknown }) ?? { t: "s", v: "" };
    cell.s = { ...(cell.s ?? {}), ...style };
    sheet[addr] = cell;
  }
}
