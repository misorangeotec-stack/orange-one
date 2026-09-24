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
import type { BankAccount, BankBalance, CcLimit, FacilityFigures, ReportLocation } from "../types";
import { balanceKey } from "../data/bankBalances";
import { bankCell, type BankCellState } from "./format";
import { entityRank } from "./labels";

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

/**
 * The MONEY a sales line contributes — nothing, when the goods went free.
 *
 * ⚠ A FREE-OF-CHARGE LINE IS NOT ₹0 IN TALLY. Of 1,913 FOC lines in FY 2026-27
 *   up to 16-09-2026, 1,912 carry a non-zero `revenue`: ink sent free is valued
 *   at a nominal ₹1 a kilogram, and a MACHINE sent free on a challan carries its
 *   full value — GARTEX TEXPROCESS on 30-07-2026 is ₹1.28 Cr. `salesTotals` has
 *   always left that out of the day's figure, as the rule above says. The
 *   product-line total and the party list used to add it back in, so on 30-07
 *   the Machines row on the card read ₹128.59 L more than the Total beneath it
 *   counted, and a free machine would have ranked first in any list sorted by
 *   amount. Every amount in this module goes through here.
 */
export const moneyOf = (line: SaleLine): number => (saleKind(line) === "foc" ? 0 : line.revenueLacs);

export interface SaleGroup {
  saleType: SaleType;
  lines: SaleLine[];
  qty: number;
  /** Free-of-charge lines count in qty and add NOTHING here — see `moneyOf`. */
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
      revenueLacs: group.reduce((s, l) => s + moneyOf(l), 0),
      focQty: group.filter((l) => saleKind(l) === "foc").reduce((s, l) => s + l.qty, 0),
      parties: new Set(group.map((l) => l.party)).size,
    }))
    .sort((a, b) => b.revenueLacs - a.revenueLacs || b.qty - a.qty);
}

/* ------------------------------------------------------------------ pivot */

/** One customer's business with one company. */
export interface PivotCell {
  qty: number;
  amountLacs: number;
  /** The part of `qty` that went free of charge. */
  focQty: number;
}

/**
 * One customer, across every company — a row of the What sold, Money in and
 * Money out tables.
 *
 * `cells` is keyed on the company ALIAS ("O-tec", "Enterprise", "Colorix"), so a
 * company's Surat and Noida books add into one cell.
 */
export interface PivotRow {
  party: string;
  cells: Record<string, PivotCell>;
  qty: number;
  amountLacs: number;
  focQty: number;
  /** Every line was free of charge. Never folded; listed at the foot of its block. */
  focOnly: boolean;
  /** Lines (sales) or vouchers (money) behind the row. */
  entries: number;
  /** The voucher numbers behind the row, for a tooltip. */
  refs: string[];
}

const emptyRow = (party: string): PivotRow => ({
  party, cells: {}, qty: 0, amountLacs: 0, focQty: 0, focOnly: true, entries: 0, refs: [],
});

const addToCell = (row: PivotRow, company: string, qty: number, amountLacs: number, focQty: number) => {
  const cell = row.cells[company] ?? { qty: 0, amountLacs: 0, focQty: 0 };
  cell.qty += qty;
  cell.amountLacs += amountLacs;
  cell.focQty += focQty;
  row.cells[company] = cell;
  row.qty += qty;
  row.amountLacs += amountLacs;
  row.focQty += focQty;
};

const addRef = (row: PivotRow, ref: string | null | undefined) => {
  row.entries += 1;
  if (ref && !row.refs.includes(ref)) row.refs.push(ref);
};

/** Biggest first, on the row's total across EVERY company. */
const byAmount = (a: PivotRow, b: PivotRow): number =>
  b.amountLacs - a.amountLacs || b.qty - a.qty || a.party.localeCompare(b.party);

/**
 * One row per CUSTOMER for a product line, with the companies across the top.
 *
 * ⚠ THIS REVERSES AN EARLIER DECISION, DELIBERATELY. The function it replaced
 *   (`byParty`) keyed on party + company + location, so "the same customer buying
 *   from two entities is two lines on this report, exactly as the reference
 *   sheet shows it." On 17-09-2026 Ritesh Bhai asked for the opposite: one row
 *   per customer, one column per company, and no location split (the location
 *   filter still narrows). It is his report and his call. Do not restore the
 *   per-book rows as a "fix".
 *
 * Pass `SaleGroup.lines` — returns and goods on approval are already out.
 */
