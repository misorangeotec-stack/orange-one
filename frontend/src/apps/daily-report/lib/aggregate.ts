/**
 * Daily Report — every derived figure, in one place.
 *
 * The screen reads these, and so will the Excel and PDF exports. That is the
 * point: a report whose page and whose attachment compute their own totals will
 * eventually disagree, and the reader has no way to tell which is wrong.
 *
 * Pure functions over already-loaded rows. No fetching, no React.
 */

// ⚠ TYPE-ONLY IMPORT, DELIBERATELY. `data/dailyReport.ts` imports salesTotals
//   from this file at RUNTIME, so a runtime import back the other way would be a
//   real ES-module cycle whose resolution depends on which module the bundler
//   evaluates first. A `import type` is erased at build, so the runtime
//   dependency runs one way only: data -> lib.
import type { MoneyRow, PartyKind, PurchaseLine, SaleLine } from "../data/dailyReport";
import type { SaleType } from "./saleType";
import type { BankAccount, BankBalance, ReportLocation } from "../types";
import { balanceKey } from "../data/bankBalances";
import { bankCell, type BankCellState } from "./format";

/* --------------------------------------------------------------- location */

export type LocationFilter = "all" | ReportLocation;

export const inLocation = (loc: LocationFilter, rowLocation: string): boolean =>
  loc === "all" || rowLocation.toLowerCase() === loc.toLowerCase();

/**
 * Delhi has no Tally company book — its account sits inside the Orange O Tec
 * Noida book. So a Delhi filter empties the sales, purchase, collection and
 * payment sections BY CONSTRUCTION, and the screen has to say so. An empty table
 * with no explanation reads as a failed query, and someone will report it.
 */
export const isBankOnlyLocation = (loc: LocationFilter): boolean => loc === "Delhi";

/* ------------------------------------------------------------------ sales */

/**
 * How a sales line counts.
 *
 *   sold     — an invoice or challan that is a sale. Counts in qty and money.
 *   foc      — free of charge. Counts in QUANTITY only; the money is zero and is
 *              rendered as a dash, never as 0.00, which reads as a data fault.
 *   approval — goods out on approval (Tally type SOA). NOT a sale yet, and the
 *              client's own sheet excludes them: its 08-09-2026 Enterprise ink
 *              total of 3,128 kg is 3,028 sold plus 100 free, with a 500 kg
 *              approval challan left out. Shown in its own section so the goods
 *              are visible without being counted as revenue.
 *   negative — credit notes, debit notes and returns. Subtract.
 */
/** Credit notes, debit notes and returns — they subtract from the day. */
export function isNegativeType(type: string): boolean {
  const t = type.toLowerCase();
  return t.includes("credit note") || t.includes("return") || t.includes("debit note");
}

export type SaleKind = "sold" | "foc" | "approval" | "negative";

export function saleKind(line: SaleLine): SaleKind {
  if (isNegativeType(line.type)) return "negative";
  if (line.type === "SOA") return "approval";
  if (line.type.toUpperCase().includes("FOC")) return "foc";
  return "sold";
}

export interface SaleGroup {
  saleType: SaleType;
  lines: SaleLine[];
  qty: number;
  /** Net of free-of-charge lines, which carry quantity but no money. */
  revenueLacs: number;
  focQty: number;
  parties: number;
}

/** Group the day's countable sales lines by product line, biggest first. */
export function groupSales(lines: SaleLine[]): SaleGroup[] {
  const by = new Map<SaleType, SaleLine[]>();
  for (const l of lines) {
    const k = saleKind(l);
    if (k === "approval" || k === "negative") continue;
    const list = by.get(l.saleType) ?? [];
    list.push(l);
    by.set(l.saleType, list);
  }
  return [...by.entries()]
    .map(([saleType, group]) => ({
      saleType,
      lines: group,
      qty: group.reduce((s, l) => s + l.qty, 0),
      revenueLacs: group.reduce((s, l) => s + l.revenueLacs, 0),
      focQty: group.filter((l) => saleKind(l) === "foc").reduce((s, l) => s + l.qty, 0),
      parties: new Set(group.map((l) => l.party)).size,
    }))
    .sort((a, b) => b.revenueLacs - a.revenueLacs || b.qty - a.qty);
}

