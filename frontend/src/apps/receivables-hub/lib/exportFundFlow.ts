/**
 * exportFundFlow.ts — the month as the 12-sheet "Budgeted Fund Flow Summary" Excel pack.
 *
 * Same sheets, columns and order as the pack PL and BS\FUND FLOW\build_budgeted_fund_flow_summary.py
 * builds, so the file the team already reads looks the same. The cells are LIVE FORMULAS, as in
 * that pack: INR = USD × $B$3, Approved = Budgeted, Balance = Approved − Paid, Achieved % =
 * IF(Approved=0,"",Paid/Approved), the three Customs Duty formulas, SUM subtotals, and a Fund Flow
 * Summary sheet whose every figure is a link into a detail sheet's total ('Import Due'!F8). Change a
 * number in the file and everything above it moves, exactly as in the Excel pack.
 *
 * Each formula cell also carries its computed value (fundFlowCalc), so the file reads correctly in
 * a viewer that does not recalculate.
 *
 * Three things differ from the Excel pack, on purpose:
 *   - no "Adjustment to cashflow total" rows and no Source Checks list: those explained errors in
 *     the Excel cashflow, and Hub's lines are entered directly
 *   - Fund Flow Summary carries Budgeted AND Approved (the pack's "Budgeted" read the Approved cells)
 *   - a carried line shows this month's due (budget less what earlier months paid), with the
 *     earlier payment named in its remarks
 */
import * as XLSX from "xlsx-js-style";
import {
  BLOCKS, HEAD_META, lineValues, monthLong, summarise, type FfHead,
} from "./fundFlowCalc";
import type { FfLine, FfMonth } from "./fundFlow";
import { KIND_LABEL, planChanges } from "./fundFlowPlan";

const INR = "#,##0;(#,##0)";
const USD = "#,##0.00;(#,##0.00)";
const PCT = "0%";

const FILL = (rgb: string) => ({ fgColor: { rgb } });
const S_TITLE = { font: { bold: true, sz: 14, color: { rgb: "FFFFFF" } }, fill: FILL("1F3D5A") };
const S_SUB = { font: { italic: true, sz: 9, color: { rgb: "595959" } } };
const S_HEAD = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: FILL("33527A"), alignment: { wrapText: true, vertical: "center" } };
const S_SEC = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: FILL("39628C") };
const S_SUBTOT = { font: { bold: true }, fill: FILL("D3EAD9") };
const S_TOTAL = { font: { bold: true }, fill: FILL("C6EFCE"), border: { top: { style: "thin", color: { rgb: "BFBFBF" } } } };
const S_NOTE = { font: { italic: true, sz: 9 } };

type Val = string | number | null | undefined;
interface FCell { f: string; v: number | string; z?: string }

const colLetter = (c: number) => XLSX.utils.encode_col(c);

class SheetBuilder {
  ws: XLSX.WorkSheet = {};
  maxR = 0;
  maxC = 0;
  widths: number[] = [];
  constructor(public name: string) {}

  put(r: number, c: number, v: Val | FCell, z?: string, s?: object) {
    if (v == null || v === "") {
      if (!s) return;
      v = "";
    }
    const addr = XLSX.utils.encode_cell({ r: r - 1, c });
    let cell: XLSX.CellObject;
    if (typeof v === "object") {
      const isNum = typeof v.v === "number";
      cell = { t: isNum ? "n" : "s", v: v.v, f: v.f } as XLSX.CellObject;
      const fmt = v.z ?? z;
      if (fmt) cell.z = fmt;
    } else if (typeof v === "number") {
      cell = { t: "n", v } as XLSX.CellObject;
      if (z) cell.z = z;
    } else {
      cell = { t: "s", v } as XLSX.CellObject;
    }
    if (s) (cell as { s?: object }).s = s;
    (this.ws as Record<string, unknown>)[addr] = cell;
    this.maxR = Math.max(this.maxR, r);
    this.maxC = Math.max(this.maxC, c);
  }

  band(r: number, width: number, s: object) {
    for (let c = 0; c < width; c++) {
      const addr = XLSX.utils.encode_cell({ r: r - 1, c });
      const cell = ((this.ws as Record<string, unknown>)[addr] as { s?: object; t?: string; v?: unknown } | undefined) ?? { t: "s", v: "" };
      cell.s = { ...(cell.s ?? {}), ...s };
      (this.ws as Record<string, unknown>)[addr] = cell;
    }
    this.maxR = Math.max(this.maxR, r);
    this.maxC = Math.max(this.maxC, width - 1);
  }

  title(text: string, source: string, width: number) {
    this.put(1, 0, text, undefined, S_TITLE);
    this.band(1, width, S_TITLE);
    this.put(2, 0, source, undefined, S_SUB);
  }

  header(r: number, labels: string[], widths: number[]) {
    labels.forEach((l, c) => this.put(r, c, l, undefined, S_HEAD));
    this.widths = widths;
  }

  finish(): XLSX.WorkSheet {
    this.ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(this.maxR - 1, 0), c: this.maxC } });
    if (this.widths.length) this.ws["!cols"] = this.widths.map((w) => ({ wch: w }));
    return this.ws;
  }
}

const f = (formula: string, v: number | string, z?: string): FCell => ({ f: formula, v, z });
const ach = (paidAddr: string, apprAddr: string, paid: number, appr: number): FCell =>
  f(`IF(${apprAddr}=0,"",${paidAddr}/${apprAddr})`, appr === 0 ? "" : paid / appr, PCT);
const sumF = (col: string, r0: number, r1: number, v: number, z = INR): FCell =>
  r1 >= r0 ? f(`SUM(${col}${r0}:${col}${r1})`, v, z) : f("0", 0, z);

export interface FundFlowExportInput {
  month: FfMonth;
  lines: FfLine[];
  /** Lines that were in the approved plan and have been removed, for "Changes after Plan". */
  removed: FfLine[];
  opening: number;
  openingNote: string;
  bankMemo: { asOf: string; total: number; note: string } | null;
  builtBy: string;
}

/** A totals cell on a detail sheet, for the summary's links. */
interface TotalRef { sheet: string; budget: string; approved: string; paid: string; balance: string }

