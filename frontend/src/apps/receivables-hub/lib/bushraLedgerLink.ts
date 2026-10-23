/**
 * A SALES LINE → A HUB MASTER, for the Bushra dashboards.
 *
 * The hub's own customer masters — Customer Group (ext_ledger_group) and the salesperson tag
 * (ext_ledger_tags) — are keyed by the Tally ledger GUID. A Sales Register line carries only its book
 * (tenant) and the ledger NAME. v_ledger_detail joins the two. Names are not unique across books
 * (387 repeat), so the book is part of the key.
 *
 * A ledger the GUID route misses falls back to its name in the master, but only when that name means
 * ONE value everywhere — never a guess between two.
 *
 * Kept free of React and the browser, like lib/bushraSalesFigures.ts.
 */
import { getConnectwaveSupabase } from "./connectwaveSupabase";

export interface DebtorLedger { tenant_id: string; guid: string; ledger: string }

/** Every customer ledger in every book (Sundry Debtors and below), paged. */
export async function loadDebtorLedgers(): Promise<DebtorLedger[]> {
  const cw = getConnectwaveSupabase();
  const out: DebtorLedger[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await cw.from("v_ledger_detail")
      .select("tenant_id,guid,ledger")
      .contains("group_chain", ["Sundry Debtors"])
      .order("tenant_id", { ascending: true })
      .order("guid", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Customer ledgers: ${error.message}`);
    const page = (data ?? []) as DebtorLedger[];
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

const linkKey = (tenantId: string, ledger: string) => `${tenantId}|${ledger.trim().toUpperCase()}`;

/**
 * (tenant, ledger name) → the master's value for that ledger, or null when it has none.
 * `rows` is the master: one value per ledger GUID, with the ledger's Tally name beside it.
 */
export function makeLedgerLink(
  ledgers: DebtorLedger[],
  rows: { ledger_id: string | null; tally_name: string | null; value: string | null | undefined }[],
): (tenantId: string, ledger: string) => string | null {
  const byGuid = new Map<string, string>();
  const byName = new Map<string, Set<string>>();
  for (const r of rows) {
    const v = r.value?.trim();
    if (!v) continue;
    if (r.ledger_id) byGuid.set(r.ledger_id, v);
    if (r.tally_name) {
      const k = r.tally_name.trim().toUpperCase();
      (byName.get(k) ?? byName.set(k, new Set()).get(k)!).add(v);
    }
  }
  const byLedger = new Map<string, string>();
  for (const l of ledgers) {
    const v = byGuid.get(l.guid);
    if (v) byLedger.set(linkKey(l.tenant_id, l.ledger), v);
  }
  return (tenantId, ledger) => {
    const hit = byLedger.get(linkKey(tenantId, ledger));
    if (hit) return hit;
    const named = byName.get(ledger.trim().toUpperCase());
    return named?.size === 1 ? [...named][0] : null;
  };
}
