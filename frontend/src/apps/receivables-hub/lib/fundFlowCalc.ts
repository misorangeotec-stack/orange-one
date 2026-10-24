/**
 * fundFlowCalc.ts — every Fund Flow formula, in one place.
 *
 * The page, the summary tabs and the Excel export all call these, so the three can never
 * disagree. It is the mirror of the SQL routine `public.ff_line_values` (migration
 * 20270217120000_fund_flow.sql); change one and the other must change with it.
 *
 * The formulas are the ones the Excel pack "Budgeted Fund Flow Summary.xlsx" uses
 * (PL and BS\FUND FLOW\build_budgeted_fund_flow_summary.py), checked line by line:
 *   - every USD line is restated at the month's ONE std rate (95 in the Excel pack)
 *   - Approved defaults to Budgeted; Balance = Approved − Paid; Achieved = Paid ÷ Approved
 *   - Customs Duty has three formulas, by line:
 *       freight_in_base  (inv INR + freight) × duty %     — paper, machines, thickener
 *       freight_added    inv INR × duty % + freight       — spares, heads, ink
 *       typed            the duty as quoted               — "duty typed as an amount"
 *     plus an optional amount over the formula, and "not budgeted this month" = 0
 *   - TOTAL PAYMENT = (Import Due + Import Advance + Local Advance) + (Duty + EMI + Vendors)
 *                     + (TDS + GST) + Investment + Fixed Expenses
 *   - TOTAL COLLECTION = Machine Advances + Collections + Refunds
 *   - CLOSING = Opening + Collection − Payment
 *
 * One deliberate difference from the Excel pack: its summary "Budgeted" column actually read
 * the APPROVED cells ('Import Due'!F8, Advances!H63 …). Here Budgeted and Approved are both
 * shown, and the totals, balance and closing run on Approved — the figure the Excel used.
 */

export type FfHead =
  | "import_due" | "import_advance" | "local_advance" | "customs_duty"
  | "emi" | "other_vendor" | "tds" | "gst" | "investment" | "fixed_expense"
  | "machine_advance" | "collection" | "refund";

export type FfBlock = "mach" | "ink" | "head" | "paper" | "parts";
export type DutyMode = "freight_in_base" | "freight_added" | "typed";
export type FfCompany = "O Tec" | "Enterprises" | "Colorix" | "Group";

/** A line as stored (the columns of public.fund_flow_line the formulas read). */
export interface FfLineInput {
  head: FfHead;
  currency: "USD" | "INR";
  amt_budget: number | null;
  amt_approved: number | null;
  amt_paid: number | null;
  paid_before: number | null;
  inv_usd?: number | null;
  duty_pct?: number | null;
  freight_inr?: number | null;
  duty_mode?: DutyMode | null;
  duty_typed_inr?: number | null;
  extra_inr?: number | null;
  not_this_month?: boolean | null;
  paid_in_full?: boolean | null;
  /** Marked Not approved by the CFO: counts 0 approved. */
  not_approved_at?: string | null;
}

export interface FfLineValues {
  /** The line's unit: USD for Import Due / Advance, else INR. */
  budgetUnit: number;
  approvedUnit: number;
  paidUnit: number;
  /** The rupee multiplier for the unit: the std rate for USD, 1 for INR. */
  fx: number;
  budgetInr: number;
  approvedInr: number;
  paidInr: number;
  balanceInr: number;
  /** Paid ÷ Approved, null when nothing is approved (the Excel's blank). */
  achieved: number | null;
  /** Customs Duty only: invoice value in rupees and the duty before freight/extra. */
  invInr?: number;
  dutyInr?: number;
}

const n = (v: number | null | undefined): number => (v == null || Number.isNaN(v) ? 0 : Number(v));

/** Customs Duty total in rupees, by the line's mode — before any budget override. */
export function customsTotal(l: FfLineInput, rate: number): { invInr: number; dutyInr: number; total: number } {
  const invInr = n(l.inv_usd) * rate;
  if (l.not_this_month) return { invInr, dutyInr: 0, total: 0 };
  let duty: number;
  let total: number;
  switch (l.duty_mode) {
    case "typed":
      duty = n(l.duty_typed_inr);
      total = duty;
      break;
    case "freight_added":
      duty = invInr * n(l.duty_pct);
      total = duty + n(l.freight_inr);
      break;
    default: // freight_in_base — also the Excel's default for machines and paper
      duty = (invInr + n(l.freight_inr)) * n(l.duty_pct);
      total = duty;
  }
  return { invInr, dutyInr: duty, total: total + n(l.extra_inr) };
}

