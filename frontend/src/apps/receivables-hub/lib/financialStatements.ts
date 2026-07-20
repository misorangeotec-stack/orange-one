/**
 * Balance Sheet + Profit & Loss, sourced from the ConnectWave (Tally) mirror.
 *
 * WHY TWO NUMBERS PER LINE
 * Tally's own Trial Balance is authoritative, but summing the ledgers we mirror does NOT always
 * reproduce it: a bulk Ledger collection under-reports forex and bill-wise ledgers, so the two can
 * disagree (measured 19-Jul-2026: Sales off Rs 2.04 cr on the import-heavy book, Rs 30 on NOIDA).
 * We therefore carry BOTH — Tally's figure is displayed, ours is the counterpart, and the gap between
 * them is the reconcile finding. Neither alone would have surfaced the forex problem.
 *
 * TWO ADJUSTMENTS TALLY ITSELF MAKES (verified against a live Tally P&L, 19-Jul-2026)
 *  1. The Trial Balance carries stock at its OPENING value inside Current Assets. A Balance Sheet needs
 *     CLOSING stock, so Current Assets is restated by -opening +closing. Without this the sheet is out
 *     by the stock movement.
 *  2. The Trial Balance's "Profit & Loss A/c" line is the OPENING (brought-forward) balance, whereas the
 *     P&L A/c LEDGER closing already includes the current period's result. The Balance Sheet uses the
 *     LEDGER value; adding a separately-computed profit on top would double-count it.
 * With both applied, NOIDA balances to exactly 0.00.
 */
import { getConnectwaveSupabase } from "./connectwaveSupabase";
import { fetchCompanyMap, makeCompanyResolver } from "./companyMap";

/** Tally's primary groups, keyed to where each belongs on a statement. */
const LIABILITY_GROUPS = [
  "Capital Account", "Loans (Liability)", "Current Liabilities", "Suspense A/c", "Provisions",
] as const;
const ASSET_GROUPS = [
  "Fixed Assets", "Investments", "Current Assets", "Loans & Advances (Asset)",
  "Misc. Expenses (ASSET)", "Branch / Divisions",
] as const;
const INCOME_GROUPS = ["Sales Accounts", "Direct Incomes", "Indirect Incomes"] as const;
const EXPENSE_GROUPS = ["Purchase Accounts", "Direct Expenses", "Indirect Expenses"] as const;

const PL_ACCOUNT = "Profit & Loss A/c";

export type FsSide = "Liabilities" | "Assets" | "Income" | "Expense";
export type FsStatement = "Balance Sheet" | "Profit & Loss";

/**
 * Classify a line by its TOP-LEVEL ancestor. An unrecognised top level (a custom primary group, or one
 * whose group chain is broken by a rename) falls back to the sign, which keeps its total on the correct
 * side even though it cannot be nested — see `unresolved` on FsCompany.
 */
export function classify(topLevel: string, closing: number): { statement: FsStatement; side: FsSide } {
  if ((LIABILITY_GROUPS as readonly string[]).includes(topLevel)) return { statement: "Balance Sheet", side: "Liabilities" };
  if ((ASSET_GROUPS as readonly string[]).includes(topLevel)) return { statement: "Balance Sheet", side: "Assets" };
  if ((INCOME_GROUPS as readonly string[]).includes(topLevel)) return { statement: "Profit & Loss", side: "Income" };
  if ((EXPENSE_GROUPS as readonly string[]).includes(topLevel)) return { statement: "Profit & Loss", side: "Expense" };
  if (topLevel === PL_ACCOUNT) return { statement: "Balance Sheet", side: closing < 0 ? "Liabilities" : "Assets" };
  return { statement: "Balance Sheet", side: closing >= 0 ? "Assets" : "Liabilities" };
}

export interface FsCompany {
  companyGuid: string;
  /** Friendly name from ext_company_map; falls back to the raw Tally book name. */
  company: string;
  location: string;
  rawName: string;
  asOf: string;
  fromDate: string;
  openingStock: number;
  closingStock: number;
}

