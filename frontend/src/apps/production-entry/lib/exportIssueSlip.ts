import * as XLSX from "xlsx-js-style";
import { saveAs } from "file-saver";

/**
 * Issue Slip → Excel export for the Production Entry FMS.
 *
 * Reproduces the physical "Raw Material Details & Feeding Sequence" issue slip
 * (the paper form the floor fills by hand) as a styled .xlsx: a company header
 * band, the product-info block (incl. the issue-slip date), the 7-column
 * raw-material table grouped under a (hand-written) section band, a TOTAL row,
 * and the signature blocks (Prepared/Approved + the four numbered sign-offs:
 * RM Slip Provider, Store Verify, Batch Operator, Chemist).
 *
 * Fields the app does not store (Print Head Type, Product Code, per-line
 * Remarks, the section name) are rendered as blank cells to hand-fill — matching
 * the paper form. Per-line "Raw Material Batch Number" and "Actual Issued" are
 * filled from the Material Handover step when the card has progressed, else left
 * blank. Proportion % is derived from the theoretical weights so the column ties
 * to 100.
 */

/** One raw-material line, already resolved to display values by the caller. */
export interface IssueSlipLine {
  /** Raw-material name (from the raw-materials master). */
  productName: string;
  /** Theoretical weighing = the BOM line's required quantity. */
  theoreticalKg: number | null;
  /**
   * The line's own split percentage, straight from the card.
   *
   * ⚠ Load-bearing. The fallback below re-derives a percentage by normalising the
   * theoretical weights to their own total, which only equals the real split when
   * the lines happen to sum to the FG quantity. They no longer have to: a
   * formulation totalling 33.3% would otherwise print as 59.5% and still show a
   * confident 100% total — the paper form disagreeing with the BOM master.
   * Null only on cards raised before the BOM master existed.
   */
  proportionPct: number | null;
  /** RM batch/lot no. from Material Handover, or "" if not yet handed over. */
  rmBatchNo: string;
  /** Actual issued qty from Material Handover, or null if not yet handed over. */
  actualIssued: number | null;
}

export interface IssueSlipExport {
  /** Lot/Batch Card number → "Product Batch Number" on the form. */
  jobcardNo: string;
  /** FG item name → "Product Name & Product Code Number". */
  productName: string;
  /** Original FG quantity to produce (base issue slip, excludes AIS top-ups). */
  productionQty: number | null;
  requesterName: string;
  /** Pre-formatted dd-mm-yyyy issue-slip date (caller uses `dmy`). */
  submittedAtDMY: string;
  lines: IssueSlipLine[];
}

// ── Static template text (not in the data model) ──────────────────────────────
const COMPANY = "Orange O Tec Enterprises Pvt. Ltd.";
const ADDRESS =
  "Shed No. A2/7111, Road No.71, Gate No.: 01 G.I.D.C Sachin, Surat – 394230, (Guj.) India.";

/** The four numbered sign-offs (in order) below the Prepared/Approved blocks. */
const SIGN_OFFS = ["RM Slip Provider", "Store Verify", "Batch Operator", "Chemist"];

const NCOLS = 7; // Sr.No | Product | Proportion | Theoretical | RM Batch | Actual | Remarks
const NUM_FMT = "0.00";
const PCT_FMT = '0.00"%"'; // literal % suffix — does NOT multiply by 100 like "0.00%"
const QTY_FMT = "#,##0.###";

// ── Cell styles ───────────────────────────────────────────────────────────────
const thin = { style: "thin", color: { rgb: "9AA0A6" } };
const BORDER = { top: thin, bottom: thin, left: thin, right: thin };

