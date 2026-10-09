/**
 * Salesperson Sales — which salesperson a Sales Register line belongs to.
 *
 * Tally carries no salesperson. The hub keeps one per customer ledger in `ext_ledger_tags` (the tag
 * that also scopes receivables), keyed by the ledger GUID; lib/bushraLedgerLink.ts joins it to a
 * line's book + ledger name. A ledger with no tag (or a blank / "-" one) has no salesperson — the
 * screen shows it as NOT_ASSIGNED rather than dropping its sales.
 */
import { fetchAll } from "./musterApi";
import { isUnset } from "./nameMasters";
import { loadDebtorLedgers, makeLedgerLink } from "./bushraLedgerLink";

export const NOT_ASSIGNED = "(Not assigned)";

export async function loadSalespersonLink(): Promise<(tenantId: string, ledger: string) => string | null> {
  const [ledgers, tags] = await Promise.all([
    loadDebtorLedgers(),
    fetchAll<{ ledger_id: string; tally_name: string | null; salesperson: string | null }>(
      "ext_ledger_tags", "ledger_id,tally_name,salesperson", "ledger_id"),
  ]);
  return makeLedgerLink(ledgers, tags.map((t) => ({ ...t, value: isUnset(t.salesperson) ? null : t.salesperson })));
}
