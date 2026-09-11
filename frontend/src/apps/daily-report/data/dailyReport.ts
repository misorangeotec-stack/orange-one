/**
 * Daily Report — one day of the business, assembled from the Tally mirror.
 *
 * FOUR READS, ALL AGAINST CONNECTWAVE, ALL REUSED RATHER THAN REBUILT:
 *
 *   · `loadSalesRegister`  (@hub/lib/salesRegister) — the day's invoice and
 *     challan LINES: party, item, quantity, revenue net of tax. Already resolves
 *     each row's company and location from ext_company_map by GUID, which is why
 *     this module never reads `company_label` or `location` off the table. Both
 *     are name-derived guesses that Tally re-mints every April.
 *
 *   · `loadDayBookMulti`   (@hub/lib/dayBook) — the day's MONEY: collection and
 *     payment totals, the voucher list behind them, and the purchase figure.
 *     One precomputed RPC per book, folded in the browser. Measured at 0.8s on
 *     the 5,174-ledger Orange O Tec Surat book, where the live views over raw
 *     JSON time out entirely — which is why nothing here reads those.
 *
 *   · `rpt_purchase_item` — the day's purchase LINES. Its `amount` is net of tax
 *     and ties exactly to the day book's purchase figure (proved on 09-09-2026:
 *     Enterprise Surat, four lines summing to ₹14,92,007.50, equal to the KPI).
 *
 *   · `v_ledger_detail` — what each counterparty IS. See classifyParty below;
 *     without it a ₹70 L transfer to the company's own cash-credit account reads
 *     as a supplier payment.
 *
 * Money is converted to LAKHS at this boundary and stays in lakhs from here on.
 */

import { useQuery } from "@tanstack/react-query";

import { getConnectwaveSupabase } from "@hub/lib/connectwaveSupabase";
import { fetchCompanyMap } from "@hub/lib/companyMap";
import {
  loadLastRegisterRefresh, loadRegisterCompanies, loadSalesRegister, type RegisterRow,
} from "@hub/lib/salesRegister";
import { loadDayBookMulti, type DayBookData, type DayCompanyRef } from "@hub/lib/dayBook";

import { isoToYmd, toLacs } from "../lib/format";
import { loadSaleTypeRuleset, type SaleType } from "../lib/saleType";
import { salesTotals } from "../lib/aggregate";

/* ------------------------------------------------------------------- rows */

/** How a counterparty relates to us — the band a money row is filed under. */
export type PartyKind = "customer" | "vendor" | "branch" | "bank" | "cash" | "suspense" | "other";

export const PARTY_KIND_LABEL: Record<PartyKind, string> = {
  customer: "Customer",
  vendor: "Supplier",
  branch: "Inter-company",
  bank: "Bank transfer",
  cash: "Cash",
  // Named rather than folded into Other: a suspense posting is money whose
  // counterparty is not yet decided, and on 08-09-2026 there was ₹2.21 L of it
  // sitting in what would otherwise read as customer collections.
  suspense: "Suspense",
  other: "Other",
};

/** One receipt or payment on the day. */
export interface MoneyRow {
  id: string;
  direction: "in" | "out";
  party: string;
  /** The book it came from, when several are combined. */
  company: string | null;
  voucherNo: string | null;
  voucherType: string | null;
  kind: PartyKind;
  amountLacs: number;
}

/** One outward sales line on the day. */
export interface SaleLine {
  id: string;
  company: string;
  location: string;
  party: string;
  item: string;
  /** SALE / BRANCH SALE / FOC SALE / SOA / Credit Note … straight off the register. */
  type: string;
  voucherType: string;
  voucherNo: string;
  /** SALE or DC — whether the goods left on an invoice or on a challan. */
  paper: "SALE" | "DC";
  saleType: SaleType;
  qty: number;
  revenueLacs: number;
}