/** One line of the statement. `tally` is authoritative; `ours` is the mirror's counterpart. */
export interface FsNode {
  name: string;
  kind: "group" | "ledger" | "computed";
  parent: string | null;
  topLevel: string;
  statement: FsStatement;
  side: FsSide;
  /** Dr-positive, straight from Tally. */
  tally: number;
  /** Dr-positive rollup of the ledgers we mirror. null when there is no counterpart (computed lines). */
  ours: number | null;
  /** tally - ours; null when `ours` is null. Non-zero is a reconcile finding. */
  gap: number | null;
  ledgerGuid: string | null;
  children: FsNode[];
  /** Synthetic rows (Gross Profit, Nett Profit, stock) are computed, not sourced from Tally. */
  synthetic?: boolean;
}

interface RawLine {
  company_guid: string; company_name: string; name: string; seq: number;
  kind: "group" | "ledger" | "computed"; parent: string | null; top_level: string;
  tally_closing: number; our_closing: number | null; ledger_guid: string | null;
  as_of: string; from_date: string;
}

interface RawCompany {
  company_guid: string; company_name: string; as_of: string; from_date: string;
  opening_stock: number; closing_stock: number;
}

export interface FsData {
  companies: FsCompany[];
  /** Statement lines per company_guid, already nested. */
  linesByCompany: Record<string, FsNode[]>;
  /** Lines whose name matched no master, so they could not be nested (still counted). */
  unresolvedByCompany: Record<string, string[]>;
}

