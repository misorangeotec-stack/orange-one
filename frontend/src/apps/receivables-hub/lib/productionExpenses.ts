/**
 * Direct & Indirect Expenses for the production company — the overhead side of batch costing.
 *
 * The Batch Costing screens answer "what did the materials cost?" (₹207.51 a KG across FY 2026-27).
 * They cannot answer "what did the KG cost to make?", because freight, labour, electricity, salaries
 * and the rest never touch a production voucher. Those sit in the P&L, and this is where they come
 * from: ConnectWave's `rpt_expense_line` snapshot, for Enterprise — Surat alone.
 *
 * ─── THE GROUPS ARE TALLY'S, NOT OURS ───────────────────────────────────────────────────────────
 *
 * Tally's P&L prints the group DIRECTLY under Direct/Indirect Expenses — "EMPLOYEE COST", not the
 * five ledgers beneath it — so this rolls each line up the group chain (`v_group_chain`) to that
 * level. Checked against the business's own P&L print for FY 2026-27: EMPLOYEE COST ₹2,35,41,765.86,
 * COMMISSION & BROKERAGE ₹57,44,305.60, FINANCE COST ₹33,87,952.29, EMPLOYEE TRAVEL ₹5,54,146.28,
 * CARRIAGE OUTWARD ₹5,40,681.13, INSURANCE ₹1,74,978.81 — every one to the paisa.
 *
 * PURCHASE ACCOUNTS ARE LEFT OUT. That top group is the material itself, which batch costing already
 * counts voucher by voucher; adding it here would count the same rupee twice.
 *
 * ─── WHAT THE FIGURES CAN AND CANNOT BE CUT BY ──────────────────────────────────────────────────
 *
 * An expense belongs to the company and a date — never to a batch, a colour or an item. So the
 * dashboard's Year and Month filters apply, and its batch-level filters (colour, category,
 * sub-group, particular, batch no.) DO NOT. The screen says so rather than quietly showing a
 * company-wide total beside a filtered one.
 */
import { getConnectwaveSupabase } from "./connectwaveSupabase";
import { PRODUCTION_COMPANY_GUID } from "./batchCosting";
import { tenantForFy } from "./salesReport";
import { fyOfYmd, monthLabel } from "./batchCostingDashboard";

/** The two P&L blocks this screen shows, in the order Tally prints them. */
export const EXPENSE_BLOCKS = ["Direct Expenses", "Indirect Expenses"] as const;
export type ExpenseBlock = (typeof EXPENSE_BLOCKS)[number];

export interface ExpenseRow {
  fy: string;
  /** YYYYMMDD */
  vch_date: string;
  /** "Aug-26" */
  month: string;
  block: ExpenseBlock;
  /** The line Tally's P&L prints — the group directly under the block. */
  group: string;
  /** The group the ledger actually sits in, one level down. */
  sub_group: string;
  ledger: string;
  voucher_type: string;
  voucher_no: string;
  /** Debit-positive: an expense is positive, a credit/reversal negative. */
  amount: number;
}

interface RawExpense {
  fy: string;
  vch_date: string;
  top_group: string;
  sub_group: string | null;
  expense_ledger: string | null;
  voucher_type: string | null;
  voucher_no: string | null;
  amount: number | null;
}

const PAGE = 1000;

/** grp → its chain, leaf first: ["EMPLOYEE SALARY EXPENSES", "EMPLOYEE COST", "Indirect Expenses"]. */
async function groupChains(tenant: string): Promise<Map<string, string[]>> {
  const cw = getConnectwaveSupabase();
  const out = new Map<string, string[]>();
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await cw
      .from("v_group_chain")
      .select("grp,chain")
      .eq("tenant_id", tenant)
      .range(offset, offset + PAGE - 1)
      .returns<{ grp: string; chain: string[] | null }[]>();
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const r of rows) out.set(r.grp.toUpperCase(), (r.chain ?? []).map(String));
    if (rows.length < PAGE) return out;
  }
}

async function oneFy(fy: string, chains: Map<string, string[]>): Promise<ExpenseRow[]> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(PRODUCTION_COMPANY_GUID, fy);
  const out: ExpenseRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await cw
      .from("rpt_expense_line")
      .select("fy,vch_date,top_group,sub_group,expense_ledger,voucher_type,voucher_no,amount")
      .eq("tenant_id", tenant)
      .eq("fy", fy)
      .in("top_group", [...EXPENSE_BLOCKS])
      .order("vch_date", { ascending: true })
      .range(offset, offset + PAGE - 1)
      .returns<RawExpense[]>();
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const r of rows) {
      const sub = r.sub_group ?? r.expense_ledger ?? "";
      out.push({
        fy: r.fy || fyOfYmd(r.vch_date),
        vch_date: r.vch_date,
        month: monthLabel(r.vch_date.slice(0, 6)),
        block: r.top_group as ExpenseBlock,
        group: pnlGroup(r.top_group, sub, chains),
        sub_group: sub,
        ledger: r.expense_ledger ?? sub,
        voucher_type: r.voucher_type ?? "",
        voucher_no: r.voucher_no ?? "",
        amount: Number(r.amount) || 0,
      });
    }
    if (rows.length < PAGE) return out;
  }
}

/** The group directly under the block — what Tally's P&L prints on one line. */
function pnlGroup(block: string, sub: string, chains: Map<string, string[]>): string {
  const chain = chains.get(sub.toUpperCase());
  if (chain) {
    const i = chain.indexOf(block);
    if (i > 0) return chain[i - 1];
  }
  return sub;
}

