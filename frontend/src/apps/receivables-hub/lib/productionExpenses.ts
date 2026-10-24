/**
 * Direct, Indirect and (chosen) Purchase Accounts expenses for the production company — the overhead side of batch costing.
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
 * ─── WHICH LEDGERS COUNT IS THE USER'S CALL ─────────────────────────────────────────────────────
 *
 * Purchase Accounts is loaded too, as a third block, because a few of its ledgers (MANUFACTURING
 * COST, INVENTORY TRANSFER TO LAB) are real conversion cost that never lands on a batch. But most of
 * it is the material itself, which batch costing already counts voucher by voucher. So every ledger
 * carries an on/off choice (`useCostingGls`): Direct and Indirect start ticked, Purchase Accounts
 * starts unticked, and the screens add only what is ticked. Ticking GST PURCHASE would count the same
 * rupee twice — the picker says so.
 *
 * ─── WHAT THE FIGURES CAN AND CANNOT BE CUT BY ──────────────────────────────────────────────────
 *
 * An expense belongs to the company and a date — never to a batch, a colour or an item. So the
 * dashboard's Year and Month filters apply, and its batch-level filters (colour, category,
 * sub-group, particular, batch no.) DO NOT. The screen says so rather than quietly showing a
 * company-wide total beside a filtered one.
 */
import { useCallback, useState } from "react";
import { getConnectwaveSupabase } from "./connectwaveSupabase";
import { PRODUCTION_COMPANY_GUID } from "./batchCosting";
import { tenantForFy } from "./salesReport";
import { fyOfYmd, monthLabel } from "./batchCostingDashboard";

/** The P&L blocks this screen reads, in the order the costing build-up lists them. */
export const EXPENSE_BLOCKS = ["Direct Expenses", "Indirect Expenses", "Purchase Accounts"] as const;
export type ExpenseBlock = (typeof EXPENSE_BLOCKS)[number];

/** Short names for filter labels and table cells. */
export const BLOCK_SHORT: Record<ExpenseBlock, string> = {
  "Direct Expenses": "Direct",
  "Indirect Expenses": "Indirect",
  "Purchase Accounts": "Purchase",
};

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
        group: groupOrLedger(r.top_group, sub, r.expense_ledger ?? sub, chains),
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

/** A ledger booked straight under the block has no group of its own — Tally prints the ledger. */
function groupOrLedger(block: string, sub: string, ledger: string, chains: Map<string, string[]>): string {
  const g = pnlGroup(block, sub, chains);
  return g.toUpperCase() === block.toUpperCase() ? ledger : g;
}

/** Every Direct/Indirect expense line of the production company, for the given FYs. */
export async function loadProductionExpenses(fys: string[]): Promise<ExpenseRow[]> {
  if (!fys.length) return [];
  // Group names come from the live book; an older book's chains are the same tree.
  const chains = await groupChains(`acct_orange::${PRODUCTION_COMPANY_GUID}`);
  const perFy = await Promise.all(fys.map((fy) => oneFy(fy, chains)));
  return perFy.flat();
}

/* ------------------------------------------------------------------ which GLs count */

/** One ledger's identity across the screens: the same name can sit in two blocks. */
export const glKey = (block: ExpenseBlock, ledger: string) => `${block}|${ledger}`;

/** What a ledger does when nobody has chosen: overhead counts, purchases (the material) do not. */
export const BLOCK_DEFAULT_ON: Record<ExpenseBlock, boolean> = {
  "Direct Expenses": true,
  "Indirect Expenses": true,
  "Purchase Accounts": false,
};

const GL_STORE = "productionCosting.gls.v1";

function readChoices(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(GL_STORE);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" ? (v as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export interface CostingGls {
  /** Is this ledger added to the cost of a KG? */
  isOn: (block: ExpenseBlock, ledger: string) => boolean;
  /** Tick or untick a set of ledgers at once (a group, a block, a search result). */
  set: (keys: Array<{ block: ExpenseBlock; ledger: string }>, on: boolean) => void;
  /** Forget every choice in one block, back to its default. */
  reset: (block: ExpenseBlock) => void;
}

/**
 * The ledger ticks, shared by the Production Dashboard and the Expenses page and kept in this
 * browser. Only choices that differ from the default are stored, so a ledger Tally adds next month
 * falls in with its block — a new Direct expense counts, a new purchase ledger does not.
 */