export function pivotSales(lines: SaleLine[]): PivotRow[] {
  const by = new Map<string, PivotRow>();
  for (const l of lines) {
    const row = by.get(l.party) ?? emptyRow(l.party);
    const foc = saleKind(l) === "foc";
    addToCell(row, l.company, l.qty, moneyOf(l), foc ? l.qty : 0);
    if (!foc) row.focOnly = false;
    addRef(row, l.voucherNo);
    by.set(l.party, row);
  }
  return [...by.values()].sort(byAmount);
}

/** One row per counterparty for a set of receipts or payments, companies across the top. */
export function pivotMoney(rows: MoneyRow[]): PivotRow[] {
  const by = new Map<string, PivotRow>();
  for (const r of rows) {
    const row = by.get(r.party) ?? emptyRow(r.party);
    row.focOnly = false;
    addToCell(row, r.entity, 0, r.amountLacs, 0);
    addRef(row, r.voucherNo);
    by.set(r.party, row);
  }
  return [...by.values()].sort(byAmount);
}

/** A company column. */
export interface PivotCompany {
  alias: string;
  /**
   * A book `ext_company_map` does not know. Its rows arrive under Tally's raw
   * company label, or under nothing at all.
   *
   * ⚠ SURFACED, NEVER SILENT. A column headed "—" beside O-tec and Enterprise
   *   reads as a third company, and its money looks accounted for. Every render
   *   heads it "Unmapped" and says which book to tag.
   */
  unmapped: boolean;
}

/**
 * The company columns for ONE LIST — only the companies its rows actually touch,
 * in print order.
 *
 * ⚠ PER LIST, NOT PER PAGE, AND THAT IS THE USER'S CALL (17-09-2026). Colorix
 *   trades on a handful of days a month (7 sales lines on 3 days from 01-08 to
 *   17-09-2026, no receipts or payments in September), so a column for it is
 *   empty almost every day. Columns taken across a page put an empty Colorix
 *   column into the Ink table whenever Colorix sold a single spare part; taken
 *   per list, a company appears only where it has a customer. The cost, accepted:
 *   the Ink and Print heads tables on one page can have different columns.
 *
 * Several row sets may still be passed where one sheet holds several lists (the
 * workbook's Receipts sheet carries every band).
 */
export function pivotCompanies(...sets: PivotRow[][]): PivotCompany[] {
  const seen = new Set<string>();
  for (const rows of sets) for (const r of rows) for (const k of Object.keys(r.cells)) seen.add(k);
  return [...seen]
    .sort((a, b) => entityRank(a) - entityRank(b) || a.localeCompare(b))
    .map((alias) => ({ alias, unmapped: entityRank(alias) === 99 }));
}

/** What a company column is headed. The SHORT alias, the same words the portal uses. */
export const companyColumnLabel = (c: PivotCompany): string =>
  c.unmapped ? (c.alias ? `Unmapped: ${c.alias}` : "Unmapped book") : c.alias;

/** Whether a cell went free: not at all, entirely, or in part. */
export function cellFoc(c: PivotCell | undefined): "none" | "all" | "part" {
  if (!c || c.focQty <= 0) return "none";
  return Math.abs(c.qty - c.focQty) < 1e-9 ? "all" : "part";
}

/* ------------------------------------------------------------------- fold */

/**
 * THE FOLD RULE — decided with Ritesh Bhai, 17-09-2026. One place, read by the
 * screen, the PDF and the workbook.
 *
 *   · A list of FOLD_MIN customers or fewer shows every one.
 *   · Above that, customers are named biggest first until they cover FOLD_SHARE
 *     of the list's total; the rest fold into one "Remaining N" line, and a
 *     TOTAL follows so the list still adds up to the figure on page one.
 *   · FREE-OF-CHARGE IS NEVER FOLDED. Goods sent free still cost money and
 *     management must see every one. A customer who is only free of charge is
 *     named at the foot of the block; one with a paid sale AND a free one keeps
 *     its place among the named rows, wherever the 80% cut falls.
 *   · A remainder of ONE customer is named instead (the user's call, 17-09-2026):
 *     "Remaining 1 customer" takes the same line as the name, and hides it.
 *
 * It is the answer to the client's own question of 14-09-2026 — whether his old
 * sheet listed only the large receipts on purpose, and at what cut-off.
 */