const TITLE = { font: { bold: true, sz: 14, color: { rgb: "0B2447" } }, alignment: { horizontal: "center", vertical: "center" } };
const ADDR = { font: { sz: 9, color: { rgb: "555555" } }, alignment: { horizontal: "center" } };
const LABEL = { font: { bold: true, sz: 10, color: { rgb: "1F2937" } }, fill: { fgColor: { rgb: "EDEFF2" } }, alignment: { vertical: "center", horizontal: "left", wrapText: true }, border: BORDER };
const VALUE = { font: { sz: 10, color: { rgb: "111111" } }, alignment: { vertical: "center", horizontal: "left" }, border: BORDER };
const SECTITLE = { font: { bold: true, sz: 11, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "0B2447" } }, alignment: { vertical: "center", horizontal: "left" }, border: BORDER };
const COLHEAD = { font: { bold: true, sz: 9.5, color: { rgb: "1F2937" } }, fill: { fgColor: { rgb: "C9D2DE" } }, alignment: { vertical: "center", horizontal: "center", wrapText: true }, border: BORDER };
const BAND = { font: { bold: true, sz: 10, color: { rgb: "1F2937" } }, fill: { fgColor: { rgb: "DEE3EA" } }, alignment: { vertical: "center" }, border: BORDER };
const CELL_L = { font: { sz: 10 }, alignment: { vertical: "center", horizontal: "left" }, border: BORDER };
const CELL_C = { font: { sz: 10 }, alignment: { vertical: "center", horizontal: "center" }, border: BORDER };
const CELL_R = { font: { sz: 10 }, alignment: { vertical: "center", horizontal: "right" }, border: BORDER };
const TOTAL_L = { font: { bold: true, sz: 10 }, fill: { fgColor: { rgb: "DEE3EA" } }, alignment: { vertical: "center", horizontal: "left" }, border: BORDER };
const TOTAL_R = { font: { bold: true, sz: 10 }, fill: { fgColor: { rgb: "DEE3EA" } }, alignment: { vertical: "center", horizontal: "right" }, border: BORDER };
const SIGN_LINE = { font: { sz: 10 }, alignment: { horizontal: "left" } };
const SIGN_LABEL = { font: { sz: 9, color: { rgb: "555555" } }, alignment: { horizontal: "left" } };
// Four numbered sign-offs: one plain left-aligned cell each (number + label +
// aligned colon + underscore line), matching the reference Excel exactly.
const SIGN_OFF = { font: { sz: 10 }, alignment: { horizontal: "left", vertical: "center" } };
const TRACE = { font: { sz: 9, italic: true, color: { rgb: "777777" } }, alignment: { horizontal: "left" } };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Set/merge a cell's style (creating the cell if missing) + optional number format. */
function style(ws: XLSX.WorkSheet, r: number, c: number, s: object, z?: string): void {
  const addr = XLSX.utils.encode_cell({ r, c });
  const sheet = ws as Record<string, { s?: object; z?: string; t?: string; v?: unknown }>;
  const cell = sheet[addr] ?? { t: "s", v: "" };
  cell.s = { ...(cell.s ?? {}), ...s };
  if (z) cell.z = z;
  sheet[addr] = cell;
}

/** Apply one style across an inclusive column span of a single row. */
function styleSpan(ws: XLSX.WorkSheet, r: number, c0: number, c1: number, s: object, z?: string): void {
  for (let c = c0; c <= c1; c++) style(ws, r, c, s, z);
}