/** One purchase line on the day. */
export interface PurchaseLine {
  id: string;
  company: string;
  location: string;
  party: string;
  item: string;
  stockGroup: string | null;
  voucherType: string;
  qty: number;
  unit: string | null;
  amountLacs: number;
}

export interface DailyReportData {
  date: string;
  sales: SaleLine[];
  money: MoneyRow[];
  purchases: PurchaseLine[];
  /**
   * Month to date, on EXACTLY the same rule as the day figure: net of returns,
   * excluding goods out on approval.
   *
   * `dailyNetLacs` is the per-day series rather than just a total, because the
   * KPI hint reports the MEDIAN working day, not the mean. Two high-seas machine
   * deals on 02-09-2026 put ₹12.21 Cr into a month whose other days run ₹45 L to
   * ₹1.25 Cr; the mean then reads ₹2.50 Cr a day, which is arithmetically true
   * and describes no day that has ever happened.
   */
  mtd: { salesLacs: number; dailyNetLacs: number[] };
  dayBook: DayBookData;
  /** False when sale_type_rule could not be read; the page says so out loud. */
  rulesLoaded: boolean;
  /**
   * When each book's register was last rebuilt.
   *
   * ⚠ THE DIFFERENCE BETWEEN "no sales" AND "no sales YET". The register is
   *   rebuilt through the evening as the sync runs; a reader opening the page at
   *   6pm on the current day is looking at a partial day, and nothing else on the
   *   screen would tell them so. On a past date it is simply reassurance.
   */
  freshness: { label: string; builtAt: string | null }[];
}

/* ------------------------------------------------------------- classifying */

/**
 * What a counterparty is, from its Tally group chain.
 *
 * ⚠ THIS IS WHY THE COLLECTION FIGURE IS NOT ONE NUMBER.
 *   On 08-09-2026 the Orange O Tec book recorded ₹35.73 L of receipts, of which
 *   ₹8.30 L was the company's own Noida branch and ₹2.21 L was a suspense
 *   account; and ₹1.27 Cr of payments, of which ₹85.89 L was movement on its own
 *   Axis cash-credit account. The hand-made sheet this report replaces showed
 *   ₹5.36 L and ₹34.10 L — trade counterparties only. Both readings are
 *   defensible; what is not defensible is showing one number and not saying
 *   which. So every row is banded and the bands are totalled separately.
 *
 * Classified on `group_chain`, the full ancestor array, not on `grouping` alone
 * — a bank ledger filed under a user-made sub-group would otherwise read as
 * whatever that sub-group's root happens to be.
 */
/**
 * ⚠ MATCHED EXACTLY AND CASE-INSENSITIVELY AGAINST THE REAL GROUP NAMES.
 *
 *   Measured across all five books on 11-09-2026, these are the root groups that
 *   decide a band — and two traps are visible only by looking:
 *
 *     · "Cash-in-Hand" carries a CAPITAL H in `v_ledger_detail.group_chain`,
 *       while `v_ledger_group.sub_group` spells the same group "Cash-in-hand".
 *       A case-sensitive test against either spelling misses half the data; the
 *       first cut of this code did exactly that and filed petty cash as Other.
 *     · "Bank Account" (singular) exists alongside "Bank Accounts".
 *
 *   And the reason this is an exact set rather than a /bank/i test: the books
 *   also carry "BANK CHARGES", "OTHER BANK CHARGES",
 *   "BANK CHARGES-IMPORT DIRECT PAYMENT", "BANK CHARGES-LC-BC" and
 *   "BANK LC-BC LIMIT". Those are EXPENSE groups. A substring match would file
 *   every bank charge as a transfer between our own accounts.
 */
const norm = (s: string) => s.trim().toLowerCase();

const BANK_GROUPS = new Set(["bank accounts", "bank account", "bank od a/c", "bank occ a/c"]);
const CASH_GROUPS = new Set(["cash-in-hand"]);
const BRANCH_GROUPS = new Set(["branch / divisions", "branch sales"]);
const SUSPENSE_GROUPS = new Set(["suspense a/c"]);