export const FOLD_MIN = 10;
export const FOLD_SHARE = 0.8;

export interface FoldTotals {
  count: number;
  qty: number;
  amountLacs: number;
  focQty: number;
  cells: Record<string, PivotCell>;
}

export interface Folded {
  /** Every row, biggest first — what "Show all" and the workbook list. */
  all: PivotRow[];
  /** Rows named above the Remaining line, biggest first. */
  named: PivotRow[];
  /** Null when nothing folded. */
  remaining: (FoldTotals & { rows: PivotRow[] }) | null;
  /** Free-of-charge-only customers, named below the Remaining line. */
  focOnly: PivotRow[];
  total: FoldTotals;
}

function sumRows(rows: PivotRow[]): FoldTotals {
  const out: FoldTotals = { count: rows.length, qty: 0, amountLacs: 0, focQty: 0, cells: {} };
  for (const r of rows) {
    out.qty += r.qty;
    out.amountLacs += r.amountLacs;
    out.focQty += r.focQty;
    for (const [k, c] of Object.entries(r.cells)) {
      const t = out.cells[k] ?? { qty: 0, amountLacs: 0, focQty: 0 };
      t.qty += c.qty;
      t.amountLacs += c.amountLacs;
      t.focQty += c.focQty;
      out.cells[k] = t;
    }
  }
  return out;
}

/**
 * Apply the fold rule to one list.
 *
 * ⚠ RANKED ONCE, ON THE ROW TOTAL ACROSS ALL COMPANIES. Ranking inside each
 *   company column would name a customer under O-tec and fold the same customer
 *   under Enterprise, and the rows would stop adding up to their own TOTAL.
 */