export function useCostingGls(): CostingGls {
  const [choices, setChoices] = useState<Record<string, boolean>>(readChoices);

  const save = useCallback((next: Record<string, boolean>) => {
    setChoices(next);
    try { localStorage.setItem(GL_STORE, JSON.stringify(next)); } catch { /* private window: keep it for this visit */ }
  }, []);

  const isOn = useCallback(
    (block: ExpenseBlock, ledger: string) => choices[glKey(block, ledger)] ?? BLOCK_DEFAULT_ON[block],
    [choices],
  );
  const set = useCallback((keys: Array<{ block: ExpenseBlock; ledger: string }>, on: boolean) => {
    const next = { ...choices };
    for (const k of keys) {
      const key = glKey(k.block, k.ledger);
      if (on === BLOCK_DEFAULT_ON[k.block]) delete next[key];
      else next[key] = on;
    }
    save(next);
  }, [choices, save]);
  const reset = useCallback((block: ExpenseBlock) => {
    save(Object.fromEntries(Object.entries(choices).filter(([k]) => !k.startsWith(`${block}|`))));
  }, [choices, save]);

  return { isOn, set, reset };
}

/** A ledger as the picker lists it: the P&L group it prints under, and what it carried in the period. */
export interface GlOption {
  block: ExpenseBlock;
  group: string;
  ledger: string;
  amount: number;
}

/** Every ledger that carried a line in `rows`, one entry per block + ledger. */
export function glOptions(rows: ExpenseRow[]): GlOption[] {
  const m = new Map<string, GlOption>();
  for (const r of rows) {
    const key = glKey(r.block, r.ledger);
    const at = m.get(key);
    if (at) at.amount += r.amount;
    else m.set(key, { block: r.block, group: r.group, ledger: r.ledger, amount: r.amount });
  }
  return [...m.values()];
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
  purchase: number;
  total: number;
  groups: ExpenseGroup[];
}

type BlockSums = Record<ExpenseBlock, number>;
const zeroSums = (): BlockSums => ({ "Direct Expenses": 0, "Indirect Expenses": 0, "Purchase Accounts": 0 });

/** Pass only the ledgers that count. */
export function expenseTotals(rows: ExpenseRow[]): ExpenseTotals {
  const byGroup = new Map<string, ExpenseGroup>();
  const sums = zeroSums();
  for (const r of rows) {
    sums[r.block] += r.amount;
    const key = `${r.block}|${r.group}`;
    const at = byGroup.get(key);
    if (at) { at.amount += r.amount; at.lines++; }
    else byGroup.set(key, { block: r.block, group: r.group, amount: r.amount, share: 0, lines: 1 });
  }
  const groups = [...byGroup.values()].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  for (const g of groups) {
    const t = sums[g.block];
    g.share = t ? (g.amount / t) * 100 : 0;
  }
  const direct = sums["Direct Expenses"];
  const indirect = sums["Indirect Expenses"];
  const purchase = sums["Purchase Accounts"];
  return { direct, indirect, purchase, total: direct + indirect + purchase, groups };
}

/** One block's total out of `ExpenseTotals`. */
export const blockTotal = (t: ExpenseTotals, block: ExpenseBlock) =>
  block === "Direct Expenses" ? t.direct : block === "Indirect Expenses" ? t.indirect : t.purchase;

/* ------------------------------------------------------------------ by month, by ledger */

export interface ExpenseMonth {
  month: string;
  label: string;
  direct: number;
  indirect: number;
  purchase: number;
  total: number;
  /** Finished good produced that month, and the per-KG split it carries. */
  kgs: number;
  directPerKg: number | null;
  indirectPerKg: number | null;
  purchasePerKg: number | null;
  materialPerKg: number | null;
  fullPerKg: number | null;
}

/**
 * Expenses month by month, beside what that month produced — the only honest way to read overhead
 * per KG, since a month that made nothing would otherwise divide by zero and read as infinite cost.
 * `production` is keyed YYYYMM. Pass only the ledgers that count.
 */
