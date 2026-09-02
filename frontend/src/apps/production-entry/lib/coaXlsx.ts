import * as XLSX from "xlsx-js-style";
import { saveAs } from "file-saver";
import { buildCoaDocument, coaFileName, COA_SIGN_OFFS, type CoaDocument } from "./coaVm";
import type { Coa, CoaAudience } from "../types";

/**
 * The COA as an .xlsx, laid out as the factory's own sheet ("Daily Quality
 * Monitoring Sheet OOT QC FMT 002", tab "COA (Both)"): company and address at the
 * top, a centred title, three label/value rows, the four-column analysis grid
 * whose FIRST HEADER CELL IS BLANK, a conclusion row, then the two sign-offs.
 *
 * ⚠ NOT a normalised one-row-per-record sheet. This is a DOCUMENT the QC team
 *   prints and files, so it is laid out to look like the paper form it replaces —
 *   the same instinct bomIo.ts follows when it reads the formulations in the shape
 *   the business already writes them.
 *
 * ⚠ NO LOGO, AND THAT IS A LIMITATION, NOT AN OVERSIGHT. SheetJS cannot embed an
 *   image into a worksheet, so the letterhead here is the company name and address
 *   as text. The PDF and the print view both carry the real wordmark; anyone who
 *   needs the letterhead should use one of those.
 *
 * ⚠ AND FOR THE SAME REASON THE WATERMARK IS A BANNER ROW here rather than a
 *   stamp across the page. A rejected (or not-yet-verified) certificate must not
 *   leave this file unmarked — see the note at `rBanner`.
 */

const NCOLS = 4; // Parameter | Standard | Observed | Test Equipment

const thin = { style: "thin", color: { rgb: "000000" } };
const BORDER = { top: thin, bottom: thin, left: thin, right: thin };
const COMPANY = { font: { bold: true, sz: 12, color: { rgb: "1F3564" } }, alignment: { horizontal: "center", vertical: "center" } };
const ADDR = { font: { sz: 9, color: { rgb: "333333" } }, alignment: { horizontal: "center", wrapText: true } };
const TITLE = { font: { bold: true, sz: 15, color: { rgb: "000000" } }, alignment: { horizontal: "center", vertical: "center" } };
const LABEL = { font: { bold: true, sz: 10 }, alignment: { vertical: "center", horizontal: "left", wrapText: true }, border: BORDER };
const VALUE = { font: { sz: 10 }, alignment: { vertical: "center", horizontal: "left" }, border: BORDER };
const COLHEAD = { font: { bold: true, sz: 10 }, alignment: { vertical: "center", horizontal: "center", wrapText: true }, border: BORDER };
const CELL_L = { font: { sz: 10 }, alignment: { vertical: "center", horizontal: "left", wrapText: true }, border: BORDER };
const CELL_C = { font: { sz: 10 }, alignment: { vertical: "center", horizontal: "center" }, border: BORDER };
const BANNER = { font: { bold: true, sz: 13, color: { rgb: "B3261E" } }, alignment: { horizontal: "center", vertical: "center" } };
const RESULT = { font: { bold: true, sz: 10 }, alignment: { vertical: "center", horizontal: "left", wrapText: true }, border: BORDER };
const SIGN = { font: { bold: true, sz: 10 }, alignment: { vertical: "bottom", horizontal: "left" }, border: { top: thin } };

function style(ws: XLSX.WorkSheet, r: number, c: number, s: object): void {
  const addr = XLSX.utils.encode_cell({ r, c });
  const sheet = ws as Record<string, { s?: object; t?: string; v?: unknown }>;
  const cell = sheet[addr] ?? { t: "s", v: "" };
  cell.s = { ...(cell.s ?? {}), ...s };
  sheet[addr] = cell;
}

function styleSpan(ws: XLSX.WorkSheet, r: number, c0: number, c1: number, s: object): void {
  for (let c = c0; c <= c1; c++) style(ws, r, c, s);
}

