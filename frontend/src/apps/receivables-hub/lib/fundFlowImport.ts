/**
 * fundFlowImport.ts — read a month's "Budgeted Fund Flow Summary.xlsx" pack into Fund Flow lines.
 *
 * The pack is what PL and BS\FUND FLOW\build_budgeted_fund_flow_summary.py builds each month from
 * "0F_<MON> <YYYY> Cashflow.xlsx" — the cashflow already cleaned into one sheet per head. Reading
 * the PACK rather than the raw cashflow is deliberate: the builder has already located every row
 * by its label (rows move inside the cashflow every month), so this parser reads fixed columns
 * and stops at each sheet's TOTAL row.
 *
 * Only INPUT cells are read. A cell holding a formula is the pack's own arithmetic (INR = USD x
 * rate, Approved = Budgeted, Balance = Approved − Paid) and is recomputed by fundFlowCalc — with
 * two exceptions that ARE inputs expressed as formulas, both on the Customs Duty sheet:
 *   L (Total) tells which of the three duty formulas the line uses, and any amount added over it;
 *   M (Paid) "=L" means paid in full.
 *
 * The pack's "Adjustment to cashflow total" rows are SKIPPED. They existed only to make the pack
 * tie to errors inside the Excel cashflow (a SUM range that stopped short, a paid figure typed as
 * 0); in Hub the lines are entered directly, so the true line values stand on their own.
 */
import type { DutyMode, FfBlock, FfCompany, FfHead } from "./fundFlowCalc";

/**
 * A cell as SheetJS reads it: value and/or formula (no leading "="), and its type.
 *
 * ⚠ READ THE FILE WITH `{ cellFormula: true, sheetStubs: true }`. The pack is written by openpyxl,
 *   which stores formulas WITHOUT a cached value; without `sheetStubs` SheetJS drops every such cell,
 *   and the Customs Duty modes and "paid in full" (both read from formulas) silently vanish. A stub
 *   arrives as type "z" with v 0 — that is an EMPTY cell, not a zero (see `input`).
 */
export interface RawCell { v?: unknown; f?: string; t?: string }
/** Reads one cell of one sheet; undefined when the sheet or cell is absent. */
export type CellReader = (sheet: string, addr: string) => RawCell | undefined;

export interface ImportedLine {
  head: FfHead;
  block?: FfBlock | null;
  company?: FfCompany | null;
  location?: string | null;
  currency: "USD" | "INR";
  line_type?: string | null;
  party?: string | null;
  customer_for?: string | null;
  ref_no?: string | null;
  description?: string | null;
  item?: string | null;
  doc_date?: string | null;
  amt_budget?: number | null;
  amt_approved?: number | null;
  amt_paid?: number | null;
  inv_usd?: number | null;
  duty_pct?: number | null;
  freight_inr?: number | null;
  duty_mode?: DutyMode | null;
  duty_typed_inr?: number | null;
  extra_inr?: number | null;
  not_this_month?: boolean;
  paid_in_full?: boolean;
  loan_os?: number | null;
  terms?: string | null;
  status_note?: string | null;
  remarks?: string | null;
  sales_person?: string | null;
  machine?: string | null;
  expected_date?: string | null;
  follow_up?: string | null;
  total_due?: number | null;
  sort_order: number;
}

export interface ImportResult {
  month: string | null;
  stdRate: number | null;
  opening: number | null;
  bankMemo: number | null;
  lines: ImportedLine[];
  /** Rows read but not imported, and why — shown to the CFO before anything is saved. */
  skipped: { sheet: string; row: number; why: string }[];
  /** Sheets the parser expected and did not find. */
  missingSheets: string[];
}

const SHEETS = ["Import Due", "Advances", "Customs Duty", "EMI", "Other Vendor", "Tax and Statutory",
  "Investment-Loan", "Monthly Fixed Expenses", "Machine Advance Receivable", "Collections"];

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
};

function text(c: RawCell | undefined): string {
  if (!c || c.v == null || c.t === "z") return "";
  return String(c.v).trim();
}

/** A typed number. A formula cell is NOT an input, so it reads as null. */
function input(c: RawCell | undefined): number | null {
  if (!c || c.f || c.t === "z") return null;
  if (typeof c.v === "number") return c.v;
  if (typeof c.v === "string" && c.v.trim() !== "" && !Number.isNaN(Number(c.v.replace(/,/g, "")))) {
    return Number(c.v.replace(/,/g, ""));
  }
  return null;
}