/**
 * One line in rupees at the month's std rate. Mirror of public.ff_line_values.
 *
 * `locked` = the month's plan is approved. Before that, a line the CFO has not approved counts at
 * its budget (the Excel's "Approved defaults to Budgeted"); after it, such a line — an addition
 * after the plan — counts 0 approved until the CFO approves it.
 */
export function lineValues(l: FfLineInput, rate: number, locked = false): FfLineValues {
  const fx = l.currency === "USD" ? rate : 1;
  let budgetUnit: number;
  let invInr: number | undefined;
  let dutyInr: number | undefined;
  if (l.head === "customs_duty") {
    const c = customsTotal(l, rate);
    invInr = c.invInr;
    dutyInr = c.dutyInr;
    budgetUnit = l.amt_budget != null ? n(l.amt_budget) : c.total;
  } else {
    budgetUnit = n(l.amt_budget);
  }
  const approvedUnit = l.not_approved_at ? 0 : l.amt_approved != null ? n(l.amt_approved) : locked ? 0 : budgetUnit;
  const before = n(l.paid_before);
  // "Paid in full" is the shipment's whole total — the budget, whatever was approved.
  const paidUnit = l.head === "customs_duty" && l.paid_in_full ? budgetUnit - before : n(l.amt_paid);
  const budgetInr = (budgetUnit - before) * fx;
  const approvedInr = (approvedUnit - before) * fx;
  const paidInr = paidUnit * fx;
  return {
    budgetUnit, approvedUnit, paidUnit, fx, budgetInr, approvedInr, paidInr,
    balanceInr: approvedInr - paidInr,
    achieved: approvedInr === 0 ? null : paidInr / approvedInr,
    invInr, dutyInr,
  };
}

/* ------------------------------------------------------------------ heads */

export interface HeadMeta {
  head: FfHead;
  /** The summary line text, as on the Excel "Fund Flow Summary" sheet. */
  label: string;
  /** The tab / Excel sheet the head's lines live on. */
  sheet: string;
  side: "payment" | "receipt";
  currency: "USD" | "INR";
  /** Unpaid balance carries into next month (user rule, 24-Oct-2026). */
  carries: boolean;
}

export const HEADS: HeadMeta[] = [
  { head: "import_due", label: "Import Due Payment (Dues)", sheet: "Import Due", side: "payment", currency: "USD", carries: true },
  { head: "import_advance", label: "Import Advance Payment", sheet: "Advances", side: "payment", currency: "USD", carries: true },
  { head: "local_advance", label: "Local Advance Payment", sheet: "Local Advance", side: "payment", currency: "INR", carries: false },
  { head: "customs_duty", label: "Custom Duty and GST on imports", sheet: "Customs Duty", side: "payment", currency: "INR", carries: true },
  { head: "emi", label: "EMI", sheet: "EMI", side: "payment", currency: "INR", carries: false },
  { head: "other_vendor", label: "Other Vendors (local + other)", sheet: "Other Vendor", side: "payment", currency: "INR", carries: false },
  { head: "tds", label: "TDS", sheet: "Tax and Statutory", side: "payment", currency: "INR", carries: false },
  { head: "gst", label: "GST", sheet: "Tax and Statutory", side: "payment", currency: "INR", carries: false },
  { head: "investment", label: "Investment / Loan", sheet: "Investment-Loan", side: "payment", currency: "INR", carries: false },
  { head: "fixed_expense", label: "Monthly Fixed Expenses", sheet: "Monthly Fixed Expenses", side: "payment", currency: "INR", carries: false },
  { head: "machine_advance", label: "Advance from Customer (Machine Advances)", sheet: "Machine Advance Receivable", side: "receipt", currency: "INR", carries: false },
  { head: "collection", label: "Customer Collections", sheet: "Collections", side: "receipt", currency: "INR", carries: false },
  { head: "refund", label: "Refunds / Compensation", sheet: "Collections", side: "receipt", currency: "INR", carries: false },
];