function sheetFor(doc: CoaDocument): XLSX.WorkSheet {
  const aoa: string[][] = [];
  const push = (...cells: string[]): number => {
    const rowCells = cells.slice(0, NCOLS);
    while (rowCells.length < NCOLS) rowCells.push("");
    aoa.push(rowCells);
    return aoa.length - 1;
  };

  const rCompany = push(doc.company);
  const rAddr = push(doc.addressLines.join(" "));
  push();
  const rTitle = push(doc.title);
  /**
   * ⚠ THE WATERMARK'S STAND-IN, AND IT MUST NOT BE DROPPED. SheetJS embeds no
   *   image and has no watermark layer — the same limit that already forces the
   *   letterhead here to be text — so the PDF's rotated stamp becomes a banner
   *   row, placed directly under the title where it cannot be scrolled past.
   *   Left to itself the .xlsx is the one output that silently loses the
   *   marking, and it is the copy people forward as an attachment.
   */
  const rBanner = doc.watermark ? push(`***   ${doc.watermark}   ***   Test ${doc.round}`) : -1;
  push();

  const info: [string, string][] = [
    ["Product Name :", doc.productName],
    ["Lot No :", doc.lotNo],
    ["Issue Date :", doc.issueDateDmy],
  ];
  const infoRows = info.map(([label, value]) => push(label, value));
  push();

  // Blank first header cell, as on the sheet.
  const rHead = push("", "Standard", "Observed", "Test Equipment");
  const rDataStart = aoa.length;
  doc.lines.forEach((l) => push(l.name, l.standard, l.observed, l.equipment));
  const rDataEnd = aoa.length - 1;
  push();

  const rConclusion = push("Conclusion :", doc.conclusion);
  const rResult = push("Result :", doc.resultText);
  // INTERNAL COPY ONLY — coaVm already decided; -1 means "this copy omits it".
  const rRemarks = doc.remarks === null ? -1 : push("Remarks :", doc.remarks);
  push();
  push();
  push();
  const rSign = push(`${COA_SIGN_OFFS[0]} :`, "", `${COA_SIGN_OFFS[1]} :`, "");

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // 3 : 2 : 2 : 2, the sheet's own nine-column split — so the divider after the
  // parameter column lands under the divider after "Product Name :", exactly as
  // it does in the PDF and the print view.
  ws["!cols"] = [{ wch: 48 }, { wch: 32 }, { wch: 32 }, { wch: 32 }];

  const full = (r: number): XLSX.Range => ({ s: { r, c: 0 }, e: { r, c: NCOLS - 1 } });
  const merges: XLSX.Range[] = [full(rCompany), full(rAddr), full(rTitle)];
  for (const r of infoRows) merges.push({ s: { r, c: 1 }, e: { r, c: NCOLS - 1 } });
  if (rBanner >= 0) merges.push(full(rBanner));
  merges.push({ s: { r: rConclusion, c: 1 }, e: { r: rConclusion, c: NCOLS - 1 } });
  merges.push({ s: { r: rResult, c: 1 }, e: { r: rResult, c: NCOLS - 1 } });
  if (rRemarks >= 0) merges.push({ s: { r: rRemarks, c: 1 }, e: { r: rRemarks, c: NCOLS - 1 } });
  merges.push({ s: { r: rSign, c: 0 }, e: { r: rSign, c: 1 } });
  merges.push({ s: { r: rSign, c: 2 }, e: { r: rSign, c: NCOLS - 1 } });
  ws["!merges"] = merges;

  const rowInfo: { hpt: number }[] = [];
  rowInfo[rCompany] = { hpt: 20 };
  rowInfo[rAddr] = { hpt: 26 };
  rowInfo[rTitle] = { hpt: 24 };
  if (rBanner >= 0) rowInfo[rBanner] = { hpt: 24 };
  rowInfo[rHead] = { hpt: 22 };
  rowInfo[rSign] = { hpt: 20 };
  ws["!rows"] = rowInfo;

  styleSpan(ws, rCompany, 0, NCOLS - 1, COMPANY);
  styleSpan(ws, rAddr, 0, NCOLS - 1, ADDR);
  styleSpan(ws, rTitle, 0, NCOLS - 1, TITLE);
  for (const r of infoRows) {
    style(ws, r, 0, LABEL);
    styleSpan(ws, r, 1, NCOLS - 1, VALUE);
  }
  styleSpan(ws, rHead, 0, NCOLS - 1, COLHEAD);
  for (let r = rDataStart; r <= rDataEnd; r++) {
    style(ws, r, 0, CELL_L);
    style(ws, r, 1, CELL_C);
    style(ws, r, 2, CELL_C);
    style(ws, r, 3, CELL_C);
  }
  if (rBanner >= 0) styleSpan(ws, rBanner, 0, NCOLS - 1, BANNER);
  style(ws, rConclusion, 0, LABEL);
  styleSpan(ws, rConclusion, 1, NCOLS - 1, VALUE);
  style(ws, rResult, 0, LABEL);
  styleSpan(ws, rResult, 1, NCOLS - 1, RESULT);
  if (rRemarks >= 0) {
    style(ws, rRemarks, 0, LABEL);
    styleSpan(ws, rRemarks, 1, NCOLS - 1, VALUE);
  }
  styleSpan(ws, rSign, 0, NCOLS - 1, SIGN);

  return ws;
}

/** Download one copy. The sheet is named for the audience so a file opened out of
 *  context still says which copy it is. */
export function exportCoaXlsx(coa: Coa, audience: CoaAudience): void {
  const doc = buildCoaDocument(coa, audience);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFor(doc), audience === "customer" ? "COA" : "COA (Internal)");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  saveAs(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    coaFileName(coa, audience, "xlsx"),
  );
}