/** One row per party for a product line — how the client's sheet reads. */
export interface PartyTotal {
  party: string;
  company: string;
  location: string;
  qty: number;
  revenueLacs: number;
  foc: boolean;
}

export function byParty(lines: SaleLine[]): PartyTotal[] {
  const by = new Map<string, PartyTotal>();
  for (const l of lines) {
    // Keyed on party AND book: the same customer buying from two entities is two
    // lines on this report, exactly as the reference sheet shows it.
    const key = `${l.party}|${l.company}|${l.location}`;
    const hit = by.get(key) ?? {
      party: l.party, company: l.company, location: l.location,
      qty: 0, revenueLacs: 0, foc: true,
    };
    hit.qty += l.qty;
    hit.revenueLacs += l.revenueLacs;
    // A party is only shown as free-of-charge when EVERY one of its lines is.
    if (saleKind(l) !== "foc") hit.foc = false;
    by.set(key, hit);
  }
  return [...by.values()].sort((a, b) => b.revenueLacs - a.revenueLacs || b.qty - a.qty);
}

/** What the "5 major customers" heading was reaching for, said truthfully. */
export function topShare(rows: PartyTotal[], n = 5): { topLacs: number; totalLacs: number; pct: number } {
  const totalLacs = rows.reduce((s, r) => s + r.revenueLacs, 0);
  const topLacs = rows.slice(0, n).reduce((s, r) => s + r.revenueLacs, 0);
  return { topLacs, totalLacs, pct: totalLacs > 0 ? (topLacs / totalLacs) * 100 : 0 };
}

export interface SalesTotals {
  soldLacs: number;
  returnsLacs: number;
  netLacs: number;
  approvalLacs: number;
  focQty: number;
}

export function salesTotals(lines: SaleLine[]): SalesTotals {
  let soldLacs = 0, returnsLacs = 0, approvalLacs = 0, focQty = 0;
  for (const l of lines) {
    switch (saleKind(l)) {
      case "sold": soldLacs += l.revenueLacs; break;
      // Returns arrive already negative on the register, so this is their
      // magnitude for display; netLacs adds rather than subtracts.
      case "negative": returnsLacs += l.revenueLacs; break;
      case "approval": approvalLacs += l.revenueLacs; break;
      case "foc": focQty += l.qty; break;
    }
  }
  return { soldLacs, returnsLacs, netLacs: soldLacs + returnsLacs, approvalLacs, focQty };
}

/* ------------------------------------------------------------------ money */

export interface MoneyBand {
  kind: PartyKind;
  rows: MoneyRow[];
  totalLacs: number;
}

/**
 * Split receipts or payments into bands, trade first.
 *
 * The order is the argument the report is making: a customer receipt and a
 * transfer between our own accounts are both "money in" to Tally and are not the
 * same event to a CFO.
 */
// ⚠ EVERY PartyKind MUST APPEAR HERE. bandMoney FILTERS on this list, so a kind
//   left out is silently dropped from the bands and from every total built on
//   them — the rows still show in the table, so the table and the headline
//   disagree and nothing says why. Adding a kind to PartyKind means adding it
//   here in the same edit.
const BAND_ORDER: PartyKind[] = ["customer", "vendor", "branch", "bank", "cash", "suspense", "other"];

export function bandMoney(rows: MoneyRow[], direction: "in" | "out"): MoneyBand[] {
  const mine = rows.filter((r) => r.direction === direction);
  const by = new Map<PartyKind, MoneyRow[]>();
  for (const r of mine) {
    const list = by.get(r.kind) ?? [];
    list.push(r);
    by.set(r.kind, list);
  }
  return BAND_ORDER.filter((k) => by.has(k)).map((kind) => {
    const list = (by.get(kind) ?? []).sort((a, b) => b.amountLacs - a.amountLacs);
    return { kind, rows: list, totalLacs: list.reduce((s, r) => s + r.amountLacs, 0) };
  });
}

/** The trade half — what the hand-made sheet has always shown. */
export const TRADE_BANDS: PartyKind[] = ["customer", "vendor"];

export const tradeTotal = (bands: MoneyBand[]): number =>
  bands.filter((b) => TRADE_BANDS.includes(b.kind)).reduce((s, b) => s + b.totalLacs, 0);

export const allBandsTotal = (bands: MoneyBand[]): number =>
  bands.reduce((s, b) => s + b.totalLacs, 0);