/** Every Direct/Indirect expense line of the production company, for the given FYs. */
export async function loadProductionExpenses(fys: string[]): Promise<ExpenseRow[]> {
  if (!fys.length) return [];
  // Group names come from the live book; an older book's chains are the same tree.
  const chains = await groupChains(`acct_orange::${PRODUCTION_COMPANY_GUID}`);
  const perFy = await Promise.all(fys.map((fy) => oneFy(fy, chains)));
  return perFy.flat();
}

/* ------------------------------------------------------------------ totals */

export interface ExpenseGroup {
  block: ExpenseBlock;
  group: string;
  amount: number;
  /** Share of its own block. */
  share: number;
  lines: number;
}

export interface ExpenseTotals {
  direct: number;
  indirect: number;
  total: number;
  groups: ExpenseGroup[];
}

export function expenseTotals(rows: ExpenseRow[]): ExpenseTotals {
  const byGroup = new Map<string, ExpenseGroup>();
  let direct = 0;
  let indirect = 0;
  for (const r of rows) {
    if (r.block === "Direct Expenses") direct += r.amount;
    else indirect += r.amount;
    const key = `${r.block}|${r.group}`;
    const at = byGroup.get(key);
    if (at) { at.amount += r.amount; at.lines++; }
    else byGroup.set(key, { block: r.block, group: r.group, amount: r.amount, share: 0, lines: 1 });
  }
  const groups = [...byGroup.values()].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  for (const g of groups) {
    const blockTotal = g.block === "Direct Expenses" ? direct : indirect;
    g.share = blockTotal ? (g.amount / blockTotal) * 100 : 0;
  }
  return { direct, indirect, total: direct + indirect, groups };
}

/* ------------------------------------------------------------------ by month, by ledger */

export interface ExpenseMonth {
  month: string;
  label: string;
  direct: number;
  indirect: number;
  total: number;
  /** Finished good produced that month, and the per-KG split it carries. */
  kgs: number;
  directPerKg: number | null;
  indirectPerKg: number | null;
  materialPerKg: number | null;
  fullPerKg: number | null;
}

/**
 * Expenses month by month, beside what that month produced — the only honest way to read overhead
 * per KG, since a month that made nothing would otherwise divide by zero and read as infinite cost.
 * `production` is keyed YYYYMM.
 */
export function expensesByMonth(
  rows: ExpenseRow[],
  months: string[],
  production: Map<string, { kgs: number; costPerKg: number | null }>,
): ExpenseMonth[] {
  const acc = new Map<string, { direct: number; indirect: number }>();
  for (const r of rows) {
    const ym = r.vch_date.slice(0, 6);
    const at = acc.get(ym) ?? { direct: 0, indirect: 0 };
    if (r.block === "Direct Expenses") at.direct += r.amount;
    else at.indirect += r.amount;
    acc.set(ym, at);
  }
  return months.map((ym) => {
    const e = acc.get(ym) ?? { direct: 0, indirect: 0 };
    const p = production.get(ym) ?? { kgs: 0, costPerKg: null };
    const per = (v: number) => (p.kgs > 0 ? v / p.kgs : null);
    const d = per(e.direct);
    const i = per(e.indirect);
    return {
      month: ym,
      label: monthLabel(ym),
      direct: e.direct,
      indirect: e.indirect,
      total: e.direct + e.indirect,
      kgs: p.kgs,
      directPerKg: d,
      indirectPerKg: i,
      materialPerKg: p.costPerKg,
      fullPerKg: p.costPerKg == null ? null : p.costPerKg + (d ?? 0) + (i ?? 0),
    };
  });
}

export interface ExpenseLedger {
  block: ExpenseBlock;
  group: string;
  ledger: string;
  amount: number;
  lines: number;
  /** Share of its own block. */
  share: number;
}

/** Every ledger that carried an expense, with the P&L group it rolls into. */
export function expensesByLedger(rows: ExpenseRow[]): ExpenseLedger[] {
  const m = new Map<string, ExpenseLedger>();
  let direct = 0, indirect = 0;
  for (const r of rows) {
    if (r.block === "Direct Expenses") direct += r.amount;
    else indirect += r.amount;
    const key = `${r.block}|${r.group}|${r.ledger}`;
    const at = m.get(key);
    if (at) { at.amount += r.amount; at.lines++; }
    else m.set(key, { block: r.block, group: r.group, ledger: r.ledger, amount: r.amount, lines: 1, share: 0 });
  }
  const out = [...m.values()];
  for (const l of out) {
    const t = l.block === "Direct Expenses" ? direct : indirect;
    l.share = t ? (l.amount / t) * 100 : 0;
  }
  return out.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

/**
 * What a kilogram really cost: the material Tally put on the batch, plus the overhead of the same
 * period spread over what the period produced. Absorption per KG, the plainest kind — no driver,
 * no apportionment, because nothing in Tally ties an expense to a batch.
 */
export interface CostPerKg {
  materialPerKg: number | null;
  directPerKg: number | null;
  indirectPerKg: number | null;
  fullPerKg: number | null;
  kgs: number;
}

export function costPerKg(materialPerKg: number | null, totals: ExpenseTotals, kgs: number): CostPerKg {
  const per = (v: number) => (kgs > 0 ? v / kgs : null);
  const direct = per(totals.direct);
  const indirect = per(totals.indirect);
  return {
    materialPerKg,
    directPerKg: direct,
    indirectPerKg: indirect,
    fullPerKg: materialPerKg == null ? null : materialPerKg + (direct ?? 0) + (indirect ?? 0),
    kgs,
  };
}