export function buildFundFlowWorkbook(input: FundFlowExportInput): XLSX.WorkBook {
  const { month } = input;
  // On the Tax sheet the Type column must read the head label for its SUMIF to find the line.
  // A COPY — these rows are the page's query cache and must not be edited in place.
  const lines = input.lines.map((l) =>
    l.head === "tds" || l.head === "gst" ? { ...l, line_type: HEAD_META[l.head].label } : l);
  const rate = month.std_rate;
  const label = monthLong(month.month);
  const built = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).replace(/ /g, "-");
  const src = (what: string) => `Orange Hub - Fund Flow ${label} - ${what}  |  Exported ${built} by ${input.builtBy}`;
  const of = (h: FfHead) => lines.filter((l) => l.head === h);
  // After the plan is approved, a line the CFO has not approved counts 0 approved (see fundFlowCalc).
  const locked = Boolean(month.plan_approved_at);
  const vals = (l: FfLine) => lineValues(l, rate, locked);
  const carriedNote = (l: FfLine, unit: string) =>
    l.paid_before ? `Carried: ${unit} ${l.paid_before.toLocaleString("en-IN")} paid in earlier months` : "";
  const remarks = (l: FfLine, unit = "Rs") => [l.remarks, carriedNote(l, unit), l.changed_after_approval ? "Budget changed after approval" : ""]
    .filter(Boolean).join("; ");
  const totals: Partial<Record<FfHead | "tax" | "collections_sheet", TotalRef>> = {};
  const sheets: { name: string; ws: XLSX.WorkSheet }[] = [];

  // ── Import Due ────────────────────────────────────────────────────────────
  {
    const s = new SheetBuilder("Import Due");
    s.title(`Import Due Payment (Dues) - ${label}`, src("Import Due"), 12);
    s.put(3, 0, "Std rate (INR per USD)", undefined, { font: { bold: true } });
    s.put(3, 1, rate, "0.00");
    s.put(4, 0, "All INR = USD x std rate. Approved defaults to Budgeted.", undefined, S_NOTE);
    s.header(5, ["Type", "Vendor / Description", "USD Budgeted", "INR Budgeted", "USD Approved", "INR Approved", "USD Paid", "INR Paid", "USD Balance", "INR Balance", "Remarks", "Achieved %", "Company"],
      [18, 40, 14, 16, 14, 16, 14, 16, 14, 16, 36, 10, 12]);
    let r = 6;
    const r0 = r;
    for (const l of of("import_due")) {
      const v = vals(l);
      const b = v.budgetUnit - l.paid_before; const a = v.approvedUnit - l.paid_before;
      s.put(r, 0, l.line_type); s.put(r, 1, l.party);
      s.put(r, 2, b, USD); s.put(r, 3, f(`C${r}*$B$3`, b * rate, INR));
      s.put(r, 4, l.amt_approved == null && !l.not_approved_at && !l.paid_before && !locked ? f(`C${r}`, a, USD) : a, USD); s.put(r, 5, f(`E${r}*$B$3`, a * rate, INR));
      s.put(r, 6, v.paidUnit, USD); s.put(r, 7, f(`G${r}*$B$3`, v.paidInr, INR));
      s.put(r, 8, f(`E${r}-G${r}`, a - v.paidUnit, USD)); s.put(r, 9, f(`F${r}-H${r}`, v.balanceInr, INR));
      s.put(r, 10, remarks(l, "USD")); s.put(r, 11, ach(`H${r}`, `F${r}`, v.paidInr, v.approvedInr)); s.put(r, 12, l.company);
      r++;
    }
    const due = of("import_due");
    const sum = summarise(due.map((l) => ({ head: l.head, values: vals(l) })), 0).byHead.import_due;
    const usdB = due.reduce((x, l) => x + vals(l).budgetUnit - l.paid_before, 0);
    const usdA = due.reduce((x, l) => x + vals(l).approvedUnit - l.paid_before, 0);
    const usdP = due.reduce((x, l) => x + vals(l).paidUnit, 0);
    s.put(r, 1, "TOTAL", undefined, S_TOTAL);
    const v: Record<string, number> = { C: usdB, D: sum.budget, E: usdA, F: sum.approved, G: usdP, H: sum.paid, I: usdA - usdP, J: sum.balance };
    for (const [c, col, z] of [[2, "C", USD], [3, "D", INR], [4, "E", USD], [5, "F", INR], [6, "G", USD], [7, "H", INR], [8, "I", USD], [9, "J", INR]] as const) {
      s.put(r, c, sumF(col, r0, r - 1, v[col], z), z, S_TOTAL);
    }
    s.put(r, 11, ach(`H${r}`, `F${r}`, sum.paid, sum.approved), PCT, S_TOTAL);
    s.band(r, 12, S_TOTAL);
    totals.import_due = { sheet: "Import Due", budget: `D${r}`, approved: `F${r}`, paid: `H${r}`, balance: `J${r}` };
    sheets.push({ name: s.name, ws: s.finish() });
  }

  // ── Advances (4 blocks) ───────────────────────────────────────────────────
  {
    const s = new SheetBuilder("Advances");
    s.title(`Import Advance Payment - ${label}`, src("Advances"), 15);
    s.put(3, 0, "Std rate (INR per USD)", undefined, { font: { bold: true } });
    s.put(3, 1, rate, "0.00");
    s.put(4, 0, "All INR = USD x std rate, budget and paid. Approved defaults to Budgeted.", undefined, S_NOTE);
    s.header(5, ["Block", "Party Name", "PI No.", "Description", "Amount (USD)", "Budgeted (INR)", "USD Approved", "INR Approved", "Paid (USD)", "Paid (INR)", "USD Balance", "Balance (INR)", "Payment Terms", "Status / Paid date", "Achieved %"],
      [24, 30, 18, 40, 14, 16, 14, 16, 14, 16, 14, 16, 40, 28, 10]);
    let r = 6;
    const subRows: number[] = [];
    const adv = of("import_advance");
    for (const b of BLOCKS) {
      const rows = adv.filter((l) => l.block === b.block);
      s.put(r, 0, b.label, undefined, S_SEC); s.band(r, 15, S_SEC); r++;
      const r0 = r;
      for (const l of rows) {
        const v = vals(l);
        const bu = v.budgetUnit - l.paid_before; const a = v.approvedUnit - l.paid_before;
        s.put(r, 0, b.short); s.put(r, 1, l.party); s.put(r, 2, l.ref_no); s.put(r, 3, l.description);
        s.put(r, 4, bu, USD); s.put(r, 5, f(`E${r}*$B$3`, bu * rate, INR));
        s.put(r, 6, l.amt_approved == null && !l.not_approved_at && !l.paid_before && !locked ? f(`E${r}`, a, USD) : a, USD); s.put(r, 7, f(`G${r}*$B$3`, a * rate, INR));
        s.put(r, 8, v.paidUnit, USD); s.put(r, 9, f(`I${r}*$B$3`, v.paidInr, INR));
        s.put(r, 10, f(`G${r}-I${r}`, a - v.paidUnit, USD)); s.put(r, 11, f(`H${r}-J${r}`, v.balanceInr, INR));
        s.put(r, 12, l.terms); s.put(r, 13, [l.status_note, remarks(l, "USD")].filter(Boolean).join(" / "));
        s.put(r, 14, ach(`J${r}`, `H${r}`, v.paidInr, v.approvedInr));
        r++;
      }
      const t = summarise(rows.map((l) => ({ head: l.head, values: vals(l) })), 0).byHead.import_advance;
      const usd = (k: "budgetUnit" | "approvedUnit" | "paidUnit") => rows.reduce((x, l) => {
        const v = vals(l); return x + (k === "paidUnit" ? v.paidUnit : v[k] - l.paid_before);
      }, 0);
      s.put(r, 3, `Subtotal - ${b.label}`, undefined, S_SUBTOT);
      const map: [number, string, number, string][] = [
        [4, "E", usd("budgetUnit"), USD], [5, "F", t.budget, INR], [6, "G", usd("approvedUnit"), USD], [7, "H", t.approved, INR],
        [8, "I", usd("paidUnit"), USD], [9, "J", t.paid, INR], [10, "K", usd("approvedUnit") - usd("paidUnit"), USD], [11, "L", t.balance, INR]];
      for (const [c, col, v, z] of map) s.put(r, c, sumF(col, r0, r - 1, v, z), z, S_SUBTOT);
      s.put(r, 14, ach(`J${r}`, `H${r}`, t.paid, t.approved), PCT, S_SUBTOT);
      s.band(r, 15, S_SUBTOT);
      subRows.push(r);
      r += 2;
    }
    const t = summarise(adv.map((l) => ({ head: l.head, values: vals(l) })), 0).byHead.import_advance;
    const aB = adv.reduce((x, l) => x + vals(l).budgetUnit - l.paid_before, 0);
    const aA = adv.reduce((x, l) => x + vals(l).approvedUnit - l.paid_before, 0);
    const aP = adv.reduce((x, l) => x + vals(l).paidUnit, 0);
    s.put(r, 3, "TOTAL - IMPORT ADVANCE PAYMENT", undefined, S_TOTAL);
    for (const [c, col, v, z] of [[4, "E", aB, USD], [5, "F", t.budget, INR], [6, "G", aA, USD], [7, "H", t.approved, INR], [8, "I", aP, USD], [9, "J", t.paid, INR], [10, "K", aA - aP, USD], [11, "L", t.balance, INR]] as const) {
      s.put(r, c, f(subRows.map((x) => `${col}${x}`).join("+"), v, z), z, S_TOTAL);
    }
    s.put(r, 14, ach(`J${r}`, `H${r}`, t.paid, t.approved), PCT, S_TOTAL);
    s.band(r, 15, S_TOTAL);
    totals.import_advance = { sheet: "Advances", budget: `F${r}`, approved: `H${r}`, paid: `J${r}`, balance: `L${r}` };
    sheets.push({ name: s.name, ws: s.finish() });
  }

  // ── Customs Duty ──────────────────────────────────────────────────────────
  {
    const s = new SheetBuilder("Customs Duty");
    s.title(`Customs Duty and GST - ${label}`, src("Customs Duty"), 16);
    s.put(3, 0, "Std rate (INR per USD)", undefined, { font: { bold: true } });
    s.put(3, 1, rate, "0.00");
    s.put(4, 0, "Inv. INR = USD x std rate. Duty: (Inv INR + Freight) x Duty % where freight is in the base; Inv INR x Duty % + Freight where it is added; or the duty as quoted.", undefined, S_NOTE);
    s.header(5, ["Company", "Date", "Party", "Invoice No.", "Item", "Description", "Inv. Value (USD)", "Inv. Value (INR)", "Duty %", "Duty+GST Payable (INR)", "Freight (INR)", "Total (INR)", "Paid (INR)", "Balance (INR)", "Remarks", "Formula"],
      [12, 11, 22, 22, 10, 36, 14, 16, 8, 16, 14, 16, 16, 16, 36, 18]);
    let r = 6;
    const r0 = r;
    const rows = of("customs_duty");
    for (const l of rows) {
      const v = vals(l);
      const extra = l.extra_inr ? `+${l.extra_inr}` : "";
      const before = l.paid_before ? `-${l.paid_before}` : "";
      s.put(r, 0, l.company); s.put(r, 1, l.doc_date ? l.doc_date.split("-").reverse().join(".") : "");
      s.put(r, 2, l.party); s.put(r, 3, l.ref_no); s.put(r, 4, l.item); s.put(r, 5, l.description);
      s.put(r, 6, l.inv_usd ?? 0, USD); s.put(r, 7, f(`G${r}*$B$3`, v.invInr ?? 0, INR));
      if (l.duty_mode !== "typed") s.put(r, 8, l.duty_pct ?? 0, "0.00%");
      if (l.duty_mode === "typed") s.put(r, 9, l.duty_typed_inr ?? 0, INR);
      else if (l.duty_mode === "freight_added") s.put(r, 9, f(`H${r}*I${r}`, v.dutyInr ?? 0, INR));
      else s.put(r, 9, f(`(H${r}+K${r})*I${r}`, v.dutyInr ?? 0, INR));
      s.put(r, 10, l.freight_inr ?? 0, INR);
      let total: Val | FCell;
      const approvedTotal = v.approvedUnit - l.paid_before;
      if (l.amt_approved != null || l.amt_budget != null || l.not_approved_at || locked) total = approvedTotal;
      else if (l.not_this_month) total = 0;
      else if (l.duty_mode === "freight_added") total = f(`J${r}+K${r}${extra}${before}`, approvedTotal, INR);
      else total = f(`J${r}${extra}${before}`, approvedTotal, INR);
      s.put(r, 11, total, INR);
      s.put(r, 12, l.paid_in_full ? f(`L${r}`, v.paidInr, INR) : v.paidInr, INR);
      s.put(r, 13, f(`L${r}-M${r}`, v.balanceInr, INR));
      s.put(r, 14, [remarks(l), l.not_this_month ? "Not budgeted this month" : "", l.not_approved_at ? "Not approved by CFO" : l.amt_approved != null ? "Total as approved by CFO" : l.amt_budget != null ? "Total as quoted" : ""].filter(Boolean).join("; "));
      s.put(r, 15, l.duty_mode === "typed" ? "Typed amount" : l.duty_mode === "freight_added" ? "Freight added" : "Freight in base");
      r++;
    }
    const t = summarise(rows.map((l) => ({ head: l.head, values: vals(l) })), 0).byHead.customs_duty;
    s.put(r, 5, "TOTAL", undefined, S_TOTAL);
    const usd = rows.reduce((x, l) => x + (l.inv_usd ?? 0), 0);
    for (const [c, col, v, z] of [[6, "G", usd, USD], [7, "H", usd * rate, INR], [9, "J", rows.reduce((x, l) => x + (vals(l).dutyInr ?? 0), 0), INR], [10, "K", rows.reduce((x, l) => x + (l.freight_inr ?? 0), 0), INR], [11, "L", t.approved, INR], [12, "M", t.paid, INR], [13, "N", t.balance, INR]] as const) {
      s.put(r, c, sumF(col, r0, r - 1, v, z), z, S_TOTAL);
    }
    s.band(r, 16, S_TOTAL);
    // Customs has no separate approved column: Total IS the approved figure, as in the pack.
    totals.customs_duty = { sheet: "Customs Duty", budget: `L${r}`, approved: `L${r}`, paid: `M${r}`, balance: `N${r}` };
    sheets.push({ name: s.name, ws: s.finish() });
  }

  // ── INR sheets: EMI, Other Vendor, Tax and Statutory, Investment-Loan, Monthly Fixed Expenses ──
  const inrSheet = (name: string, heading: string, heads: FfHead[], withLoan: boolean) => {
    const s = new SheetBuilder(name);
    const width = withLoan ? 9 : 10;
    s.title(`${heading} - ${label}`, src(name), width);
    const labels = withLoan
      ? ["Type", "Loan / Description", "INR Budgeted", "INR Approved", "INR Paid", "INR Balance", "Loan O/s (INR)", "Remarks", "Achieved %"]
      : ["Type", "Vendor / Description", "INR Budgeted", "INR Approved", "INR Paid", "INR Balance", "Remarks", "Achieved %", "Company", "Tally due (INR)"];
    s.header(4, labels, withLoan ? [14, 44, 16, 16, 16, 16, 16, 40, 10] : [22, 50, 16, 16, 16, 16, 40, 10, 12, 16]);
    let r = 5;
    const r0 = r;
    const perHead: Record<string, number> = {};
    const rows = lines.filter((l) => heads.includes(l.head));
    for (const l of rows) {
      const v = vals(l);
      perHead[l.head] = perHead[l.head] ?? r;
      s.put(r, 0, l.line_type ?? (heads.length > 1 ? HEAD_META[l.head].label : "")); s.put(r, 1, l.party ?? l.description);
      s.put(r, 2, v.budgetInr, INR);
      s.put(r, 3, l.amt_approved == null && !l.not_approved_at && !locked ? f(`C${r}`, v.approvedInr, INR) : v.approvedInr, INR);
      s.put(r, 4, v.paidInr, INR); s.put(r, 5, f(`D${r}-E${r}`, v.balanceInr, INR));
      const ac = withLoan ? 8 : 7;
      if (withLoan) { s.put(r, 6, l.loan_os, INR); s.put(r, 7, remarks(l)); }
      else {
        s.put(r, 6, [remarks(l), v.paidInr > v.approvedInr + 0.5 ? "Paid exceeds budget" : ""].filter(Boolean).join("; "));
        s.put(r, 8, l.company); s.put(r, 9, l.tally_due_inr, INR);
      }
      s.put(r, ac, ach(`E${r}`, `D${r}`, v.paidInr, v.approvedInr));
      r++;
    }
    const t = summarise(rows.map((l) => ({ head: l.head, values: vals(l) })), 0);
    const tot = heads.reduce((acc, h) => ({ b: acc.b + t.byHead[h].budget, a: acc.a + t.byHead[h].approved, p: acc.p + t.byHead[h].paid }), { b: 0, a: 0, p: 0 });
    s.put(r, 1, withLoan ? "TOTAL EMI" : "TOTAL", undefined, S_TOTAL);
    for (const [c, col, v] of [[2, "C", tot.b], [3, "D", tot.a], [4, "E", tot.p], [5, "F", tot.a - tot.p]] as const) s.put(r, c, sumF(col, r0, r - 1, v), INR, S_TOTAL);
    if (withLoan) s.put(r, 6, sumF("G", r0, r - 1, rows.reduce((x, l) => x + (l.loan_os ?? 0), 0)), INR, S_TOTAL);
    s.put(r, withLoan ? 8 : 7, ach(`E${r}`, `D${r}`, tot.p, tot.a), PCT, S_TOTAL);
    s.band(r, width, S_TOTAL);
    const totalRow = r;
    // Tax and Statutory carries TDS and GST as separate summary lines: a SUMIF per head.
    if (heads.length > 1) {
      r += 2;
      s.put(r, 0, "By head", undefined, { font: { bold: true } }); r++;
      for (const h of heads) {
        const lbl = HEAD_META[h].label;
        const hv = t.byHead[h];
        s.put(r, 0, lbl);
        s.put(r, 2, f(`SUMIF($A$${r0}:$A$${totalRow - 1},"${lbl}",C$${r0}:C$${totalRow - 1})`, hv.budget, INR), INR);
        s.put(r, 3, f(`SUMIF($A$${r0}:$A$${totalRow - 1},"${lbl}",D$${r0}:D$${totalRow - 1})`, hv.approved, INR), INR);
        s.put(r, 4, f(`SUMIF($A$${r0}:$A$${totalRow - 1},"${lbl}",E$${r0}:E$${totalRow - 1})`, hv.paid, INR), INR);
        s.put(r, 5, f(`D${r}-E${r}`, hv.balance, INR), INR);
        totals[h] = { sheet: name, budget: `C${r}`, approved: `D${r}`, paid: `E${r}`, balance: `F${r}` };
        r++;
      }
    } else {
      totals[heads[0]] = { sheet: name, budget: `C${totalRow}`, approved: `D${totalRow}`, paid: `E${totalRow}`, balance: `F${totalRow}` };
    }
    sheets.push({ name, ws: s.finish() });
  };
  inrSheet("EMI", "EMI and Loan Repayment", ["emi"], true);
  inrSheet("Other Vendor", "Local Vendor and Other Vendor Payments", ["other_vendor"], false);
  inrSheet("Local Advance", "Local Advance Payment", ["local_advance"], false);
  inrSheet("Tax and Statutory", "Advance Tax, TDS/TCS and GST", ["tds", "gst"], false);
  inrSheet("Investment-Loan", "Investment / Loan Activity", ["investment"], false);
  inrSheet("Monthly Fixed Expenses", "Monthly Fixed and Overhead Expenses", ["fixed_expense"], false);

  // ── Machine Advance Receivable ────────────────────────────────────────────
  {
    const s = new SheetBuilder("Machine Advance Receivable");
    s.title(`Machine Advance Receivable from Customers - ${label}`, src("Machine Advance Receivable"), 10);
    s.header(4, ["Sales Person", "Customer Name", "Machine", "Projected (INR)", "Approved (INR)", "Received (INR)", "Pending (INR)", "Expected date", "Follow-up note", "Achieved %"],
      [14, 44, 16, 16, 16, 16, 16, 12, 30, 10]);
    let r = 5;
    const r0 = r;
    const rows = of("machine_advance");
    for (const l of rows) {
      const v = vals(l);
      s.put(r, 0, l.sales_person); s.put(r, 1, l.party); s.put(r, 2, l.machine);
      s.put(r, 3, v.budgetInr, INR); s.put(r, 4, l.amt_approved == null && !l.not_approved_at && !locked ? f(`D${r}`, v.approvedInr, INR) : v.approvedInr, INR);
      s.put(r, 5, v.paidInr, INR); s.put(r, 6, f(`E${r}-F${r}`, v.balanceInr, INR));
      s.put(r, 7, l.expected_date ? l.expected_date.split("-").reverse().join("-") : "");
      s.put(r, 8, [l.follow_up, v.paidInr > v.approvedInr + 0.5 ? "Received exceeds projection" : ""].filter(Boolean).join("; "));
      s.put(r, 9, ach(`F${r}`, `E${r}`, v.paidInr, v.approvedInr));
      r++;
    }
    const t = summarise(rows.map((l) => ({ head: l.head, values: vals(l) })), 0).byHead.machine_advance;
    s.put(r, 1, "TOTAL", undefined, S_TOTAL);
    for (const [c, col, v] of [[3, "D", t.budget], [4, "E", t.approved], [5, "F", t.paid], [6, "G", t.balance]] as const) s.put(r, c, sumF(col, r0, r - 1, v), INR, S_TOTAL);
    s.put(r, 9, ach(`F${r}`, `E${r}`, t.paid, t.approved), PCT, S_TOTAL);
    s.band(r, 10, S_TOTAL);
    totals.machine_advance = { sheet: "Machine Advance Receivable", budget: `D${r}`, approved: `E${r}`, paid: `F${r}`, balance: `G${r}` };
    sheets.push({ name: s.name, ws: s.finish() });
  }

  // ── Collections ───────────────────────────────────────────────────────────
  const sumAll = summarise(lines.map((l) => ({ head: l.head, values: vals(l) })), input.opening);
  {
    const s = new SheetBuilder("Collections");
    s.title(`Receipts - Customer Collections and Advances - ${label}`, src("Collections"), 7);
    s.header(4, ["Particulars", "Total Due / Order Book", `${label.slice(0, 3)} Targeted`, "Received", "Balance", "Achieved %", "Remarks"], [50, 18, 18, 18, 18, 10, 50]);
    s.put(5, 0, `Opening Balance (${input.openingNote})`); s.put(5, 2, input.opening, INR); s.put(5, 3, f("C5", input.opening, INR)); s.put(5, 4, f("C5", input.opening, INR));
    const ma = totals.machine_advance as TotalRef;
    const mav = sumAll.byHead.machine_advance;
    s.put(6, 0, "Advance from Customer (Machine Advances)");
    s.put(6, 2, f(`'${ma.sheet}'!${ma.approved}`, mav.approved, INR)); s.put(6, 3, f(`'${ma.sheet}'!${ma.paid}`, mav.paid, INR));
    s.put(6, 4, f("C6-D6", mav.balance, INR)); s.put(6, 5, ach("D6", "C6", mav.paid, mav.approved));
    const col = of("collection");
    const cv = sumAll.byHead.collection;
    const linkNote = col.find((l) => l.link_as_at)
      ? `Linked to the Salesperson Collection Report, as at ${new Date(col.find((l) => l.link_as_at)!.link_as_at!).toLocaleString("en-IN")}`
      : "";
    s.put(7, 0, "Customer Collections"); s.put(7, 1, col.reduce((x, l) => x + (l.total_due ?? l.link_due_inr ?? 0), 0) || null, INR);
    s.put(7, 2, cv.approved, INR); s.put(7, 3, cv.paid, INR); s.put(7, 4, f("C7-D7", cv.balance, INR)); s.put(7, 5, ach("D7", "C7", cv.paid, cv.approved));
    s.put(7, 6, [linkNote, ...col.map((l) => l.override_reason ? `Target override: ${l.override_reason}` : "").filter(Boolean)].filter(Boolean).join("; "));
    const rv = sumAll.byHead.refund;
    s.put(8, 0, "Refunds / Compensation"); s.put(8, 2, rv.approved, INR); s.put(8, 3, rv.paid, INR); s.put(8, 4, f("C8-D8", rv.balance, INR)); s.put(8, 5, ach("D8", "C8", rv.paid, rv.approved));
    s.put(10, 0, "TOTAL COLLECTION (Advance + Customer Collections + Refunds)", undefined, S_TOTAL);
    s.put(10, 2, f("C6+C7+C8", sumAll.totalCollection.approved, INR), INR, S_TOTAL);
    s.put(10, 3, f("D6+D7+D8", sumAll.totalCollection.paid, INR), INR, S_TOTAL);
    s.put(10, 4, f("E6+E7+E8", sumAll.totalCollection.balance, INR), INR, S_TOTAL);
    s.put(10, 5, ach("D10", "C10", sumAll.totalCollection.paid, sumAll.totalCollection.approved), PCT, S_TOTAL);
    s.band(10, 7, S_TOTAL);
    if (input.bankMemo) {
      s.put(13, 0, `Memo: bank balance on ${input.bankMemo.asOf} (Daily Report)`); s.put(13, 3, input.bankMemo.total, INR); s.put(13, 6, input.bankMemo.note);
    }
    totals.collections_sheet = { sheet: "Collections", budget: "C10", approved: "C10", paid: "D10", balance: "E10" };
    sheets.push({ name: s.name, ws: s.finish() });
  }

  // ── Fund Flow Summary (links into the detail sheets) ──────────────────────
  const summary = new SheetBuilder("Fund Flow Summary");
  {
    const s = summary;
    s.title(`Budgeted Fund Flow Summary - ${label}`, src("every figure links to a detail sheet"), 6);
    s.header(4, ["Particulars", "Budgeted (INR)", "Approved (INR)", "Paid / Received (INR)", "Balance (INR)", "Achieved %"], [52, 18, 18, 20, 18, 10]);
    s.put(5, 0, `Opening Balance (${input.openingNote})`, undefined, { font: { bold: true } });
    s.put(5, 1, f("Collections!C5", input.opening, INR)); s.put(5, 2, f("Collections!C5", input.opening, INR)); s.put(5, 3, f("Collections!D5", input.opening, INR));
    let r = 7;
    s.put(r, 0, "PAYMENTS", undefined, S_SEC); s.band(r, 6, S_SEC); r++;
    const link = (row: number, title: string, ref: TotalRef, fig: { budget: number; approved: number; paid: number; balance: number }) => {
      const q = `'${ref.sheet}'!`;
      s.put(row, 0, title);
      s.put(row, 1, f(`${q}${ref.budget}`, fig.budget, INR)); s.put(row, 2, f(`${q}${ref.approved}`, fig.approved, INR));
      s.put(row, 3, f(`${q}${ref.paid}`, fig.paid, INR)); s.put(row, 4, f(`${q}${ref.balance}`, fig.balance, INR));
      s.put(row, 5, ach(`D${row}`, `C${row}`, fig.paid, fig.approved));
    };
    const sub = (row: number, title: string, from: number, to: number, fig: { budget: number; approved: number; paid: number; balance: number }) => {
      s.put(row, 0, title, undefined, S_SUBTOT);
      for (const [c, col, v] of [[1, "B", fig.budget], [2, "C", fig.approved], [3, "D", fig.paid], [4, "E", fig.balance]] as const) s.put(row, c, f(`SUM(${col}${from}:${col}${to})`, v, INR), INR, S_SUBTOT);
      s.put(row, 5, ach(`D${row}`, `C${row}`, fig.paid, fig.approved), PCT, S_SUBTOT);
      s.band(row, 6, S_SUBTOT);
    };
    const B = sumAll.byHead;
    link(8, HEAD_META.import_due.label, totals.import_due!, B.import_due);
    link(9, HEAD_META.import_advance.label, totals.import_advance!, B.import_advance);
    link(10, HEAD_META.local_advance.label, totals.local_advance!, B.local_advance);
    sub(11, "Subtotal - Import and Local Advance Payments", 8, 10, sumAll.subA);
    link(13, HEAD_META.customs_duty.label, totals.customs_duty!, B.customs_duty);
    link(14, HEAD_META.emi.label, totals.emi!, B.emi);
    link(15, HEAD_META.other_vendor.label, totals.other_vendor!, B.other_vendor);
    sub(16, "Subtotal - Duty, EMI and Other Vendors", 13, 15, sumAll.subB);
    link(18, "TDS", totals.tds!, B.tds);
    link(19, "GST", totals.gst!, B.gst);
    sub(20, "Subtotal - Tax and Statutory", 18, 19, sumAll.subC);
    link(22, HEAD_META.investment.label, totals.investment!, B.investment);
    link(23, HEAD_META.fixed_expense.label, totals.fixed_expense!, B.fixed_expense);
    s.put(25, 0, "TOTAL PAYMENT", undefined, S_TOTAL);
    const tp = sumAll.totalPayment;
    for (const [c, col, v] of [[1, "B", tp.budget], [2, "C", tp.approved], [3, "D", tp.paid], [4, "E", tp.balance]] as const) {
      s.put(25, c, f(`${col}11+${col}16+${col}20+${col}22+${col}23`, v, INR), INR, S_TOTAL);
    }
    s.put(25, 5, ach("D25", "C25", tp.paid, tp.approved), PCT, S_TOTAL);
    s.band(25, 6, S_TOTAL);
    s.put(27, 0, "RECEIPTS", undefined, S_SEC); s.band(27, 6, S_SEC);
    const rowLink = (row: number, title: string, src: string, fig: { budget: number; approved: number; paid: number; balance: number }) => {
      s.put(row, 0, title);
      s.put(row, 1, f(`Collections!C${src}`, fig.approved, INR)); s.put(row, 2, f(`Collections!C${src}`, fig.approved, INR));
      s.put(row, 3, f(`Collections!D${src}`, fig.paid, INR)); s.put(row, 4, f(`Collections!E${src}`, fig.balance, INR));
      s.put(row, 5, ach(`D${row}`, `C${row}`, fig.paid, fig.approved));
    };
    rowLink(28, HEAD_META.machine_advance.label, "6", B.machine_advance);
    rowLink(29, `Customer Collections (${label.slice(0, 3)}-${label.slice(-2)} targeted)`, "7", B.collection);
    rowLink(30, HEAD_META.refund.label, "8", B.refund);
    s.put(31, 0, "TOTAL COLLECTION", undefined, S_TOTAL);
    const tc = sumAll.totalCollection;
    for (const [c, col, v] of [[1, "B", tc.approved], [2, "C", tc.approved], [3, "D", tc.paid], [4, "E", tc.balance]] as const) s.put(31, c, f(`SUM(${col}28:${col}30)`, v, INR), INR, S_TOTAL);
    s.put(31, 5, ach("D31", "C31", tc.paid, tc.approved), PCT, S_TOTAL);
    s.band(31, 6, S_TOTAL);
    s.put(33, 0, "CLOSING BALANCE (Opening + Collection - Payment)", undefined, S_TOTAL);
    s.put(33, 2, f("C5+C31-C25", sumAll.closingBudget, INR), INR, S_TOTAL);
    s.put(33, 3, f("D5+D31-D25", sumAll.closingPaid, INR), INR, S_TOTAL);
    s.band(33, 6, S_TOTAL);
    s.put(34, 0, "Still to collect less still to pay (Balance column)"); s.put(34, 4, f("E31-E25", sumAll.netToCome, INR), INR);
    if (input.bankMemo) {
      s.put(36, 0, `Memo: actual bank balance on ${input.bankMemo.asOf} (Daily Report)`); s.put(36, 3, f("Collections!D13", input.bankMemo.total, INR), INR);
      s.put(37, 0, "Memo: paid-basis closing less actual bank balance"); s.put(37, 3, f("D33-D36", sumAll.closingPaid - input.bankMemo.total, INR), INR);
    }
    s.put(39, 0, `Approved = the CFO's figure; it follows Budgeted until approved. Totals, balance and closing run on Approved. Std rate ${rate} INR per USD.`, undefined, S_NOTE);

    // POSITION — the user's one-glance layout (24-Oct-2026), as formulas on the rows above.
    const YEL = { fill: FILL("FFFF00"), font: { bold: true } };
    const RED = { fill: FILL("FFC7CE"), font: { bold: true, color: { rgb: "9C0006" } } };
    s.put(41, 0, "POSITION", undefined, S_SEC); s.band(41, 6, S_SEC);
    s.put(42, 0, "", undefined, S_HEAD);
    ["", "Budgeted (approved)", "Paid / Received", "Balance", "%"].forEach((h, i) => { if (i) s.put(42, i + 1, h, undefined, S_HEAD); });
    const tp2 = sumAll.totalPayment, tc2 = sumAll.totalCollection;
    const closingBal = input.opening + tc2.balance - tp2.balance;
    s.put(43, 0, "Opening Balance");
    s.put(43, 2, f("C5", input.opening, INR), INR); s.put(43, 3, f("D5", input.opening, INR), INR); s.put(43, 4, f("C5", input.opening, INR), INR);
    s.put(44, 0, "Total Payment");
    s.put(44, 2, f("C25", tp2.approved, INR), INR); s.put(44, 3, f("D25", tp2.paid, INR), INR); s.put(44, 4, f("E25", tp2.balance, INR), INR);
    s.put(44, 5, ach("D44", "C44", tp2.paid, tp2.approved), PCT, YEL);
    s.put(45, 0, "Total Collection");
    s.put(45, 2, f("C31", tc2.approved, INR), INR); s.put(45, 3, f("D31", tc2.paid, INR), INR); s.put(45, 4, f("E31", tc2.balance, INR), INR);
    s.put(45, 5, ach("D45", "C45", tc2.paid, tc2.approved), PCT, YEL);
    s.put(46, 0, "Closing Balance", undefined, S_TOTAL);
    s.put(46, 2, f("C43+C45-C44", sumAll.closingBudget, INR), INR, YEL);
    s.put(46, 3, f("D43+D45-D44", sumAll.closingPaid, INR), INR, S_TOTAL);
    s.put(46, 4, f("E43+E45-E44", closingBal, INR), INR, S_TOTAL);
    s.put(47, 0, `Balance as on ${input.bankMemo?.asOf ?? "today"} (Daily Report)`, undefined, { font: { bold: true } });
    s.put(48, 0, "Difference (paid-basis closing less bank)", undefined, { font: { bold: true } });
    if (input.bankMemo) {
      const bank = input.bankMemo.total, diff = sumAll.closingPaid - bank;
      s.put(47, 3, f("Collections!D13", bank, INR), INR, bank ? { font: { bold: true } } : RED);
      s.put(48, 3, f("D46-D47", diff, INR), INR, Math.abs(diff) >= 1 ? RED : { font: { bold: true } });
    } else {
      s.put(47, 3, "not entered", undefined, RED);
    }
  }

  // ── Index ─────────────────────────────────────────────────────────────────
  const idx = new SheetBuilder("Index");
  {
    const s = idx;
    s.title(`Budgeted Fund Flow - ${label}`, `Orange O Tec / Colorix Group  |  Orange Hub Fund Flow (${month.status === "closed" ? "closed" : "open"})  |  ${built}`, 4);
    s.header(4, ["Headline", "", "Approved (INR)", "Paid / Received (INR)"], [44, 60, 20, 20]);
    const ff = "'Fund Flow Summary'!";
    s.put(5, 0, `Opening Balance (${input.openingNote})`); s.put(5, 2, f(`${ff}C5`, input.opening, INR)); s.put(5, 3, f(`${ff}D5`, input.opening, INR));
    s.put(6, 0, "Total Payment"); s.put(6, 2, f(`${ff}C25`, sumAll.totalPayment.approved, INR)); s.put(6, 3, f(`${ff}D25`, sumAll.totalPayment.paid, INR));
    s.put(7, 0, "Total Collection"); s.put(7, 2, f(`${ff}C31`, sumAll.totalCollection.approved, INR)); s.put(7, 3, f(`${ff}D31`, sumAll.totalCollection.paid, INR));
    s.put(8, 0, "Closing Balance"); s.put(8, 2, f(`${ff}C33`, sumAll.closingBudget, INR)); s.put(8, 3, f(`${ff}D33`, sumAll.closingPaid, INR));
    s.put(10, 0, "Sheet", undefined, S_HEAD); s.put(10, 1, "Contents", undefined, S_HEAD); s.put(10, 2, "Approved (INR)", undefined, S_HEAD); s.put(10, 3, "Paid (INR)", undefined, S_HEAD);
    const list: [string, string, TotalRef | undefined, { approved: number; paid: number }][] = [
      ["Fund Flow Summary", "Opening, payments by head, receipts, closing", undefined, { approved: sumAll.totalPayment.approved, paid: sumAll.totalPayment.paid }],
      ["Import Due", "Supplier dues in USD - this month's budget and paid", totals.import_due, sumAll.byHead.import_due],
      ["Advances", "Import advances: new machine orders, ink, against BL/arrival, spare parts", totals.import_advance, sumAll.byHead.import_advance],
      ["Customs Duty", "Shipment-wise duty + GST + freight", totals.customs_duty, sumAll.byHead.customs_duty],
      ["EMI", "Machine financing, vehicle and bank loan EMIs", totals.emi, sumAll.byHead.emi],
      ["Other Vendor", "Local and other vendor payments", totals.other_vendor, sumAll.byHead.other_vendor],
      ["Local Advance", "Local advance payments", totals.local_advance, sumAll.byHead.local_advance],
      ["Tax and Statutory", "Advance tax, TDS/TCS, GST", undefined, sumAll.subC],
      ["Investment-Loan", "Investments, loan / limit activity", totals.investment, sumAll.byHead.investment],
      ["Monthly Fixed Expenses", "Salary, incentive, commission, rent, exhibitions, bank charges, etc.", totals.fixed_expense, sumAll.byHead.fixed_expense],
      ["Machine Advance Receivable", "Customer-wise machine advances to receive", totals.machine_advance, sumAll.byHead.machine_advance],
      ["Collections", "Opening balance, machine advances, customer collections, refunds", totals.collections_sheet, sumAll.totalCollection],
    ];
    let r = 11;
    for (const [name, what, ref, fig] of list) {
      s.put(r, 0, name); s.put(r, 1, what);
      if (name === "Fund Flow Summary") { s.put(r, 2, f(`${ff}C25`, fig.approved, INR)); s.put(r, 3, f(`${ff}D25`, fig.paid, INR)); }
      else if (name === "Tax and Statutory") { s.put(r, 2, f(`${ff}C20`, fig.approved, INR)); s.put(r, 3, f(`${ff}D20`, fig.paid, INR)); }
      else if (ref) { s.put(r, 2, f(`'${ref.sheet}'!${ref.approved}`, fig.approved, INR)); s.put(r, 3, f(`'${ref.sheet}'!${ref.paid}`, fig.paid, INR)); }
      r++;
    }
    const flagged = lines.filter((l) => l.changed_after_approval);
    if (flagged.length) {
      r++;
      s.put(r, 0, `${flagged.length} line(s) had their budget changed after the CFO approved them - see the Remarks column.`, undefined, S_NOTE);
    }
  }

  // ── Changes after Plan ────────────────────────────────────────────────────
  let planWs: XLSX.WorkSheet | null = null;
  if (locked) {
    const s = new SheetBuilder("Changes after Plan");
    const { rows, bridge: b } = planChanges(month, lines, input.removed);
    s.title(`Changes after Plan - ${label}`, src(`plan approved ${new Date(month.plan_approved_at!).toLocaleString("en-IN")}`), 9);
    s.put(3, 0, "INR at the current std rate, net of what earlier months paid. Effect = Approved now - In plan.", undefined, S_NOTE);
    s.header(5, ["Change", "Sheet", "Line", "In plan (INR)", "Approved now (INR)", "Effect (INR)", "Budget typed (INR)", "Status", "Remarks"],
      [18, 22, 44, 16, 16, 16, 16, 34, 36]);
    let r = 6;
    const r0 = r;
    for (const x of rows) {
      s.put(r, 0, KIND_LABEL[x.kind]); s.put(r, 1, x.sheet); s.put(r, 2, x.name);
      s.put(r, 3, x.plan, INR); s.put(r, 4, x.approved, INR); s.put(r, 5, f(`E${r}-D${r}`, x.effect, INR)); s.put(r, 6, x.budget, INR);
      s.put(r, 7, x.status); s.put(r, 8, x.remarks);
      r++;
    }
    s.put(r, 2, "TOTAL OF CHANGES", undefined, S_TOTAL);
    s.put(r, 5, sumF("F", r0, r - 1, rows.reduce((t, x) => t + x.effect, 0)), INR, S_TOTAL);
    s.band(r, 9, S_TOTAL);
    r += 2;
    s.put(r, 0, "Bridge", undefined, S_SEC); s.band(r, 9, S_SEC); r++;
    const br: [string, number][] = [["Approved plan", b.plan], ["+ Added after plan (approved)", b.added], ["- Removed from plan", b.removed],
      ["+/- Amounts changed (approved)", b.changed], ["= Approved now", b.current]];
    for (const [t, v] of br) { s.put(r, 2, t); s.put(r, 3, v, INR); r++; }
    s.put(r - 1, 3, f(`D${r - 5}+D${r - 4}-D${r - 3}+D${r - 2}`, b.current, INR), INR, S_TOTAL);
    r++;
    s.put(r, 2, "Awaiting CFO - additions (budget)"); s.put(r, 3, b.pendingAdd, INR); r++;
    s.put(r, 2, "Awaiting CFO - changes (budget less approved)"); s.put(r, 3, b.pendingChange, INR); r++;
    s.put(r, 2, "Awaiting CFO - removals asked (approved)"); s.put(r, 3, b.pendingRemove, INR);
    planWs = s.finish();
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, idx.finish(), "Index");
  XLSX.utils.book_append_sheet(wb, summary.finish(), "Fund Flow Summary");
  const order = ["Import Due", "Advances", "Customs Duty", "EMI", "Other Vendor", "Local Advance", "Tax and Statutory", "Investment-Loan", "Monthly Fixed Expenses", "Machine Advance Receivable", "Collections"];
  for (const name of order) {
    const sh = sheets.find((x) => x.name === name);
    if (sh) XLSX.utils.book_append_sheet(wb, sh.ws, name);
  }
  if (planWs) XLSX.utils.book_append_sheet(wb, planWs, "Changes after Plan");
  return wb;
}

export function downloadFundFlowWorkbook(input: FundFlowExportInput): void {
  const wb = buildFundFlowWorkbook(input);
  const name = `Budgeted Fund Flow Summary - ${monthLong(input.month.month)}.xlsx`;
  XLSX.writeFile(wb, name, { compression: true });
}