/** "05.10.26" / "08.10.2026" / "15-10-26" → "2026-10-05". Anything else → null. */
export function parseDmy(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]); const mo = Number(m[2]); let y = Number(m[3]);
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** The company buried in the Excel's free text ("Other Vendor-Enter", "O-  ENTERPRISE", "O TEC"). */
export function companyOf(...texts: string[]): FfCompany | null {
  const t = texts.join(" ").toUpperCase().replace(/\s+/g, " ");
  if (!t.trim()) return null;
  if (/COLORIX/.test(t)) return "Colorix";
  const ent = /ENTER/.test(t);
  const otec = /O[\s-]*TEC\b|OTEC|ORANGE O TEC/.test(t.replace(/ENTERPRISES?/g, ""));
  if (ent && /\+/.test(t) && otec) return "Group";
  if (ent) return "Enterprises";
  if (otec) return "O Tec";
  return null;
}

const blank = (l: Partial<ImportedLine>) =>
  !l.party && !l.description && !l.line_type && !l.amt_budget && !l.amt_paid && !l.inv_usd;

export function parseFundFlowPack(read: CellReader, sheetNames: string[]): ImportResult {
  const res: ImportResult = { month: null, stdRate: null, opening: null, bankMemo: null, lines: [], skipped: [], missingSheets: [] };
  const have = new Set(sheetNames);
  for (const s of SHEETS) if (!have.has(s)) res.missingSheets.push(s);
  let order = 0;
  const push = (l: ImportedLine) => { res.lines.push({ ...l, sort_order: order++ }); };
  const isTotal = (s: string) => /^(sub)?total\b/i.test(s.trim()) || /^TOTAL/i.test(s.trim());

  // Month, from the title "Budgeted Fund Flow Summary - October 2026".
  const title = text(read("Fund Flow Summary", "A1")) || text(read("Index", "A1"));
  const tm = title.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})/i);
  if (tm) res.month = `${tm[2]}-${String(MONTHS[tm[1].toLowerCase()]).padStart(2, "0")}-01`;
  res.stdRate = input(read("Import Due", "B3")) ?? input(read("Advances", "B3"));

  // ── Import Due: A Type · B Vendor · C USD Budgeted · E USD Approved · G USD Paid · K Remarks
  if (have.has("Import Due")) {
    for (let r = 6; r < 200; r++) {
      const b = text(read("Import Due", `B${r}`));
      if (isTotal(b)) break;
      const l: ImportedLine = {
        head: "import_due", currency: "USD", sort_order: 0,
        line_type: text(read("Import Due", `A${r}`)) || null, party: b || null,
        amt_budget: input(read("Import Due", `C${r}`)), amt_approved: input(read("Import Due", `E${r}`)),
        amt_paid: input(read("Import Due", `G${r}`)), remarks: text(read("Import Due", `K${r}`)) || null,
      };
      if (blank(l)) continue;
      l.company = companyOf(l.line_type ?? "", l.party ?? "");
      push(l);
    }
  }

  // ── Advances: block headings in A; A For · B Party · C PI · D Desc · E USD · G Appr · I Paid · M Terms · N Status
  // The Excel's blocks are payment stages ("Against BL/Arrival" mixes machines, ink and paper);
  // Hub files each advance by product (MACH / INK / HEAD / PAPER / PARTS), read from the stage
  // and the description.
  if (have.has("Advances")) {
    type Stage = "new_orders" | "ink" | "against_bl" | "spares";
    const stageOf: [RegExp, Stage][] = [
      [/new orders/i, "new_orders"], [/for ink/i, "ink"], [/bl\/arrival|against bl|aganist bl/i, "against_bl"], [/spare/i, "spares"],
    ];
    const productOf = (stage: Stage, desc: string): FfBlock => {
      const d = desc.toUpperCase();
      // Paper first: release paper is filed under the Excel's machine block.
      if (/PAPER/.test(d)) return "paper";
      if (stage === "new_orders") return "mach";
      if (stage === "ink") return "ink";
      // A machine description often names its heads ("K32 WITH 16 HEADS") — machines first.
      if (/MACHINE|\bM\/?C\b|PRINTER|POSITION|STEAMER|ROCKET|CKD|DRYER|K32|K64|RT19/.test(d)) return "mach";
      if (/HEAD/.test(d)) return "head";
      if (/\bINK\b|THICK|YPM|KG\b/.test(d)) return "ink";
      return stage === "against_bl" ? "mach" : "parts";
    };
    let stage: Stage | null = null;
    let block: FfBlock | null = null;
    for (let r = 6; r < 400; r++) {
      const a = text(read("Advances", `A${r}`));
      const d = text(read("Advances", `D${r}`));
      if (/^TOTAL/i.test(d)) break;
      const hit = stageOf.find(([re]) => re.test(a) && /^advances/i.test(a));
      if (hit && !text(read("Advances", `B${r}`)) && input(read("Advances", `E${r}`)) == null) { stage = hit[1]; continue; }
      block = stage ? productOf(stage, d) : null;
      if (/^subtotal/i.test(d)) continue;
      if (/adjustment to cashflow total/i.test(d)) {
        res.skipped.push({ sheet: "Advances", row: r, why: "Adjustment to the Excel cashflow total - not a payment line" });
        continue;
      }
      const l: ImportedLine = {
        head: "import_advance", block, currency: "USD", sort_order: 0,
        customer_for: a || null, party: text(read("Advances", `B${r}`)) || null,
        ref_no: text(read("Advances", `C${r}`)) || null, description: d || null,
        amt_budget: input(read("Advances", `E${r}`)), amt_approved: input(read("Advances", `G${r}`)),
        amt_paid: input(read("Advances", `I${r}`)),
        terms: text(read("Advances", `M${r}`)) || null, status_note: text(read("Advances", `N${r}`)) || null,
      };
      if (blank(l)) continue;
      if (!block) { res.skipped.push({ sheet: "Advances", row: r, why: "Line above the first block heading" }); continue; }
      l.company = companyOf(a);
      push(l);
    }
  }

  // ── Customs Duty: A Co · B Date · C Party · D Inv · E Item · F Desc · G Inv USD · I Duty% · J Duty · K Freight · L Total · M Paid · O Remarks
  if (have.has("Customs Duty")) {
    for (let r = 6; r < 400; r++) {
      const f = text(read("Customs Duty", `F${r}`));
      if (/^TOTAL$/i.test(f)) break;
      const g = input(read("Customs Duty", `G${r}`));
      const party = text(read("Customs Duty", `C${r}`));
      if (g == null && !party) continue;
      const jc = read("Customs Duty", `J${r}`);
      const lc = read("Customs Duty", `L${r}`);
      const mc = read("Customs Duty", `M${r}`);
      const lf = (lc?.f ?? "").replace(/\s/g, "").toUpperCase();
      const jf = (jc?.f ?? "").replace(/\s/g, "").toUpperCase();
      let mode: DutyMode = "freight_in_base";
      let extra: number | null = null;
      let notThisMonth = false;
      let typed: number | null = null;
      if (!lc?.f && input(lc) === 0) notThisMonth = true;
      if (!jc?.f && input(jc) != null) { mode = "typed"; typed = input(jc); }
      else if (/^J\d+\+K\d+$/.test(lf)) mode = "freight_added";
      else if (/\(H\d+\+K\d+\)/.test(jf)) mode = "freight_in_base";
      else if (/^H\d+\*I\d+$/.test(jf)) mode = "freight_added";
      const ex = lf.match(/^J\d+(?:\+K\d+)?\+([\d.]+)$/);
      if (ex) extra = Number(ex[1]);
      if (/^J\d+\+K\d+\+/.test(lf)) mode = "freight_added";
      // A Total typed as a plain number (not 0) is a quoted total: keep it as the budget override.
      const typedTotal = !lc?.f && input(lc) != null && input(lc) !== 0 ? input(lc) : null;
      const paidFull = (mc?.f ?? "").replace(/\s/g, "").toUpperCase() === `L${r}`;
      const l: ImportedLine = {
        head: "customs_duty", currency: "INR", sort_order: 0,
        company: companyOf(text(read("Customs Duty", `A${r}`))),
        doc_date: parseDmy(text(read("Customs Duty", `B${r}`))),
        party: party || null, ref_no: text(read("Customs Duty", `D${r}`)) || null,
        item: text(read("Customs Duty", `E${r}`)) || null, description: f || null,
        inv_usd: g, duty_pct: input(read("Customs Duty", `I${r}`)),
        freight_inr: input(read("Customs Duty", `K${r}`)), duty_mode: mode,
        duty_typed_inr: typed, extra_inr: extra, not_this_month: notThisMonth,
        amt_budget: typedTotal,
        paid_in_full: paidFull, amt_paid: paidFull ? null : input(mc),
        remarks: text(read("Customs Duty", `O${r}`)) || null,
      };
      push(l);
    }
  }

  // ── INR sheets with the shared shape: A Type · B Vendor · C Budgeted · D Approved · E Paid · F Bal · G Remarks
  const inrSheet = (sheet: string, headOf: (type: string) => FfHead | null, extra?: (r: number, l: ImportedLine) => void) => {
    if (!have.has(sheet)) return;
    for (let r = 5; r < 400; r++) {
      const a = text(read(sheet, `A${r}`));
      const b = text(read(sheet, `B${r}`));
      if (isTotal(b) || /^TOTAL/i.test(b)) break;
      if (/adjustment to cashflow total/i.test(b)) {
        res.skipped.push({ sheet, row: r, why: "Adjustment to the Excel cashflow total - not a payment line" });
        continue;
      }
      if (/line\(s\) with nil budget/i.test(a)) break;
      const head = headOf(a);
      const l: ImportedLine = {
        head: head ?? "other_vendor", currency: "INR", sort_order: 0,
        line_type: a || null, party: b || null,
        amt_budget: input(read(sheet, `C${r}`)), amt_approved: input(read(sheet, `D${r}`)),
        amt_paid: input(read(sheet, `E${r}`)),
      };
      if (blank(l)) continue;
      if (!head) { res.skipped.push({ sheet, row: r, why: `Unknown type "${a}"` }); continue; }
      extra?.(r, l);
      l.company = l.company ?? companyOf(a, b);
      push(l);
    }
  };
  inrSheet("EMI", () => "emi", (r, l) => {
    l.loan_os = input(read("EMI", `G${r}`));
    l.remarks = text(read("EMI", `H${r}`)) || null;
  });
  inrSheet("Other Vendor", () => "other_vendor", (r, l) => { l.remarks = text(read("Other Vendor", `G${r}`)) || null; });
  inrSheet("Tax and Statutory", (a) => (/^tds|tcs/i.test(a) ? "tds" : /gst/i.test(a) ? "gst" : /advance tax/i.test(a) ? "tds" : null),
    (r, l) => { l.remarks = text(read("Tax and Statutory", `G${r}`)) || null; });
  inrSheet("Investment-Loan", () => "investment", (r, l) => { l.remarks = text(read("Investment-Loan", `G${r}`)) || null; });
  inrSheet("Monthly Fixed Expenses", () => "fixed_expense", (r, l) => { l.remarks = text(read("Monthly Fixed Expenses", `G${r}`)) || null; });

  // ── Machine Advance Receivable: A Sales person · B Customer · C Machine · D Projected · E Received · G Date · H Note
  if (have.has("Machine Advance Receivable")) {
    const s = "Machine Advance Receivable";
    for (let r = 5; r < 400; r++) {
      const b = text(read(s, `B${r}`));
      if (/^TOTAL/i.test(b)) break;
      const l: ImportedLine = {
        head: "machine_advance", currency: "INR", sort_order: 0,
        sales_person: text(read(s, `A${r}`)) || null, party: b || null, machine: text(read(s, `C${r}`)) || null,
        amt_budget: input(read(s, `D${r}`)), amt_paid: input(read(s, `E${r}`)),
        expected_date: parseDmy(text(read(s, `G${r}`))), follow_up: text(read(s, `H${r}`)) || null,
      };
      if (blank(l)) continue;
      push(l);
    }
  }

  // ── Collections: opening, customer collections, refunds, bank memo
  if (have.has("Collections")) {
    const s = "Collections";
    for (let r = 5; r < 40; r++) {
      const a = text(read(s, `A${r}`));
      if (/^opening balance/i.test(a)) res.opening = input(read(s, `C${r}`));
      else if (/^customer collections/i.test(a)) {
        push({ head: "collection", currency: "INR", sort_order: 0, line_type: "Customer Collections",
          total_due: input(read(s, `B${r}`)), amt_budget: input(read(s, `C${r}`)), amt_paid: input(read(s, `D${r}`)),
          remarks: text(read(s, `G${r}`)) || null });
      } else if (/^refunds/i.test(a)) {
        const b = input(read(s, `C${r}`)); const p = input(read(s, `D${r}`));
        if (b || p) push({ head: "refund", currency: "INR", sort_order: 0, line_type: a, amt_budget: b, amt_paid: p });
      } else if (/^memo: bank balance/i.test(a)) res.bankMemo = input(read(s, `D${r}`));
    }
  }
  return res;
}