export function classifyParty(chain: string[] | null | undefined): PartyKind {
  const c = (chain ?? []).map(norm);
  if (c.some((g) => BANK_GROUPS.has(g))) return "bank";
  if (c.some((g) => CASH_GROUPS.has(g))) return "cash";
  if (c.some((g) => BRANCH_GROUPS.has(g))) return "branch";
  if (c.some((g) => SUSPENSE_GROUPS.has(g))) return "suspense";
  // A sister entity filed under Sundry Debtors in its OWN book rather than
  // under Branch / Divisions. The group name says "related party" in as many
  // words, so this reads it rather than guessing from the ledger's name.
  if (c.some((g) => g.includes("related part"))) return "branch";
  if (c.includes("sundry debtors")) return "customer";
  if (c.includes("sundry creditors")) return "vendor";
  return "other";
}

/**
 * What each counterparty IS, keyed by (BOOK, ledger name).
 *
 * ⚠ NOT BY NAME ALONE, AND THE DIFFERENCE IS ₹8.30 LAKH.
 *   "ORANGE O TEC PRIVATE LIMITED(NOIDA)" is filed under `Branch / Divisions`
 *   in the O-tec Surat book — where the 08-09-2026 receipts against it actually
 *   sit — and under `BALANCE WITH RELATED PARTY(Debtors) > Sundry Debtors` in
 *   the Enterprise Surat book. Keyed by name, whichever row PostgREST returned
 *   first decided the band, and the first cut of this filed the company's own
 *   inter-branch money as customer collections: the single distinction this
 *   report exists to make, got wrong by a join.
 *
 *   The day book labels each voucher with the book it came from, so the label is
 *   mapped back to a company GUID and the lookup is keyed on that.
 */
async function fetchPartyKinds(
  names: string[],
  guidByLabel: Map<string, string>,
): Promise<Map<string, PartyKind>> {
  const out = new Map<string, PartyKind>();
  /** Ledger names any book files under Tally's own Suspense group. */
  const suspenseNames = new Set<string>();
  const unique = [...new Set(names.filter(Boolean))];
  if (unique.length === 0) return out;

  const cw = getConnectwaveSupabase();
  // PostgREST puts the `in` list in the URL, so it is chunked rather than sent
  // as one very long line that a proxy may refuse.
  const CHUNK = 120;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    const { data, error } = await cw
      .from("v_ledger_detail")
      .select("tenant_id,ledger,group_chain")
      .in("ledger", slice);
    if (error) {
      console.warn("[daily-report] could not classify counterparties; every row will read as Other.", error);
      return out;
    }
    for (const r of data ?? []) {
      // tenant_id is "acct_orange::<guid>" and may carry a ~FY suffix on a
      // split book; the bare GUID is what identifies the company.
      const guid = String(r.tenant_id).split("::")[1]?.split("~")[0] ?? "";
      const key = `${guid}|${r.ledger}`;
      const kind = classifyParty(r.group_chain as string[] | null);
      if (!out.has(key)) out.set(key, kind);
      // ⚠ SUSPENSE WINS ACROSS BOOKS, AND NOTHING ELSE DOES.
      //   Tally files SUSPENSE A/C under its own "Suspense A/c" group in three
      //   of the five books and under "Sundry Debtors" in the O-tec Surat book.
      //   Read per book, the Surat one therefore reads as a CUSTOMER — and now
      //   that the headline counts customers and suppliers only, that put ₹5.85 L
      //   of undecided money inside the figure a CFO reads as collections.
      //   A suspense account is not a trade counterparty in any book, so the most
      //   specific filing Tally itself gives the ledger anywhere is taken as the
      //   answer everywhere. This is still Tally's classification, just not the
      //   loosest one; it is NOT a rule keyed on the ledger's name.
      if (kind === "suspense") suspenseNames.add(r.ledger);
    }
  }

  for (const [key, kind] of out) {
    const name = key.slice(key.indexOf("|") + 1);
    if (kind !== "suspense" && suspenseNames.has(name)) out.set(key, "suspense");
  }
  // Keep the map addressable by label, which is what the caller holds.
  const byLabel = new Map<string, PartyKind>();
  for (const [label, guid] of guidByLabel) {
    for (const name of unique) {
      const hit = out.get(`${guid}|${name}`);
      if (hit) byLabel.set(`${label}|${name}`, hit);
    }
  }
  return byLabel;
}