export function expensesByMonth(
  rows: ExpenseRow[],
  months: string[],
  production: Map<string, { kgs: number; costPerKg: number | null }>,
): ExpenseMonth[] {
  const acc = new Map<string, BlockSums>();
  for (const r of rows) {
    const ym = r.vch_date.slice(0, 6);
    const at = acc.get(ym) ?? zeroSums();
    at[r.block] += r.amount;
    acc.set(ym, at);
  }
  return months.map((ym) => {
    const e = acc.get(ym) ?? zeroSums();
    const p = production.get(ym) ?? { kgs: 0, costPerKg: null };
    const per = (v: number) => (p.kgs > 0 ? v / p.kgs : null);
    const direct = e["Direct Expenses"], indirect = e["Indirect Expenses"], purchase = e["Purchase Accounts"];
    const d = per(direct);
    const i = per(indirect);
    const pu = per(purchase);
    return {
      month: ym,
      label: monthLabel(ym),
      direct,
      indirect,
      purchase,
      total: direct + indirect + purchase,
      kgs: p.kgs,
      directPerKg: d,
      indirectPerKg: i,
      purchasePerKg: pu,
      materialPerKg: p.costPerKg,
      fullPerKg: p.costPerKg == null ? null : p.costPerKg + (d ?? 0) + (i ?? 0) + (pu ?? 0),
    };
  });
}

export interface ExpenseLedger {
  block: ExpenseBlock;
  group: string;
  ledger: string;
  amount: number;
  lines: number;
  /** Share of its own block's COUNTED total; 0 for a ledger left out. */
  share: number;
  /** Ticked for costing. */
  counted: boolean;
}

/**
 * Every ledger that carried an expense, with the P&L group it rolls into — ticked or not, so a
 * ledger left out can be seen and switched back on. Shares are of what counts.
 */
export function expensesByLedger(
  rows: ExpenseRow[],
  isOn: (block: ExpenseBlock, ledger: string) => boolean = () => true,
): ExpenseLedger[] {
  const m = new Map<string, ExpenseLedger>();
  const sums = zeroSums();
  for (const r of rows) {
    const counted = isOn(r.block, r.ledger);
    if (counted) sums[r.block] += r.amount;
    const key = glKey(r.block, r.ledger);
    const at = m.get(key);
    if (at) { at.amount += r.amount; at.lines++; }
    else m.set(key, { block: r.block, group: r.group, ledger: r.ledger, amount: r.amount, lines: 1, share: 0, counted });
  }
  const out = [...m.values()];
  for (const l of out) {
    const t = sums[l.block];
    l.share = l.counted && t ? (l.amount / t) * 100 : 0;
  }
  return out.sort((a, b) => Number(b.counted) - Number(a.counted) || Math.abs(b.amount) - Math.abs(a.amount));
}

/**
 * What a kilogram really cost: the material Tally put on the batch, plus the ticked expenses of the
 * same period spread over what the period produced. Absorption per KG, the plainest kind — no
 * driver, no apportionment, because nothing in Tally ties an expense to a batch.
 */
export interface CostPerKg {
  materialPerKg: number | null;
  directPerKg: number | null;
  indirectPerKg: number | null;
  purchasePerKg: number | null;
  fullPerKg: number | null;
  kgs: number;
}

export function costPerKg(materialPerKg: number | null, totals: ExpenseTotals, kgs: number): CostPerKg {
  const per = (v: number) => (kgs > 0 ? v / kgs : null);
  const direct = per(totals.direct);
  const indirect = per(totals.indirect);
  const purchase = per(totals.purchase);
  return {
    materialPerKg,
    directPerKg: direct,
    indirectPerKg: indirect,
    purchasePerKg: purchase,
    fullPerKg: materialPerKg == null ? null : materialPerKg + (direct ?? 0) + (indirect ?? 0) + (purchase ?? 0),
    kgs,
  };
}

/** Everything the ticked ledgers add on top of material, per KG. */
export const overheadOf = (p: CostPerKg) => (p.directPerKg ?? 0) + (p.indirectPerKg ?? 0) + (p.purchasePerKg ?? 0);

/** The per-KG figure of one block. */
export const blockPerKg = (p: CostPerKg, block: ExpenseBlock) =>
  block === "Direct Expenses" ? p.directPerKg : block === "Indirect Expenses" ? p.indirectPerKg : p.purchasePerKg;