export function foldList(rows: PivotRow[]): Folded {
  const all = [...rows].sort(byAmount);
  const total = sumRows(all);
  const focOnly = all.filter((r) => r.focOnly);
  const ranked = all.filter((r) => !r.focOnly);

  let named: PivotRow[] = [];
  let rest: PivotRow[] = [];
  if (all.length <= FOLD_MIN || total.amountLacs <= 0) {
    named = ranked;
  } else {
    const cut = FOLD_SHARE * total.amountLacs;
    let cum = 0;
    for (const r of ranked) {
      // Named while the rows ABOVE it have not yet reached the cut, so the row
      // that carries the list across 80% is itself named.
      if (cum < cut) {
        named.push(r);
        cum += r.amountLacs;
      } else if (r.focQty > 0) {
        named.push(r);
      } else {
        rest.push(r);
      }
    }
    if (rest.length === 1) {
      named = [...named, rest[0]].sort(byAmount);
      rest = [];
    }
  }

  return {
    all,
    named,
    remaining: rest.length > 0 ? { ...sumRows(rest), rows: rest } : null,
    focOnly,
    total,
  };
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

/**
 * WHICH ACCOUNTS MAKE UP A COMPANY'S "AVAILABLE BALANCE" — the one place that says.
 *
 * Today: every account of the company, i.e. the same accounts as the company
 * total on the entry screen and in the balance grid. That is what DR-1 asked for
 * ("fill itself from that company's bank total"), and on the client's 08-09-2026
 * sheet the figure (2.45) is exactly its own Orange O Tec bank total.
 *
 * ⚠ UNCONFIRMED, AND PROBABLY NOT THE SAME SET. The sheet's Orange O Tec bank
 *   table sums TWO columns, AXIS-ST and NOIDA. This entity holds FIVE accounts:
 *   it adds the ICICI 0014 cash-credit account and the Delhi account, and it is
 *   not known which Axis account "AXIS-ST" is. A cash-credit balance is borrowing,
 *   so adding it into an available balance may be wrong in sign as well as in
 *   scope. It cannot be checked against data — no balance had been saved when
 *   this was written. Ask Ritesh Bhai before trusting the figure; if the answer
 *   is a narrower set, change THIS function and FACILITY_BALANCE_NOTE, and every
 *   render follows.
 */
export function facilityBalanceAccounts(entityAccounts: BankAccount[]): BankAccount[] {
  return entityAccounts;
}

/** What `facilityBalanceAccounts` counts, in words, for every render to print. */
export const FACILITY_BALANCE_NOTE =
  "Available balance is the company's bank total for the day, across all its accounts, and stays blank until every one of them is entered.";

export interface FacilityRow {
  /** mst_companies.alias. The block is per COMPANY, never per book or location. */
  entityAlias: string;
  bank: string;
  /** Everything below is ₹ lakhs, and null means genuinely unknown. */
  ccLimit: number | null;
  /** Derived — the company's bank total. See `facilityBalanceAccounts`. */
  availableBalance: number | null;
  /** The accounts still without a figure, which is why availableBalance is null. */
  balanceMissing: string[];
  lcBcLimit: number | null;
  lcBcUtilised: number | null;
  /** Derived — LC/BC limit − utilised. */
  lcBcFree: number | null;
  heldByBank: number | null;
  /** Derived — CC limit − held by bank. */
  availableCc: number | null;
}

/**
 * One company's credit-limit block, from its four typed figures and its accounts.
 *
 * The upper-right block of the reference sheet. Three of its seven measures are
 * arithmetic rather than data, and all three reproduce the 08-09-2026 sheet:
 *   available balance  = the company's bank total    (2.37 + 0.08 = 2.45)
 *   LC/BC free limit   = LC/BC limit − utilised      (5.00 − 4.78 = 0.22)
 *   available CC limit = CC limit − held by bank     (44.50 − 4.50 = 40.00)
 *
 * Called with STORED figures by the report page, the PDF and the workbook, and
 * with the figures still being TYPED by the entry screen — one piece of
 * arithmetic, so the form cannot preview a number the report then disagrees with.
 *
 * ⚠ AN UNKNOWN INPUT YIELDS NULL, NOT A NUMBER. A free limit computed from a
 *   missing utilised figure is confidently wrong, which is worse than blank.
 *
 * ⚠ A COMPANY WITH NO ACCOUNTS HAS NO BALANCE, NOT A ZERO ONE. `entityTotal` of
 *   an empty list is a clean 0 with nothing missing, so it is guarded here.
 */
export function facilityFor(
  entityAlias: string,
  bank: string,
  entityAccounts: BankAccount[],
  balances: Map<string, BankBalance>,
  figures: FacilityFigures | undefined,
  iso: string,
): FacilityRow {
  const sub = (a: number | null, b: number | null) => (a == null || b == null ? null : a - b);
  const counted = facilityBalanceAccounts(entityAccounts);
  const total = counted.length > 0 ? entityTotal(counted, balances, iso) : { totalLacs: null, missing: [] };
  const f: FacilityFigures = figures ?? {
    ccLimitLacs: null, lcBcLimitLacs: null, lcBcUtilisedLacs: null, holdByBankLacs: null,
  };
  return {
    entityAlias,
    bank,
    ccLimit: f.ccLimitLacs,
    availableBalance: total.totalLacs,
    balanceMissing: total.missing,
    lcBcLimit: f.lcBcLimitLacs,
    lcBcUtilised: f.lcBcUtilisedLacs,
    lcBcFree: sub(f.lcBcLimitLacs, f.lcBcUtilisedLacs),
    heldByBank: f.holdByBankLacs,
    availableCc: sub(f.ccLimitLacs, f.holdByBankLacs),
  };
}

/**
 * Every company block RECORDED for a day — the report's Bank facility section.
 *
 * One row per stored company + bank. A company nobody typed a block for has NO
 * row, never a row of zeros; that is also why Colorix, which has no block on the
 * client's sheet, appears only once somebody enters one.
 *
 * ⚠ PASS EVERY ACCOUNT, NOT THE LOCATION-FILTERED ONES. A facility is sanctioned
 *   to a company. Handing this a Surat-only account list would make Orange O
 *   Tec's available balance its Surat cash and call it the company's.
 */
export function facilityRows(
  accounts: BankAccount[],
  balances: Map<string, BankBalance>,
  limits: Map<string, CcLimit>,
  iso: string,
): FacilityRow[] {
  const byEntity = new Map<string, BankAccount[]>();
  for (const a of accounts) {
    const list = byEntity.get(a.entityAlias) ?? [];
    list.push(a);
    byEntity.set(a.entityAlias, list);
  }
  return [...limits.values()]
    .filter((l) => l.date === iso)
    .sort((x, y) => entityRank(x.entityAlias) - entityRank(y.entityAlias) || x.bank.localeCompare(y.bank))
    .map((l) => facilityFor(l.entityAlias, l.bank, byEntity.get(l.entityAlias) ?? [], balances, l, iso));
}