/* ----------------------------------------------------------- the assembly */

/** Goods that left on a challan rather than an invoice. */
const isChallan = (voucherType: string): boolean => /^DELIVERY\b/i.test(voucherType.trim());

const registerId = (r: RegisterRow) => `${r.tenant_id}|${r.voucher_no}|${r.line_no}`;

async function fetchPurchases(dateYmd: string, tenants: string[]): Promise<PurchaseLine[]> {
  if (tenants.length === 0) return [];
  const cw = getConnectwaveSupabase();
  const { data, error } = await cw
    .from("rpt_purchase_item")
    .select("tenant_id, line_no, voucher_guid, vch_date, voucher_type, party, stock_item, stock_group, qty, amount")
    .eq("vch_date", dateYmd)
    .in("tenant_id", tenants);
  if (error) throw new Error(error.message);

  const map = new Map<string, { company: string; location: string }>();
  for (const c of await fetchCompanyMap()) {
    map.set(c.company_guid, { company: c.company, location: c.location });
  }

  return (data ?? []).map((r) => {
    const guid = String(r.tenant_id).split("::")[1]?.split("~")[0] ?? "";
    const id = map.get(guid);
    // ⚠ qty arrives as TEXT carrying its unit — "40.000 KGS". Split it; never
    //   sum the string, and never assume the unit is kilograms.
    const raw = String(r.qty ?? "").trim();
    const m = raw.match(/^(-?[\d.,]+)\s*(.*)$/);
    return {
      id: `${r.tenant_id}|${r.voucher_guid}|${r.line_no}`,
      company: id?.company ?? "—",
      location: id?.location ?? "—",
      party: r.party ?? "—",
      item: r.stock_item ?? "—",
      stockGroup: r.stock_group ?? null,
      voucherType: r.voucher_type ?? "",
      qty: m ? Number(m[1].replace(/,/g, "")) || 0 : 0,
      unit: m && m[2] ? m[2] : null,
      amountLacs: toLacs(r.amount),
    };
  });
}

/**
 * When each book's register last rebuilt. Never throws: a missing freshness line
 * is a cosmetic loss, and failing the whole report for it would trade a real
 * page for a caption.
 */
async function loadFreshness(): Promise<{ label: string; builtAt: string | null }[]> {
  try {
    const books = await loadRegisterCompanies();
    return await Promise.all(
      books.map(async (b) => ({
        label: b.label,
        builtAt: (await loadLastRegisterRefresh(b.tenantId))?.ran_at ?? null,
      })),
    );
  } catch (e) {
    console.warn("[daily-report] could not read when the register last rebuilt.", e);
    return [];
  }
}