/** PostgREST caps a response at 1000 rows; page with a UNIQUE order key or rows silently duplicate. */
async function fetchAllLines(): Promise<RawLine[]> {
  const cw = getConnectwaveSupabase();
  const out: RawLine[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await cw
      .from("v_fs_line")
      .select("company_guid,company_name,name,seq,kind,parent,top_level,tally_closing,our_closing,ledger_guid,as_of,from_date")
      .order("company_guid", { ascending: true })
      .order("seq", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as RawLine[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export async function loadFinancialStatements(): Promise<FsData> {
  const cw = getConnectwaveSupabase();
  const [lines, companyRes, mapRows] = await Promise.all([
    fetchAllLines(),
    cw.from("v_fs_company").select("company_guid,company_name,as_of,from_date,opening_stock,closing_stock"),
    fetchCompanyMap(),
  ]);
  if (companyRes.error) throw new Error(companyRes.error.message);

  const resolve = makeCompanyResolver(mapRows);
  const rawCompanies = (companyRes.data ?? []) as RawCompany[];

  const companies: FsCompany[] = rawCompanies
    .map((c) => {
      // The resolver keys on tenant_id; rebuild the tenant form it expects from the company GUID.
      const id = resolve(`acct_orange::${c.company_guid}`, c.company_name);
      return {
        companyGuid: c.company_guid,
        company: id.company || c.company_name,
        location: id.location || "",
        rawName: c.company_name,
        asOf: c.as_of,
        fromDate: c.from_date,
        openingStock: Number(c.opening_stock) || 0,
        closingStock: Number(c.closing_stock) || 0,
      };
    })
    .sort((a, b) => a.company.localeCompare(b.company) || a.location.localeCompare(b.location));

  const linesByCompany: Record<string, FsNode[]> = {};
  const unresolvedByCompany: Record<string, string[]> = {};

  for (const c of companies) {
    const mine = lines.filter((l) => l.company_guid === c.companyGuid);
    const nodes = new Map<string, FsNode>();
    for (const l of mine) {
      const tally = Number(l.tally_closing) || 0;
      const ours = l.our_closing === null ? null : Number(l.our_closing) || 0;
      const { statement, side } = classify(l.top_level, tally);
      nodes.set(l.name, {
        name: l.name, kind: l.kind, parent: l.parent, topLevel: l.top_level,
        statement, side, tally, ours, gap: ours === null ? null : tally - ours,
        ledgerGuid: l.ledger_guid, children: [],
      });
    }
    // Nest: a line whose parent is present becomes its child; everything else is a root. Tally emits
    // parents before children, so insertion order already yields the display order Tally uses.
    const roots: FsNode[] = [];
    for (const n of nodes.values()) {
      const p = n.parent ? nodes.get(n.parent) : undefined;
      if (p && p !== n) p.children.push(n);
      else roots.push(n);
    }
    linesByCompany[c.companyGuid] = roots;
    unresolvedByCompany[c.companyGuid] = mine.filter((l) => l.kind === "computed").map((l) => l.name);
  }

  return { companies, linesByCompany, unresolvedByCompany };
}

/**
 * Two lines ALWAYS differ by design, and reporting them as problems would bury the real ones:
 *  - Current Assets: Tally's Trial Balance carries stock inside it; our ledger rollup cannot (under
 *    integrated accounts+inventory the Stock-in-Hand ledger is zero). The gap is the stock value.
 *  - Profit & Loss A/c: the Trial Balance line is the brought-forward balance; the ledger closing
 *    already includes the current period's result. The gap is that result.
 */
const EXPECTED_GAP_LINES = new Set(["Current Assets", "Profit & Loss A/c"]);

/**
 * Tally's PROVISIONAL bill memos. "Sales Bills to Make" is goods delivered but not yet invoiced;
 * "Purchase Bills to Come" is goods received but not yet billed. Tally folds them into the group
 * totals it displays, but they are not ledger postings, so our rollup cannot contain them.
 *
 * Verified 19-Jul-2026: EVERY remaining gap across all four companies equalled one of these to the
 * paisa — Rs 2.04 cr, Rs 6.79 L, Rs 1.73 L and even the long-unexplained Rs 30. They are accounting
 * reality, not data loss, so reporting them as findings would be crying wolf.
 */
const MEMO_LINES = ["Sales Bills to Make", "Purchase Bills to Come"];

/** Collect the provisional-bill amounts a company carries, so gaps equal to them can be excused. */
function memoAmounts(roots: FsNode[]): number[] {
  const out: number[] = [];
  const walk = (n: FsNode) => {
    if (MEMO_LINES.includes(n.name)) out.push(n.tally);
    n.children.forEach(walk);
  };
  roots.forEach(walk);
  return out;
}

/** A plain-English account of why a difference is legitimate, shown to the reader on hover. */
export interface GapExplanation {
  /** Two or three words for the badge next to the amount. */
  label: string;
  /** Full explanation — written for someone who does not know how the sync works. */
  detail: string;
}

/**
 * Explains a difference, or returns null if it is a genuine finding.
 *
 * The STATEMENT rows and the reconcile summary share this one function, so the two can never
 * contradict each other — a row rendered as a red problem while the summary says "nothing unexplained"
 * is worse than either alone (it happened, and it was rightly confusing).
 */
export function makeGapExplainer(roots: FsNode[]): (gap: number | null, name: string) => GapExplanation | null {
  const salesMemo = memoAmounts(roots.filter(() => true));
  const named = (n: string) => {
    const found: number[] = [];
    const walk = (x: FsNode) => { if (x.name === n) found.push(x.tally); x.children.forEach(walk); };
    roots.forEach(walk);
    return found;
  };
  const toMake = named("Sales Bills to Make");
  const toCome = named("Purchase Bills to Come");
  const matches = (list: number[], gap: number) =>
    list.some((m) => Math.abs(Math.abs(m) - Math.abs(gap)) < 0.005);

  return (gap, name) => {
    if (gap === null || Math.abs(gap) < 0.005) return null;

    // Provisional-bill matching comes FIRST. On the Balance Sheet, Current Assets has already been
    // restated to include closing stock, so whatever remains there is an un-invoiced bill, not stock —
    // labelling it "stock" would be actively misleading.
    if (matches(toMake, gap)) {
      return {
        label: "Not yet invoiced",
        detail:
          "You have sent out goods but have not raised the invoice yet. Tally still counts them as a " +
          "sale because the goods left your premises, but with no invoice there is no accounting entry, " +
          "so our side has nothing to count. This difference disappears on its own once you raise those " +
          "invoices in Tally. Nothing is missing.",
      };
    }
    if (matches(toCome, gap)) {
      return {
        label: "Bill not yet received",
        detail:
          "You have received goods but the supplier has not sent the bill yet. Tally counts the purchase " +
          "because the goods arrived, but with no bill there is no accounting entry, so our side has " +
          "nothing to count. This clears itself once the supplier's bill is entered in Tally. Nothing is " +
          "missing.",
      };
    }

    if (name === "Current Assets") {
      return {
        label: "Stock",
        detail:
          "Tally includes the value of your stock inside Current Assets. Stock is not an accounting " +
          "entry in any ledger — it comes from the inventory side of Tally — so our ledger total cannot " +
          "contain it. The difference is simply the stock value. Both figures are correct.",
      };
    }
    if (name === "Profit & Loss A/c") {
      return {
        label: "This year's profit",
        detail:
          "Tally's Trial Balance shows the profit brought forward from earlier years, while the ledger " +
          "balance also includes this year's profit or loss so far. The difference between them is " +
          "exactly this year's result. Both figures are correct — they cover different periods.",
      };
    }
    if (matches(toMake, gap)) {
      return {
        label: "Not yet invoiced",
        detail:
          "You have sent out goods but have not raised the invoice yet. Tally still counts them as a " +
          "sale because the goods left your premises, but with no invoice there is no accounting entry, " +
          "so our side has nothing to count. This difference disappears on its own once you raise those " +
          "invoices in Tally. Nothing is missing.",
      };
    }
    if (matches(toCome, gap)) {
      return {
        label: "Bill not yet received",
        detail:
          "You have received goods but the supplier has not sent the bill yet. Tally counts the purchase " +
          "because the goods arrived, but with no bill there is no accounting entry, so our side has " +
          "nothing to count. This clears itself once the supplier's bill is entered in Tally. Nothing is " +
          "missing.",
      };
    }
    if (salesMemo.length === 0) return null;
    return null;
  };
}

export interface FsFinding {
  company: string;
  name: string;
  kind: FsNode["kind"];
  /** Which statement the account belongs to, so a page only lists its OWN findings. */
  statement: FsStatement;
  /** Ancestors above this account, e.g. ["Purchase Accounts"] — tells the reader where to expand. */
  path: string[];
  tally: number;
  ours: number;
  gap: number;
}

/**
 * Real reconcile findings: lines where Tally disagrees with our mirrored ledgers for a reason that is
 * NOT by design. These are genuine — a bulk Ledger collection under-reports forex and bill-wise
 * ledgers, so vouchers can be missing from our side. They typically appear in PAIRS that offset (a
 * debtor gap against a matching sales gap), which is the signature of specific invoices.
 */
export function findings(roots: FsNode[], companyLabel: string, only?: FsStatement): FsFinding[] {
  const memos = memoAmounts(roots);
  const explainedByMemo = (gap: number) => memos.some((m) => Math.abs(Math.abs(m) - Math.abs(gap)) < 0.005);
  const out: FsFinding[] = [];
  const walk = (n: FsNode, path: string[]) => {
    if (
      n.ours !== null && n.gap !== null && Math.abs(n.gap) >= 0.005 &&
      !EXPECTED_GAP_LINES.has(n.name) && !explainedByMemo(n.gap)
    ) {
      out.push({
        company: companyLabel, name: n.name, kind: n.kind, statement: n.statement, path,
        tally: n.tally, ours: n.ours, gap: n.gap,
      });
    }
    n.children.forEach((c) => walk(c, [...path, n.name]));
  };
  roots.forEach((r) => walk(r, []));
  // A parent and its child often carry the SAME gap (the child is the cause, the parent inherits it).
  // Keep the deepest occurrence of each amount so the list points at the cause, not the roll-up.
  const seen = new Map<string, FsFinding>();
  for (const f of out) {
    const key = `${f.statement}|${f.gap.toFixed(2)}`;
    const prev = seen.get(key);
    // Prefer the DEEPER row: a parent inherits its child's gap, and the child is the actual cause.
    if (!prev || f.path.length > prev.path.length) seen.set(key, f);
  }
  return [...seen.values()]
    .filter((f) => !only || f.statement === only)
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
}

/**
 * AS-OF DATE SUPPORT
 *
 * Our `ours` column is each ledger's full CLOSINGBALANCE, which in Tally's ledger export includes
 * vouchers dated anywhere in the open book — INCLUDING future/post-dated entries (annual insurance,
 * scheduled EMIs, etc.). Tally's own Trial Balance / P&L report, however, is run "as of" a date and
 * excludes anything dated after it. So the two legitimately disagree by exactly the out-of-window
 * vouchers (verified to the paisa on the Surat book, 20-Jul-2026: every P&L gap = its future-dated
 * entries).
 *
 * To make our column line up with Tally, we let the user pick a window [from, to] (to defaults to the
 * snapshot's as-of date) and subtract each ledger's vouchers dated OUTSIDE it. This is done entirely
 * in the web view — no connector or DB change — reading the anon-granted tally_voucher_line directly.
 * The Tally column itself is a fixed snapshot and cannot be re-sliced, so the comparison is exact only
 * at to = the snapshot date; other dates move our side alone (documented in the UI).
 */
const OOW_PAGE = 1000;

/** yyyy-mm-dd → yyyymmdd (tally_voucher_line.vch_date is a yyyymmdd string, sorts lexically). */
const isoToYmd = (iso: string): string => iso.replace(/-/g, "");

/** A company to trim: its guid and the statement's from_date, which is the FY-start FLOOR (see below). */
export interface OowCompany {
  companyGuid: string;
  fromDate: string; // yyyy-mm-dd — the trial balance's from_date
}

/**
 * Per-company, per-ledger Dr-positive sum of vouchers dated OUTSIDE the window [fromIso, toIso] — the
 * amount to remove from that ledger's `ours` so the column reads "as of" the window. Keyed by
 * company_guid then ledger_guid.
 *
 * CRITICAL — the FY-start floor. A company's book can span more than one financial year (Surat runs
 * 1-Apr-25 → 31-Mar-27), so tally_voucher_line holds prior-FY lines too. But a P&L ledger's closing
 * balance is the CURRENT FY's net only — it never contained those prior-FY lines. Subtracting them
 * would corrupt `ours` (and pulling 150k+ prior-FY rows would blow the anon timeout). So every query is
 * clamped `vch_date >= from_date` (the statement's own basis): we only ever touch this-FY vouchers, and
 * by default (from = from_date) the pre-`from` branch is empty, leaving just the small future set.
 */
export async function fetchOutOfWindow(
  companies: OowCompany[],
  fromIso: string | null,
  toIso: string | null,
): Promise<Record<string, Record<string, number>>> {
  const out: Record<string, Record<string, number>> = {};
  if (companies.length === 0 || (!fromIso && !toIso)) return out;

  const cw = getConnectwaveSupabase();
  const toYmd = toIso ? isoToYmd(toIso) : null;
  const fromYmd = fromIso ? isoToYmd(fromIso) : null;

  await Promise.all(
    companies.map(async (c) => {
      const floor = isoToYmd(c.fromDate); // never subtract anything before the statement's FY start
      const bucket: Record<string, number> = (out[c.companyGuid] = {});

      for (let from = 0; ; from += OOW_PAGE) {
        // Outside window, within this FY = vch_date >= floor AND (vch_date > to OR vch_date < from).
        const clauses: string[] = [];
        if (toYmd) clauses.push(`vch_date.gt.${toYmd}`);
        if (fromYmd) clauses.push(`vch_date.lt.${fromYmd}`);
        const { data, error } = await cw
          .from("tally_voucher_line")
          .select("ledger_guid,amount,is_cancelled,is_optional")
          .eq("tenant_id", `acct_orange::${c.companyGuid}`)
          .gte("vch_date", floor)
          .or(clauses.join(","))
          .order("voucher_guid", { ascending: true })
          .range(from, from + OOW_PAGE - 1);
        if (error) throw new Error(error.message);
        const rows = (data ?? []) as {
          ledger_guid: string | null; amount: number | string | null;
          is_cancelled: boolean | null; is_optional: boolean | null;
        }[];
        for (const r of rows) {
          if (r.is_cancelled || r.is_optional || !r.ledger_guid) continue;
          // Dr-positive convention matches v_ledger_detail.closing = -1 × the raw voucher amount.
          bucket[r.ledger_guid] = (bucket[r.ledger_guid] ?? 0) - (Number(r.amount) || 0);
        }
        if (rows.length < OOW_PAGE) break;
      }
    }),
  );
  return out;
}

/**
 * Return a copy of the tree with every node's `ours` (and `gap`) reduced by its subtree's out-of-window
 * vouchers, so the statement reads "as of" the chosen window. A group's adjustment is the sum of its
 * descendant ledgers' — matching how the server rolls `our_closing` up the group chain. With an empty
 * map the values are unchanged (only the objects are new).
 */
export function adjustRootsAsOf(roots: FsNode[], adjByGuid: Record<string, number>): FsNode[] {
  const build = (n: FsNode): { node: FsNode; subtree: number } => {
    const own = n.ledgerGuid ? adjByGuid[n.ledgerGuid] ?? 0 : 0;
    const kids = n.children.map(build);
    const subtree = own + kids.reduce((s, k) => s + k.subtree, 0);
    const ours = n.ours === null ? null : n.ours - subtree;
    return {
      node: { ...n, children: kids.map((k) => k.node), ours, gap: ours === null ? null : n.tally - ours },
      subtree,
    };
  };
  return roots.map((r) => build(r).node);
}

/** Sum of a top-level group's Tally figure, 0 when the company has no such group. */
function topLevelTally(roots: FsNode[], name: string): number {
  return roots.filter((n) => n.name === name).reduce((s, n) => s + n.tally, 0);
}

function findRoot(roots: FsNode[], name: string): FsNode | undefined {
  return roots.find((n) => n.name === name);
}

export interface StatementColumn {
  /** Rows in display order. */
  rows: FsNode[];
  total: number;
  /** Same total computed from OUR ledgers, so the column foots on both sides. */
  totalOurs: number | null;
}

export interface PnlView {
  /** Trading account: Dr side / Cr side, ending in Gross Profit. */
  left: StatementColumn;
  right: StatementColumn;
  /** Profit & loss account: Indirect Expenses / Nett Profit vs Gross Profit b/f + Indirect Incomes. */
  left2: StatementColumn;
  right2: StatementColumn;
  grossProfit: number;
  nettProfit: number;
  /** The same two results recomputed from OUR ledgers — the point of comparison. */
  grossProfitOurs: number;
  nettProfitOurs: number;
}

/**
 * Build the classic two-column P&L Tally renders.
 *
 * grossProfit = (sales + direct incomes + closing stock) - (opening stock + purchases + direct expenses)
 * nettProfit  = grossProfit + indirect incomes - indirect expenses
 *
 * Verified against a live Tally P&L for ORANGE O TEC PRIVATE LIMITED-NOIDA (1-Apr-26 to 18-Jul-26):
 * Gross Profit Rs 1,28,06,785.28 and Nett Profit Rs 78,01,619.88, both exact.
 */
export function buildPnl(roots: FsNode[], c: FsCompany): PnlView {
  // Income groups arrive Cr-negative in the Dr-positive convention; negate for display.
  const sales = -topLevelTally(roots, "Sales Accounts");
  const directIncomes = -topLevelTally(roots, "Direct Incomes");
  const indirectIncomes = -topLevelTally(roots, "Indirect Incomes");
  const purchases = topLevelTally(roots, "Purchase Accounts");
  const directExp = topLevelTally(roots, "Direct Expenses");
  const indirectExp = topLevelTally(roots, "Indirect Expenses");

  // Same six figures from OUR ledgers. Where a group has no counterpart we fall back to Tally's, so a
  // missing rollup cannot silently drag the computed profit to nonsense.
  const o = (name: string, negate = false) => {
    const r = findRoot(roots, name);
    const v = r ? (r.ours ?? r.tally) : 0;
    return negate ? -v : v;
  };
  const salesO = o("Sales Accounts", true);
  const directIncomesO = o("Direct Incomes", true);
  const indirectIncomesO = o("Indirect Incomes", true);
  const purchasesO = o("Purchase Accounts");
  const directExpO = o("Direct Expenses");
  const indirectExpO = o("Indirect Expenses");

  // Tally's Trial Balance states Opening Stock itself; our counterpart is the sum of the stock-item
  // masters. Showing BOTH turns a previously unchecked figure into a real comparison. Closing stock has
  // no Trial Balance line, so there is only one source and both columns carry it.
  const openingStockTally = topLevelTally(roots, "Opening Stock") || c.openingStock;

  const grossProfit =
    sales + directIncomes + c.closingStock - (openingStockTally + purchases + directExp);
  const nettProfit = grossProfit + indirectIncomes - indirectExp;

  const grossProfitOurs =
    salesO + directIncomesO + c.closingStock - (c.openingStock + purchasesO + directExpO);
  const nettProfitOurs = grossProfitOurs + indirectIncomesO - indirectExpO;

  const stockRow = (name: string, tally: number, ours: number): FsNode => ({
    name, kind: "computed", parent: null, topLevel: name,
    statement: "Profit & Loss", side: name === "Opening Stock" ? "Expense" : "Income",
    tally, ours, gap: tally - ours, ledgerGuid: null, children: [], synthetic: true,
  });

  const pick = (n: string, negate = false): FsNode[] => {
    const r = findRoot(roots, n);
    if (!r) return [];
    return [negate ? { ...r, tally: -r.tally, ours: r.ours === null ? null : -r.ours } : r];
  };

  const left: FsNode[] = [
    stockRow("Opening Stock", openingStockTally, c.openingStock),
    ...pick("Purchase Accounts"),
    ...pick("Direct Expenses"),
  ];
  const right: FsNode[] = [
    ...pick("Sales Accounts", true),
    ...pick("Direct Incomes", true),
    stockRow("Closing Stock", c.closingStock, c.closingStock),
  ];
  const left2: FsNode[] = [...pick("Indirect Expenses")];
  const right2: FsNode[] = [...pick("Indirect Incomes", true)];

  const sum = (rows: FsNode[], useOurs: boolean) =>
    rows.reduce((s, r) => s + (useOurs ? (r.ours ?? r.tally) : r.tally), 0);

  return {
    left: {
      rows: left,
      total: sum(left, false) + Math.max(grossProfit, 0),
      totalOurs: sum(left, true) + Math.max(grossProfitOurs, 0),
    },
    right: { rows: right, total: sum(right, false), totalOurs: sum(right, true) },
    left2: {
      rows: left2,
      total: sum(left2, false) + Math.max(nettProfit, 0),
      totalOurs: sum(left2, true) + Math.max(nettProfitOurs, 0),
    },
    right2: {
      rows: right2,
      total: sum(right2, false) + Math.max(grossProfit, 0) + Math.max(-nettProfit, 0),
      totalOurs: sum(right2, true) + Math.max(grossProfitOurs, 0) + Math.max(-nettProfitOurs, 0),
    },
    grossProfit,
    nettProfit,
    grossProfitOurs,
    nettProfitOurs,
  };
}

export interface BalanceSheetView {
  liabilities: StatementColumn;
  assets: StatementColumn;
  /** liabilities.total - assets.total; should be 0. Non-zero is shown, never hidden. */
  difference: number;
}

/**
 * Build the two-column Balance Sheet.
 *
 * Applies the two Tally adjustments described in the file header: Current Assets is restated from
 * opening to closing stock, and Profit & Loss A/c uses the LEDGER closing (which already contains the
 * period result) rather than the Trial Balance's brought-forward figure.
 *
 * Display convention: each side shows a positive number for its natural balance, so a liability's
 * Cr balance and an asset's Dr balance both read positive. A contra balance shows negative, exactly
 * as Tally prints it.
 */
export function buildBalanceSheet(roots: FsNode[], c: FsCompany): BalanceSheetView {
  const stockDelta = c.closingStock - c.openingStock;

  const rows = roots
    .filter((n) => n.statement === "Balance Sheet")
    // Tally prints Opening/Closing Stock as memo lines on the Trial Balance. We restate Current Assets
    // to closing stock below, so leaving these in would count the stock a second time (measured: NOIDA
    // out by exactly its opening stock, Rs 3.27 cr, until they were dropped).
    .filter((n) => n.name !== "Opening Stock" && n.name !== "Closing Stock")
    .map((n) => {
      // Any restatement below MUST also restate `ours` and recompute `gap`. Adjusting only `tally`
      // left the row showing a stale gap while the column footed to a different number — the row read
      // Rs 3.31 cr while Tally-minus-ours was Rs 3.72 cr, the difference being the stock movement.
      if (n.name === "Current Assets") {
        // Tally's Trial Balance carries OPENING stock inside Current Assets; a Balance Sheet needs
        // CLOSING. Our ledger rollup contains NO stock at all (Stock-in-Hand is zero under integrated
        // accounts+inventory), so closing stock is added to our side rather than swapped.
        const tally = n.tally + stockDelta;
        const ours = n.ours === null ? null : n.ours + c.closingStock;
        return { ...n, tally, ours, gap: ours === null ? null : tally - ours };
      }
      if (n.name === PL_ACCOUNT && n.ours !== null) {
        // The ledger closing already includes the current period's result, so it IS the figure a
        // Balance Sheet wants. Both columns then carry it and the gap is genuinely nil.
        return { ...n, tally: n.ours, gap: 0 };
      }
      return n;
    });

  const liabilities = rows.filter((n) => n.side === "Liabilities").map((n) => ({ ...n, tally: -n.tally, ours: n.ours === null ? null : -n.ours }));
  const assets = rows.filter((n) => n.side === "Assets");

  const sum = (rs: FsNode[], useOurs: boolean) =>
    rs.reduce((s, r) => s + (useOurs ? (r.ours ?? r.tally) : r.tally), 0);

  const lTotal = sum(liabilities, false);
  const aTotal = sum(assets, false);

  return {
    liabilities: { rows: liabilities, total: lTotal, totalOurs: sum(liabilities, true) },
    assets: { rows: assets, total: aTotal, totalOurs: sum(assets, true) },
    difference: lTotal - aTotal,
  };
}