/* -------------------------------------------------------------- purchases */

export const purchaseTotal = (rows: PurchaseLine[]): number =>
  rows.reduce((s, r) => s + r.amountLacs, 0);

/* ------------------------------------------------------------------- bank */

export interface BankColumn {
  account: BankAccount;
  entityAlias: string;
}

/**
 * Which accounts get a column.
 *
 * An account that is inactive TODAY but holds a figure somewhere in the window
 * keeps its column — deactivating an account must not erase history from a
 * window that history belongs to.
 */
export function bankColumns(
  accounts: BankAccount[],
  balances: Map<string, BankBalance>,
  dates: string[],
  loc: LocationFilter,
): BankAccount[] {
  return accounts
    .filter((a) => loc === "all" || a.location === loc)
    .filter((a) => a.active || dates.some((d) => balances.has(balanceKey(a.id, d))))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export interface EntityTotal {
  /** Null when any account in this entity is missing a figure for the day. */
  totalLacs: number | null;
  missing: string[];
}

/**
 * An entity's total for one day.
 *
 * ⚠ RETURNS NULL RATHER THAN A PARTIAL SUM when any of its accounts has no
 *   figure. A partial total is a wrong number that looks right, and it is
 *   precisely the number a CFO would quote. The screen prints an em dash and
 *   names what is missing.
 *
 *   A Sunday is not "missing" — nobody was asked — so a Sunday with no entries
 *   at all returns null with an empty `missing` list, which the screen renders
 *   as closed rather than as a gap.
 */
export function entityTotal(
  accounts: BankAccount[],
  balances: Map<string, BankBalance>,
  iso: string,
): EntityTotal {
  let sum = 0;
  const missing: string[] = [];
  for (const a of accounts) {
    const row = balances.get(balanceKey(a.id, iso));
    if (row) sum += row.closingLacs;
    else missing.push(a.name);
  }
  return missing.length > 0 ? { totalLacs: null, missing } : { totalLacs: sum, missing: [] };
}

export function cellFor(
  account: BankAccount,
  balances: Map<string, BankBalance>,
  iso: string,
): BankCellState {
  return bankCell(iso, balances.get(balanceKey(account.id, iso))?.closingLacs);
}

/* --------------------------------------------------------------- facility */

export interface FacilityRow {
  account: BankAccount;
  /** Everything below is ₹ lakhs, and null means genuinely unknown. */
  ccLimit: number | null;
  heldByBank: number | null;
  availableCc: number | null;
  lcBcLimit: number | null;
  lcBcUtilised: number | null;
  lcBcFree: number | null;
  closing: number | null;
}

/**
 * The upper-right block of the reference sheet, recomputed.
 *
 * Two of its seven measures are arithmetic rather than data, and both reproduce
 * the 08-09-2026 sheet exactly:
 *   available CC limit = CC limit − held by bank      (44.50 − 4.50 = 40.00)
 *   LC/BC free limit   = LC/BC limit − utilised       ( 5.00 − 4.78 =  0.22)
 *
 * ⚠ AN UNKNOWN INPUT YIELDS NULL, NOT A NUMBER. A free limit computed from a
 *   missing utilised figure is confidently wrong, which is worse than blank —
 *   and LC/BC utilised is the one figure on this report with no source at all
 *   until somebody types it.
 */
export function facilityRows(
  accounts: BankAccount[],
  balances: Map<string, BankBalance>,
  iso: string,
): FacilityRow[] {
  const sub = (a: number | null, b: number | null) => (a == null || b == null ? null : a - b);
  return accounts
    .filter((a) => a.ccLimitLacs != null || a.lcBcLimitLacs != null)
    .map((account) => {
      const bal = balances.get(balanceKey(account.id, iso));
      return {
        account,
        ccLimit: account.ccLimitLacs,
        heldByBank: account.holdByBankLacs,
        availableCc: sub(account.ccLimitLacs, account.holdByBankLacs),
        lcBcLimit: account.lcBcLimitLacs,
        lcBcUtilised: bal?.lcBcUtilisedLacs ?? null,
        lcBcFree: sub(account.lcBcLimitLacs, bal?.lcBcUtilisedLacs ?? null),
        closing: bal?.closingLacs ?? null,
      };
    });
}