export async function loadDailyReport(dateIso: string): Promise<DailyReportData> {
  const dayYmd = isoToYmd(dateIso);
  const monthStartYmd = isoToYmd(`${dateIso.slice(0, 7)}-01`);

  const companyRows = await fetchCompanyMap();
  const companies: DayCompanyRef[] = companyRows.map((c) => ({
    guid: c.company_guid,
    label: `${c.company} — ${c.location}`,
  }));

  const [rules, dayRows, mtdRows, dayBook, freshness] = await Promise.all([
    loadSaleTypeRuleset(),
    loadSalesRegister(dayYmd, dayYmd),
    loadSalesRegister(monthStartYmd, dayYmd),
    loadDayBookMulti(companies, dayYmd),
    loadFreshness(),
  ]);

  const toSaleLine = (r: RegisterRow): SaleLine => ({
    id: registerId(r),
    company: r.company,
    location: r.location_name,
    party: r.party,
    item: r.particulars,
    type: r.type,
    voucherType: r.voucher_type,
    voucherNo: r.voucher_no,
    paper: isChallan(r.voucher_type) ? "DC" : "SALE",
    saleType: rules.resolve(r.voucher_type, r.voucher_no),
    qty: Number(r.quantity) || 0,
    revenueLacs: toLacs(r.revenue),
  });

  const sales: SaleLine[] = dayRows.map(toSaleLine);

  // The day book's voucher list IS the collection and payment detail. `kind`
  // there is the VOUCHER's class (receipt / payment / contra / …); the band a
  // row is filed under comes from the COUNTERPARTY, which is a different
  // question and needs the ledger read below.
  const cashKinds = new Set(["receipt", "payment"]);
  const cashVouchers = (dayBook.vouchers ?? []).filter((v) => cashKinds.has(v.kind));
  const guidByLabel = new Map(companies.map((c) => [c.label, c.guid]));
  // loadDayBookMulti short-circuits for a SINGLE company and returns that book's
  // payload unmerged — and an unmerged payload carries no `company` on its
  // vouchers. Without this the key would be "|PARTY" and every row would fall to
  // Other the moment the company map holds one row.
  const soleLabel = companies.length === 1 ? companies[0].label : null;
  const kinds = await fetchPartyKinds(cashVouchers.map((v) => v.party ?? ""), guidByLabel);

  const money: MoneyRow[] = cashVouchers.map((v, i) => ({
    // The payload carries no stable line key, and one party can pay twice in a
    // day, so the index is part of the key — a colliding React key remounts
    // rows mid-render and can swap two rows' values.
    id: `${v.kind}|${v.voucher_no ?? ""}|${v.party ?? ""}|${i}`,
    direction: v.kind === "receipt" ? "in" : "out",
    party: v.party ?? "—",
    company: v.company ?? null,
    voucherNo: v.voucher_no || null,
    voucherType: v.voucher_type || null,
    // Keyed by the BOOK the voucher came from, not by the party's name alone.
    kind: kinds.get(`${v.company ?? soleLabel ?? ""}|${v.party ?? ""}`) ?? "other",
    amountLacs: toLacs(v.amount),
  }));

  const tenants = [...new Set(dayRows.map((r) => r.tenant_id))];
  const purchases = await fetchPurchases(dayYmd, tenants);

  // Month to date, through the SAME mapping and the SAME totals function as the
  // day. The first cut summed the raw rows with a different predicate — it kept
  // approvals and ignored returns — so the headline said ₹76.87 L on one rule
  // and the run rate beside it used another. Measured on 08-09-2026: ₹17.49 Cr
  // the right way against ₹17.95 Cr the wrong one.
  const mtdLines = mtdRows.map(toSaleLine);
  const byDay = new Map<string, SaleLine[]>();
  for (let i = 0; i < mtdRows.length; i++) {
    const d = mtdRows[i].vch_date;
    const list = byDay.get(d) ?? [];
    list.push(mtdLines[i]);
    byDay.set(d, list);
  }
  const dailyNetLacs = [...byDay.values()].map((lines) => salesTotals(lines).netLacs);
  const mtdSalesLacs = salesTotals(mtdLines).netLacs;

  return {
    date: dateIso,
    sales,
    money,
    purchases,
    mtd: { salesLacs: mtdSalesLacs, dailyNetLacs },
    dayBook,
    rulesLoaded: rules.loaded,
    freshness,
  };
}

export function useDailyReport(dateIso: string) {
  return useQuery({
    queryKey: ["daily-report", "day", dateIso],
    queryFn: () => loadDailyReport(dateIso),
    // The register rebuilds through the evening, so a CFO refreshing at 21:00
    // must not be served the 19:00 figures out of cache.
    staleTime: 60_000,
    enabled: Boolean(dateIso),
  });
}