export function exportIssueSlipXlsx(input: IssueSlipExport): void {
  // Prefer the split the card actually carries. Legacy cards (no stored pct) fall
  // back to normalising the theoretical weights — correct for them, because the
  // old form required the lines to sum to the FG quantity.
  const totalTheo = input.lines.reduce((a, l) => a + (l.theoreticalKg ?? 0), 0);
  const rows = input.lines.map((l) => ({
    name: l.productName,
    prop:
      l.proportionPct != null
        ? round2(l.proportionPct)
        : totalTheo > 0 && l.theoreticalKg != null
          ? round2((l.theoreticalKg / totalTheo) * 100)
          : null,
    theo: l.theoreticalKg,
    batch: l.rmBatchNo,
    actual: l.actualIssued,
  }));
  const propTotal = round2(rows.reduce((a, r) => a + (r.prop ?? 0), 0));
  const theoTotal = round2(totalTheo);

  // ── Build the value grid; track row indices as we go ────────────────────────
  const aoa: (string | number)[][] = [];
  const push = (...cells: (string | number)[]): number => {
    const row = cells.slice(0, NCOLS);
    while (row.length < NCOLS) row.push("");
    aoa.push(row);
    return aoa.length - 1;
  };

  const rCompany = push(COMPANY);
  const rAddr = push(ADDRESS);
  push(); // spacer

  const rP1 = push("Product Name & Product Code Number", "", input.productName);
  const rP2 = push("Print Head Type", "", "");
  const rP3 = push("Product Batch Number", "", input.jobcardNo);
  const rP4 = push("Production Quantity (In Kgs.)", "", input.productionQty ?? "");
  const rP5 = push("Date", "", input.submittedAtDMY);
  const infoLabelRows = [rP1, rP2, rP3, rP4, rP5];
  push(); // spacer

  const rSecTitle = push("1   Raw Material Details & Feeding Sequence");
  const rColHead = push(
    "Sr. No",
    "Product Name",
    "Proportion Dosage (In %)",
    "Theoretical Weighing (In Kgs.)",
    "Raw Material Batch Number",
    "Actual Issued (In Kgs.)",
    "Remarks",
  );
  const rBand = push(""); // blank shaded section band (hand-write "Ink Preparation")

  const rDataStart = aoa.length;
  rows.forEach((r, i) =>
    push(i + 1, r.name, r.prop ?? "", r.theo ?? "", r.batch || "", r.actual ?? "", ""),
  );
  const rDataEnd = aoa.length - 1;

  // Two blank spare rows for hand additions (matches the paper form).
  const rSpare1 = push();
  const rSpare2 = push();

  const rTotal = push("", "TOTAL", propTotal, theoTotal, "", "", "");
  push(); // spacer

  // Signature block 1: Prepared / Approved.
  const rSignLine = push("_________________________", "", "", "", "_________________________");
  const rSignName = push("Prepared by / Sign", "", "", "", "Approved by / Sign");
  push(); // spacer
  // Signature block 2: four numbered sign-offs, each a single left-aligned cell
  // (number, label, aligned colon, underscore line) — compact, matches the ref.
  const signOffRows = SIGN_OFFS.map((label, i) =>
    push("", `${`${i + 1}  ${label}`.padEnd(30)}:  ${"_".repeat(27)}`),
  );
  push(); // spacer
  const rTrace = push(`Raised by ${input.requesterName} on ${input.submittedAtDMY}`);

  // ── Sheet + geometry ────────────────────────────────────────────────────────
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 6 }, { wch: 30 }, { wch: 14 }, { wch: 16 }, { wch: 20 }, { wch: 14 }, { wch: 22 }];

  const merges: XLSX.Range[] = [
    { s: { r: rCompany, c: 0 }, e: { r: rCompany, c: NCOLS - 1 } },
    { s: { r: rAddr, c: 0 }, e: { r: rAddr, c: NCOLS - 1 } },
    { s: { r: rSecTitle, c: 0 }, e: { r: rSecTitle, c: NCOLS - 1 } },
    { s: { r: rBand, c: 0 }, e: { r: rBand, c: NCOLS - 1 } },
    { s: { r: rTrace, c: 0 }, e: { r: rTrace, c: NCOLS - 1 } },
  ];
  // Product info: label spans A:B, value spans C:G.
  for (const r of infoLabelRows) {
    merges.push({ s: { r, c: 0 }, e: { r, c: 1 } });
    merges.push({ s: { r, c: 2 }, e: { r, c: NCOLS - 1 } });
  }
  // Prepared/Approved blocks: A:C and E:G.
  for (const r of [rSignLine, rSignName]) {
    merges.push({ s: { r, c: 0 }, e: { r, c: 2 } });
    merges.push({ s: { r, c: 4 }, e: { r, c: NCOLS - 1 } });
  }
  ws["!merges"] = merges;

  const rowInfo: { hpt: number }[] = [];
  rowInfo[rCompany] = { hpt: 22 };
  rowInfo[rColHead] = { hpt: 30 };
  rowInfo[rSignLine] = { hpt: 26 };
  for (const r of signOffRows) rowInfo[r] = { hpt: 17 };
  ws["!rows"] = rowInfo;

  // ── Styling ─────────────────────────────────────────────────────────────────
  style(ws, rCompany, 0, TITLE);
  style(ws, rAddr, 0, ADDR);

  const infoFmt: Record<number, string> = { [rP4]: QTY_FMT };
  for (const r of infoLabelRows) {
    styleSpan(ws, r, 0, 1, LABEL);
    styleSpan(ws, r, 2, NCOLS - 1, VALUE, infoFmt[r]);
  }

  styleSpan(ws, rSecTitle, 0, NCOLS - 1, SECTITLE);
  styleSpan(ws, rColHead, 0, NCOLS - 1, COLHEAD);
  styleSpan(ws, rBand, 0, NCOLS - 1, BAND);

  for (let r = rDataStart; r <= rDataEnd; r++) {
    style(ws, r, 0, CELL_C); // Sr. No
    style(ws, r, 1, CELL_L); // Product Name
    style(ws, r, 2, CELL_R, PCT_FMT); // Proportion % (with % suffix)
    style(ws, r, 3, CELL_R, NUM_FMT); // Theoretical
    style(ws, r, 4, CELL_L); // RM Batch No
    style(ws, r, 5, CELL_R, NUM_FMT); // Actual Issued
    style(ws, r, 6, CELL_L); // Remarks
  }

  for (const r of [rSpare1, rSpare2]) styleSpan(ws, r, 0, NCOLS - 1, CELL_L);

  styleSpan(ws, rTotal, 0, NCOLS - 1, TOTAL_L);
  style(ws, rTotal, 2, TOTAL_R, PCT_FMT);
  style(ws, rTotal, 3, TOTAL_R, NUM_FMT);

  style(ws, rSignLine, 0, SIGN_LINE);
  style(ws, rSignLine, 4, SIGN_LINE);
  style(ws, rSignName, 0, SIGN_LABEL);
  style(ws, rSignName, 4, SIGN_LABEL);
  for (const r of signOffRows) style(ws, r, 1, SIGN_OFF);
  styleSpan(ws, rTrace, 0, NCOLS - 1, TRACE);

  // ── Download (matches shared/lib/exportXlsx.ts idiom) ───────────────────────
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Issue Slip");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const fileName = `Issue-Slip-${input.jobcardNo.replace(/[\\/:*?"<>|]+/g, "-") || "job-card"}.xlsx`;
  saveAs(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    fileName,
  );
}
