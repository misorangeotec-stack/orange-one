/**
 * Ledger Vouchers — Tally's "Ledger Vouchers" drill screen, two screens: a searchable/filterable
 * ledger list (shared with Ledger Outstandings), then one ledger's full voucher statement — every
 * voucher hitting it in date order with a running balance, exactly as Tally lays it out.
 *
 * Data comes from the ConnectWave RPC `ledger_txn_by_id` (already anon-granted and used by the Live
 * transaction feed). It returns one row per ledger line — date, contra "Particulars", voucher type /
 * number, and a SIGNED amount where POSITIVE = Dr, matching v_ledger_detail.opening/closing — with
 * cancelled/optional and non-accounting voucher types already excluded, just like Tally's own ledger
 * display. So the opening balance + the running sum of these amounts reconciles to the closing.
 *
 * A company can be FY-split into sibling books that share a ledger GUID and overlap by ~3 months, so
 * we read EVERY book (from v_company) and dedupe vouchers by guid — the same approach the Live txn
 * feed uses. Always the `*_by_id` RPC (per-ledger, ~0.8s): the anon role has a 3s statement_timeout
 * and a raw view scan blows past it.
 */
import { getConnectwaveSupabase } from "./connectwaveSupabase";
import { formatDateDMY } from "./utils";

/** One voucher line hitting the viewed ledger. `amount` is Dr-positive (Cr is negative). */
export interface LedgerVoucherRow {
  guid: string;
  date: string | null;       // yyyymmdd
  voucherType: string | null;
  voucherNo: string | null;
  particulars: string | null; // the contra ledger(s); falls back to the party name
  narration: string | null;
  amount: number;             // signed, POSITIVE = Dr
}

/** Raw shape of a `ledger_txn_by_id` row (see connector/supabase/ledger_txn_fast.sql). */
interface RawTxn {
  guid: string | null;
  vch_date: string | null;
  voucher_type: string | null;
  voucher_no: string | null;
  party: string | null;
  narration: string | null;
  amount: number | string | null;
  dr_cr: string | null;
  particulars: string | null;
}

/**
 * Every book (tenant) belonging to the same company as the given tenant. FY-split siblings share the
 * bare company guid and differ only by a `~<fy>` suffix; v_company lists them all. Falls back to just
 * the given tenant if v_company can't be read (degrades to the single book rather than throwing).
 */
async function booksForCompany(tenantId: string): Promise<string[]> {
  const cw = getConnectwaveSupabase();
  const bare = tenantId.split("~")[0];
  const { data, error } = await cw.from("v_company").select("tenant_id");
  if (error || !data?.length) {
    if (error) console.warn("[ledgerVouchers] v_company read failed — using the single book only.", error);
    return [tenantId];
  }
  const books = (data as { tenant_id: string }[])
    .map((r) => r.tenant_id)
    .filter((t) => t.split("~")[0] === bare);
  return books.length ? books : [tenantId];
}

/**
 * One ledger's full voucher history, date-ordered, deduped across the company's books. The running
 * balance and the opening/closing framing are computed by the page (they depend on the period filter).
 */
export async function loadLedgerVouchers(
  tenantId: string,
  ledgerGuid: string,
): Promise<LedgerVoucherRow[]> {
  const cw = getConnectwaveSupabase();
  const books = await booksForCompany(tenantId);

  const perBook = await Promise.all(
    books.map(async (tenant) => {
      const { data, error } = await cw.rpc("ledger_txn_by_id", {
        p_tenant: tenant,
        p_ledger_guid: ledgerGuid,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as RawTxn[];
    }),
  );

  // FY-split books overlap ~3 months, so the same voucher really appears in two books — dedupe by
  // voucher guid, first book wins. Rows with no guid are kept (they cannot collide).
  const byGuid = new Map<string, LedgerVoucherRow>();
  const noGuid: LedgerVoucherRow[] = [];
  for (const rows of perBook) {
    for (const t of rows) {
      const row: LedgerVoucherRow = {
        guid: t.guid ?? "",
        date: t.vch_date,
        voucherType: t.voucher_type,
        voucherNo: t.voucher_no,
        particulars: t.particulars || t.party || null,
        narration: t.narration,
        amount: Number(t.amount) || 0,
      };
      if (!t.guid) { noGuid.push(row); continue; }
      if (!byGuid.has(t.guid)) byGuid.set(t.guid, row);
    }
  }

  const all = [...byGuid.values(), ...noGuid];
  // yyyymmdd sorts lexicographically; guid tie-breaks so paging is stable.
  all.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || a.guid.localeCompare(b.guid));
  return all;
}

// ── Statement framing (shared by the single-ledger screen and the multi-ledger export) ──────
// The running balance / opening-as-of / totals are NOT in the RPC — they depend on the period
// filter, so they're computed here. Keeping this in ONE place is what stops the on-screen
// statement and the exported sheet from ever drifting apart.

export interface LedgerStatement {
  /** Opening carried INTO the window = master opening + every voucher strictly BEFORE `fromYmd`. */
  openingAsOf: number;
  /** Rows inside [fromYmd, toYmd], each with the running balance folded from `openingAsOf`. */
  withBalance: { row: LedgerVoucherRow; balance: number }[];
  /** Σ Dr amounts inside the window. */
  debit: number;
  /** Σ Cr amounts (as a positive number) inside the window. */
  credit: number;
  /** The last running balance in the window (= `openingAsOf` when the window is empty). */
  closingComputed: number;
}

/**
 * Fold one ledger's vouchers into an opening-anchored statement over an optional [fromYmd, toYmd]
 * window (both `yyyymmdd`, "" = unbounded). Lifted verbatim from the statement page so the export
 * reconciles to the exact figures shown on screen.
 */
export function buildLedgerStatement(
  opening: number,
  rows: LedgerVoucherRow[],
  fromYmd: string,
  toYmd: string,
): LedgerStatement {
  let openingAsOf = opening;
  if (fromYmd) for (const r of rows) if ((r.date ?? "") < fromYmd) openingAsOf += r.amount;

  let bal = openingAsOf;
  let debit = 0;
  let credit = 0;
  const withBalance: { row: LedgerVoucherRow; balance: number }[] = [];
  for (const r of rows) {
    const d = r.date ?? "";
    if (fromYmd && d < fromYmd) continue;
    if (toYmd && d > toYmd) continue;
    bal += r.amount;
    if (r.amount > 0) debit += r.amount;
    else credit += -r.amount;
    withBalance.push({ row: r, balance: bal });
  }
  const closingComputed = withBalance.length ? withBalance[withBalance.length - 1].balance : openingAsOf;
  return { openingAsOf, withBalance, debit, credit, closingComputed };
}

/** yyyymmdd → dd-mm-yyyy (blank on bad/absent input). */
function ymdToDMY(yyyymmdd: string): string {
  if (!/^\d{8}$/.test(yyyymmdd)) return "";
  return formatDateDMY(`${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`);
}

/**
 * The period label shown/exported for a ledger. When a From/To is set it wins; otherwise it falls
 * back to THAT ledger's own company fiscal range (bulk exports span companies with different FYs, so
 * this must be resolved per-ledger, never once globally).
 */
export function periodLabelFor(
  fromYmd: string,
  toYmd: string,
  company?: { fromDate: string; asOf: string } | null,
): string {
  if (fromYmd || toYmd) return `${fromYmd ? ymdToDMY(fromYmd) : "start"} to ${toYmd ? ymdToDMY(toYmd) : "today"}`;
  if (company) return `${formatDateDMY(company.fromDate)} to ${formatDateDMY(company.asOf)}`;
  return "All history";
}
