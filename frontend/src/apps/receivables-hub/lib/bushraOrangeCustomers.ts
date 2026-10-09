/**
 * ORANGE vs NON-ORANGE CUSTOMERS — who runs our machine, and who only buys our ink.
 *
 *   Orange       the customer bought a MACHINE from us in the window (and, normally, our ink too).
 *                One who has a machine but no ink yet is still Orange, tagged "no ink yet" — the
 *                machine base the ink team should be chasing.
 *   Non-Orange   bought our INK in the window, but no machine from us.
 *   (neither)    no machine and no ink (heads / spares / paper only) — in neither bucket.
 *
 * THE CUSTOMER IS THE HUB CUSTOMER GROUP, not the Tally ledger. A machine goes out on the
 * customer's machine-order ledger and the ink on a separate ink ledger, so ledger by ledger every
 * machine buyer would look like a customer with no ink. `ext_ledger_group` (the Customer Group the
 * Collection and Outstanding reports use) puts those ledgers under one name; that is what is
 * classified. A ledger with no group stands as its own customer and is flagged, so the mapping can
 * be fixed in Masters.
 *
 * THE WINDOW is the last two financial years to today (the business's call, 2026-10-09), pure sales
 * only — no FOC, branch or related-party lines (isPureSale, the Sales dashboard's own rule). A machine
 * counts when its NET quantity in the window is above zero, so one sold and returned does not.
 * The bucket is decided on EVERY company's lines: a machine billed by O-tec and ink billed by
 * Enterprise is one Orange customer. The dashboard's filters only narrow the figures shown.
 *
 * Kept free of React and the browser, like lib/bushraSalesFigures.ts.
 */
import { getConnectwaveSupabase } from "./connectwaveSupabase";
import { fetchAll } from "./musterApi";
import { isPureSale } from "./bushraSalesDashboards";
import { DIMS, productOf } from "./bushraSalesFigures";
import type { BushraRegisterRow } from "./bushraSalesRegister";

type Row = BushraRegisterRow;

export type Bucket = "Orange" | "Non-Orange";
export const BUCKETS: Bucket[] = ["Orange", "Non-Orange"];

/* --------------------------------------------------------------- the link */

/** (tenant, ledger name) → hub Customer Group, and whether the ledger has one at all. */
export interface GroupLink {
  of: (tenantId: string, ledger: string) => { group: string; grouped: boolean };
}

const linkKey = (tenantId: string, ledger: string) => `${tenantId}|${ledger.trim().toUpperCase()}`;

/**
 * Customer Groups are keyed by the Tally ledger GUID; a register line carries only its book (tenant)
 * and the ledger NAME. v_ledger_detail joins the two. Names are not unique across books (387 repeat),
 * so the book is part of the key. A ledger the GUID route misses falls back to its name in
 * ext_ledger_group, but only when that name means ONE group everywhere — never a guess between two.
 */
