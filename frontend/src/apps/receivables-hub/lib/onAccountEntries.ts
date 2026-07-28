/**
 * ON-ACCOUNT ENTRIES — the vouchers behind a customer's untagged credit.
 *
 * The Salesperson Collection Report already knows the on-account TOTAL exactly, with no fetch:
 * `onAccountOfLedger` = Σ(bill pending) − ledger balance (see lib/agingReport). What it cannot
 * know from the browser is WHICH receipt is sitting unapplied — that needs the voucher lines,
 * which only exist in the ConnectWave mirror. This module fetches them, lazily, for the
 * drill-down only.
 *
 * ⚠ COVERAGE IS PARTIAL BY NATURE. Measured book-wide 28-Jul-2026: 169 ledgers hold on-account
 * (₹13.93 Cr), but only 44 (₹3.83 Cr) have voucher lines behind them. For the other 96 the money
 * is an opening balance keyed without a bill breakup, so Tally holds nothing to return. Callers
 * must render the shortfall as its own line — never present a partial list as the whole story.
 *
 * ⚠ BATCH AT 30. Measured on the O TEC book against the anon 3 s statement timeout:
 * 1 ledger 169 ms · 30 ledgers 578 ms · whole tenant 5.8 s (fails). See the SQL header.
 */
import { getConnectwaveSupabase } from "./connectwaveSupabase";
import { tenantOfLedger } from "./ledgerOutstanding";

export interface OnAccountEntry {
  ledgerId: string;
  /** ISO yyyy-mm-dd; "" when Tally carried no date. */
  date: string;
  /** Often EMPTY in practice — receipt voucher types are commonly numbered "None" in this book,
   *  so the narration (the NEFT/RTGS reference) is the useful identifier. */
  voucherNo: string | null;
  voucherType: string;
  narration: string | null;
  /** Tally's raw sign on the party ledger: POSITIVE = credit = money received. */
  amount: number;
}

interface RawEntry {
  ledger_id: string;
  vch_date: string | null;
  voucher_no: string | null;
  voucher_type: string | null;
  narration: string | null;
  amount: number | string | null;
}

const BATCH = 30;
/** Parallel RPC calls in flight. Keeps a Grand-Total drill from opening dozens of anon
 *  connections at once while still finishing a few hundred ledgers quickly. */
const CONCURRENCY = 4;

/** "20260327" → "2026-03-27"; anything else passes through as "". */
function isoOf(yyyymmdd: string | null): string {
  if (!yyyymmdd || !/^\d{8}$/.test(yyyymmdd)) return "";
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Run `tasks` with at most CONCURRENCY in flight. */
async function pooled<T>(tasks: (() => Promise<T>)[]): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= tasks.length) return;
      out[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, worker));
  return out;
}

/**
 * Entries for the given ledgers, keyed by ledger guid. Ledgers with no entry simply do not
 * appear in the map — that is the normal case for opening-balance on-account, not an error.
 *
 * Fail-soft: a batch that errors contributes nothing rather than rejecting the whole call, so a
 * slow or failing lookup degrades the on-account section to its summary line and never takes the
 * invoice list down with it.
 */
export async function loadOnAccountEntries(
  ledgerGuids: string[],
): Promise<Map<string, OnAccountEntry[]>> {
  const byLedger = new Map<string, OnAccountEntry[]>();
  if (!ledgerGuids.length) return byLedger;

  // One RPC call is scoped to a single tenant, so split by company first.
  const byTenant = new Map<string, string[]>();
  for (const guid of new Set(ledgerGuids)) {
    const tenant = tenantOfLedger(guid);
    const list = byTenant.get(tenant);
    if (list) list.push(guid);
    else byTenant.set(tenant, [guid]);
  }

  const cw = getConnectwaveSupabase();
  const tasks: (() => Promise<RawEntry[]>)[] = [];
  for (const [tenant, guids] of byTenant) {
    for (const batch of chunk(guids, BATCH)) {
      tasks.push(async () => {
        const { data, error } = await cw.rpc("on_account_entries_by_id", {
          p_tenant: tenant,
          p_ledger_guids: batch,
        });
        if (error) {
          console.warn("[onAccountEntries] batch failed; falling back to summary line:", error.message);
          return [];
        }
        return (data ?? []) as RawEntry[];
      });
    }
  }

  for (const rows of await pooled(tasks)) {
    for (const r of rows) {
      const entry: OnAccountEntry = {
        ledgerId: r.ledger_id,
        date: isoOf(r.vch_date),
        voucherNo: r.voucher_no?.trim() || null,
        voucherType: r.voucher_type ?? "",
        narration: r.narration?.trim() || null,
        amount: Number(r.amount) || 0,
      };
      const list = byLedger.get(entry.ledgerId);
      if (list) list.push(entry);
      else byLedger.set(entry.ledgerId, [entry]);
    }
  }
  return byLedger;
}

/**
 * The entries that may be SHOWN as the explanation for a ledger's on-account balance.
 *
 * Two guards, both deliberate:
 *  • Only credits (amount > 0) — a debit line carrying no bill allocation is not money received
 *    and must never be presented as such.
 *  • If the credits OVERSHOOT the authoritative total, return nothing. The total is exact
 *    (bills − ledger); the entry list is a reconstruction, so when they disagree in that
 *    direction the reconstruction is what is wrong. Showing a single honest summary line beats
 *    naming vouchers that do not add up — the failure mode this guards is a non-accounting
 *    voucher type slipping past the SQL blacklist.
 *
 * Anything the returned entries do NOT explain is the caller's balancing line.
 */
export function displayableEntries(
  entries: OnAccountEntry[] | undefined,
  onAccountTotal: number,
): { shown: OnAccountEntry[]; unexplained: number } {
  const credits = (entries ?? []).filter((e) => e.amount > 0);
  const sum = credits.reduce((s, e) => s + e.amount, 0);
  if (!credits.length || sum > onAccountTotal + 1) {
    return { shown: [], unexplained: onAccountTotal };
  }
  return { shown: credits, unexplained: onAccountTotal - sum };
}

/** Human label for one entry — voucher number when Tally numbered it, else the narration
 *  (which is where the NEFT/RTGS reference actually lives in this book). */
export function entryLabel(e: OnAccountEntry): string {
  const ref = e.voucherNo || e.narration;
  return ref ? `${e.voucherType} · ${ref}` : e.voucherType;
}