export const HEAD_META: Record<FfHead, HeadMeta> = Object.fromEntries(HEADS.map((h) => [h.head, h])) as Record<FfHead, HeadMeta>;

/** What an import advance is for (user, 24-Oct-2026): the product, not the Excel's payment stage. */
export const BLOCKS: { block: FfBlock; label: string; short: string }[] = [
  { block: "mach", label: "Advances - Machines", short: "MACH" },
  { block: "ink", label: "Advances - Ink", short: "INK" },
  { block: "head", label: "Advances - Heads", short: "HEAD" },
  { block: "paper", label: "Advances - Paper", short: "PAPER" },
  { block: "parts", label: "Advances - Spare Parts", short: "PARTS" },
];

export const DUTY_MODES: { mode: DutyMode; label: string; formula: string }[] = [
  { mode: "freight_in_base", label: "Freight in base", formula: "(Inv INR + Freight) × Duty %" },
  { mode: "freight_added", label: "Freight added", formula: "Inv INR × Duty % + Freight" },
  { mode: "typed", label: "Typed amount", formula: "Duty as quoted" },
];

/* ---------------------------------------------------------------- summary */

export interface Fig { budget: number; approved: number; paid: number; balance: number; achieved: number | null }

export const zeroFig = (): Fig => ({ budget: 0, approved: 0, paid: 0, balance: 0, achieved: null });

function finish(f: Fig): Fig {
  return { ...f, balance: f.approved - f.paid, achieved: f.approved === 0 ? null : f.paid / f.approved };
}

export function sumFigs(figs: Fig[]): Fig {
  const t = zeroFig();
  for (const f of figs) { t.budget += f.budget; t.approved += f.approved; t.paid += f.paid; }
  return finish(t);
}

export function figOf(v: FfLineValues): Fig {
  return finish({ budget: v.budgetInr, approved: v.approvedInr, paid: v.paidInr, balance: 0, achieved: null });
}

export interface FfSummary {
  byHead: Record<FfHead, Fig>;
  /** Import Due + Import Advance + Local Advance */
  subA: Fig;
  /** Customs Duty + EMI + Other Vendors */
  subB: Fig;
  /** TDS + GST */
  subC: Fig;
  totalPayment: Fig;
  totalCollection: Fig;
  opening: number;
  /** Opening + Collection − Payment, on the approved (budget) basis. */
  closingBudget: number;
  /** Opening + Collection − Payment, on what has actually been paid / received. */
  closingPaid: number;
  /** Still to collect less still to pay. */
  netToCome: number;
}

/** Roll the month's lines up into the Fund Flow Summary sheet. */
export function summarise(
  lines: { head: FfHead; values: FfLineValues }[],
  opening: number,
): FfSummary {
  const byHead = Object.fromEntries(HEADS.map((h) => [h.head, zeroFig()])) as Record<FfHead, Fig>;
  for (const l of lines) {
    const f = byHead[l.head];
    f.budget += l.values.budgetInr;
    f.approved += l.values.approvedInr;
    f.paid += l.values.paidInr;
  }
  for (const h of HEADS) byHead[h.head] = finish(byHead[h.head]);
  const subA = sumFigs([byHead.import_due, byHead.import_advance, byHead.local_advance]);
  const subB = sumFigs([byHead.customs_duty, byHead.emi, byHead.other_vendor]);
  const subC = sumFigs([byHead.tds, byHead.gst]);
  const totalPayment = sumFigs([subA, subB, subC, byHead.investment, byHead.fixed_expense]);
  const totalCollection = sumFigs([byHead.machine_advance, byHead.collection, byHead.refund]);
  return {
    byHead, subA, subB, subC, totalPayment, totalCollection, opening,
    closingBudget: opening + totalCollection.approved - totalPayment.approved,
    closingPaid: opening + totalCollection.paid - totalPayment.paid,
    netToCome: totalCollection.balance - totalPayment.balance,
  };
}

/* ------------------------------------------------------ changes after plan */

/** What a line looks like to the "Changes after plan" report. */
export interface PlanLine {
  head: FfHead;
  currency: "USD" | "INR";
  plan_unit: number | null;
  paid_before: number | null;
  deleted?: boolean;
  /** For live lines: the current figures (lineValues with the plan locked). */
  values?: FfLineValues;
  /** Never approved (an addition the CFO has not seen yet). */
  awaiting?: boolean;
  changed?: boolean;
  deleteRequested?: boolean;
}