export async function loadGroupLink(): Promise<GroupLink> {
  const cw = getConnectwaveSupabase();
  const ledgers: { tenant_id: string; guid: string; ledger: string }[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await cw.from("v_ledger_detail")
      .select("tenant_id,guid,ledger")
      .contains("group_chain", ["Sundry Debtors"])
      .order("tenant_id", { ascending: true })
      .order("guid", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Customer ledgers: ${error.message}`);
    const page = (data ?? []) as typeof ledgers;
    ledgers.push(...page);
    if (page.length < PAGE) break;
  }
  const groups = await fetchAll<{ ledger_id: string; tally_name: string | null; group_name: string | null }>(
    "ext_ledger_group", "ledger_id,tally_name,group_name", "ledger_id");

  const byGuid = new Map<string, string>();
  const byName = new Map<string, Set<string>>();
  for (const g of groups) {
    const name = g.group_name?.trim();
    if (!name) continue;
    if (g.ledger_id) byGuid.set(g.ledger_id, name);
    if (g.tally_name) {
      const k = g.tally_name.trim().toUpperCase();
      (byName.get(k) ?? byName.set(k, new Set()).get(k)!).add(name);
    }
  }
  const byLedger = new Map<string, string>();
  for (const l of ledgers) {
    const g = byGuid.get(l.guid);
    if (g) byLedger.set(linkKey(l.tenant_id, l.ledger), g);
  }
  return {
    of: (tenantId, ledger) => {
      const hit = byLedger.get(linkKey(tenantId, ledger));
      if (hit) return { group: hit, grouped: true };
      const named = byName.get(ledger.trim().toUpperCase());
      if (named?.size === 1) return { group: [...named][0], grouped: true };
      return { group: ledger.trim(), grouped: false };
    },
  };
}

/* ------------------------------------------------------------ the figures */

export interface LedgerLine {
  ledger: string;
  company: string;
  location: string;
  machineQty: number; machineVal: number;
  inkQty: number; inkVal: number;
  headsSparesVal: number; otherVal: number;
  total: number;
}

export interface CustomerFigures {
  group: string;
  /** False when no ledger of this customer is mapped to a Customer Group. */
  grouped: boolean;
  bucket: Bucket;
  /** Orange, with a machine but no ink bought in the window. */
  noInk: boolean;
  ledgers: LedgerLine[];
  companies: string[];
  locations: string[];
  machineQty: number; machineVal: number;
  inkQty: number; inkVal: number;
  headsSparesVal: number; otherVal: number;
  total: number;
  /** YYYYMMDD — first machine line in the window, "" when none. */
  firstMachine: string;
  /** YYYYMMDD — last ink sale in the window, "" when none. */
  lastInk: string;
  /** YYYYMMDD — the customer's last line of any kind. */
  lastSale: string;
}

type Acc = Omit<CustomerFigures, "bucket" | "noInk" | "ledgers" | "companies" | "locations"> & {
  ledgerMap: Map<string, LedgerLine>; companySet: Set<string>; locationSet: Set<string>;
};

const blankLine = (ledger: string, company: string, location: string): LedgerLine => ({
  ledger, company, location, machineQty: 0, machineVal: 0, inkQty: 0, inkVal: 0, headsSparesVal: 0, otherVal: 0, total: 0,
});

/** Adds one line's money and quantity to whichever product it is. */
function addTo(t: Pick<LedgerLine, "machineQty" | "machineVal" | "inkQty" | "inkVal" | "headsSparesVal" | "otherVal" | "total">, r: Row) {
  const p = productOf(r.sales_type);
  t.total += r.revenue;
  if (p === "Machine") { t.machineQty += r.quantity; t.machineVal += r.revenue; }
  else if (p === "Ink") { t.inkQty += r.quantity; t.inkVal += r.revenue; }
  else if (p === "Heads" || p === "Spare Parts") t.headsSparesVal += r.revenue;
  else t.otherVal += r.revenue;
}

/** Sums lines into one record per Customer Group. */
export function aggregate(rows: Row[], link: GroupLink): Map<string, Acc> {
  const out = new Map<string, Acc>();
  for (const r of rows) {
    const { group, grouped } = link.of(r.tenant_id, r.party);
    let a = out.get(group);
    if (!a) {
      a = {
        group, grouped, machineQty: 0, machineVal: 0, inkQty: 0, inkVal: 0, headsSparesVal: 0, otherVal: 0, total: 0,
        firstMachine: "", lastInk: "", lastSale: "",
        ledgerMap: new Map(), companySet: new Set(), locationSet: new Set(),
      };
      out.set(group, a);
    }
    if (grouped) a.grouped = true;
    const company = DIMS.company(r), location = DIMS.location(r);
    // Per BOOK, not per company label: the Surat and Noida books both read "ORANGE O TEC".
    const lk = `${r.tenant_id}|${r.party}`;
    const line = a.ledgerMap.get(lk) ?? blankLine(r.party, company, location);
    a.ledgerMap.set(lk, line);
    a.companySet.add(company);
    a.locationSet.add(location);
    addTo(a, r);
    addTo(line, r);
    const p = productOf(r.sales_type);
    if (p === "Machine" && r.quantity > 0 && (!a.firstMachine || r.vch_date < a.firstMachine)) a.firstMachine = r.vch_date;
    if (p === "Ink" && r.revenue > 0 && r.vch_date > a.lastInk) a.lastInk = r.vch_date;
    if (r.vch_date > a.lastSale) a.lastSale = r.vch_date;
  }
  return out;
}

/** The bucket a customer's WHOLE window puts them in — null for neither. */
export const bucketOf = (a: { machineQty: number; inkVal: number }): Bucket | null =>
  (a.machineQty > 0 ? "Orange" : a.inkVal > 0 ? "Non-Orange" : null);

/**
 * Each customer's bucket, from every pure-sale line in the window regardless of any filter.
 * Keyed by Customer Group.
 */
export function classify(rows: Row[], link: GroupLink): Map<string, { bucket: Bucket; noInk: boolean }> {
  const out = new Map<string, { bucket: Bucket; noInk: boolean }>();
  for (const [g, a] of aggregate(rows.filter(isPureSale), link)) {
    const b = bucketOf(a);
    if (b) out.set(g, { bucket: b, noInk: b === "Orange" && a.inkVal <= 0 });
  }
  return out;
}

/**
 * The figures for the lines a reader's filters leave, each customer carrying the bucket its
 * WHOLE window gave it. Customers in neither bucket are dropped.
 */
export function customerFigures(rows: Row[], link: GroupLink, buckets: Map<string, { bucket: Bucket; noInk: boolean }>): CustomerFigures[] {
  const out: CustomerFigures[] = [];
  for (const [g, a] of aggregate(rows, link)) {
    const c = buckets.get(g);
    if (!c) continue;
    const { ledgerMap, companySet, locationSet, ...rest } = a;
    out.push({
      ...rest, bucket: c.bucket, noInk: c.noInk,
      ledgers: [...ledgerMap.values()].sort((x, y) => y.total - x.total),
      companies: [...companySet].sort(), locations: [...locationSet].sort(),
    });
  }
  return out.sort((x, y) => y.total - x.total);
}