export interface PlanBridge {
  plan: number;
  added: number;
  removed: number;
  changed: number;
  current: number;
  /** Waiting for the CFO, not yet in `current`: additions' budgets, edits' budget − approved, delete requests' approved. */
  pendingAdd: number;
  pendingChange: number;
  pendingRemove: number;
}

/**
 * Plan → current approved, in rupees at the CURRENT std rate and net of what earlier months paid,
 * so a rate change or a last-month payment is not mistaken for a change of plan.
 *   current = plan − removed + added + changed   (exactly, by construction)
 */
export function planBridge(lines: PlanLine[], rate: number): PlanBridge {
  const b: PlanBridge = { plan: 0, added: 0, removed: 0, changed: 0, current: 0, pendingAdd: 0, pendingChange: 0, pendingRemove: 0 };
  for (const l of lines) {
    const fx = l.currency === "USD" ? rate : 1;
    const planInr = l.plan_unit == null ? null : (Number(l.plan_unit) - n(l.paid_before)) * fx;
    if (l.deleted) {
      if (planInr != null) { b.plan += planInr; b.removed += planInr; }
      continue;
    }
    const v = l.values!;
    b.current += v.approvedInr;
    if (planInr == null) {
      b.added += v.approvedInr;
      if (l.awaiting) b.pendingAdd += v.budgetInr;
    } else {
      b.plan += planInr;
      b.changed += v.approvedInr - planInr;
    }
    if (l.changed) b.pendingChange += v.budgetInr - v.approvedInr;
    if (l.deleteRequested) b.pendingRemove += v.approvedInr;
  }
  return b;
}

/* ----------------------------------------------------------- month window */

const pad = (x: number) => String(x).padStart(2, "0");
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** "2026-11-01" → { opensOn: "2026-10-29", closesOn: "2026-12-02" }. Mirror of ff_month_window. */
export function monthWindow(monthIso: string): { opensOn: string; closesOn: string } {
  const [y, m] = monthIso.split("-").map(Number);
  const opens = new Date(Date.UTC(y, m - 1, 1 - 3)); // last day of previous month − 2
  const close = new Date(Date.UTC(y, m, 2)); // the 2nd of the following month
  if (close.getUTCDay() === 0) close.setUTCDate(3); // Sunday → Monday
  return { opensOn: iso(opens), closesOn: iso(close) };
}

/** Today in IST as yyyy-mm-dd (IST is a fixed +05:30). */
export function todayIst(now = new Date()): string {
  return iso(new Date(now.getTime() + 330 * 60_000));
}

/** "2026-10-01" → "Oct-26", the label the Salesperson Collection Report keys its months by. */
export function monthLabel(monthIso: string): string {
  const [y, m] = monthIso.split("-").map(Number);
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]}-${String(y).slice(2)}`;
}

/** "2026-10-01" → "October 2026". */
export function monthLong(monthIso: string): string {
  const [y, m] = monthIso.split("-").map(Number);
  return `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1]} ${y}`;
}

export function addMonths(monthIso: string, k: number): string {
  const [y, m] = monthIso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + k, 1));
  return iso(d);
}

/** Last day of the month before `monthIso` — the date the opening balance is read at. */
export function openingDate(monthIso: string): string {
  const [y, m] = monthIso.split("-").map(Number);
  return iso(new Date(Date.UTC(y, m - 1, 0)));
}

/* ------------------------------------------------------------- formatting */

/** Indian grouping, no decimals: 2,27,50,000. Negative in brackets, as the Excel pack. */
export function fmtInr(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "";
  const r = Math.round(v);
  const s = Math.abs(r).toLocaleString("en-IN");
  return r < 0 ? `(${s})` : s;
}

export function fmtUsd(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "";
  const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${s})` : s;
}

export function fmtPct(v: number | null | undefined): string {
  return v == null || Number.isNaN(v) ? "" : `${Math.round(v * 100)}%`;
}

/** Crore with 2 decimals for headline tiles: ₹2.28 cr. */
export function fmtCr(v: number): string {
  return `₹${(v / 1e7).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} cr`;
}
