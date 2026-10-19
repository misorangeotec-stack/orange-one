import { useQuery } from "@tanstack/react-query";
import { getConnectwave, hasConnectwave } from "@/core/platform/connectwave";
import { OTEC_SURAT_GUID } from "./stock";
import type { CountRow, TallyAlloc } from "./pv";

/**
 * STEP 4 · POST TO TALLY — the accepted differences as one Tally Stock Journal.
 *
 *   short (physical < closing) → SOURCE side (consumption, stock goes OUT)
 *   extra (physical > closing) → DESTINATION side (production, stock comes IN)
 *
 * Otec Surat ink is LOT TRACKED, so every line needs a godown and a batch. The app suggests
 * them from ConnectWave's lot balances but does not decide: those balances tie to Tally's
 * closing for only 45 of 176 ink items (checked 17-10-2026; some lots are negative). The person
 * posting confirms or changes each line before the file is made.
 *
 * The file is Tally's own XML import (Gateway of Tally → Import → Transactions). It names no
 * company, so it goes into the company that is OPEN in Tally — Otec Surat must be the one open.
 */

export interface Lot { batch: string; balance: number; godown: string }

/** Godowns seen in Otec Surat's stock lines — the suggestion list, beside the lots' own. */
export const KNOWN_GODOWNS = [
  "HOZIWALA", "HOZIWALA-2", "Godown F1", "GODOWN G1", "Godown G2", "Godown G3",
  "Godown 42A,42B,43A,43B", "Main Location", "SACHIN GODOWN",
];
export const DEFAULT_GODOWN = "HOZIWALA";
export const PRIMARY_BATCH = "Primary Batch";

/** Lots holding stock, per item. Read-only from ConnectWave. */
async function fetchLots(items: string[]): Promise<Map<string, Lot[]>> {
  const out = new Map<string, Lot[]>();
  if (!items.length || !hasConnectwave()) return out;
  const cw = getConnectwave();
  // Chunks keep the URL short (an item list can run past the 16 KB limit).
  for (let i = 0; i < items.length; i += 40) {
    const { data, error } = await cw
      .from("rpt_lot_balance")
      .select("stock_item,batch_name,balance,last_godown")
      .eq("company_guid", OTEC_SURAT_GUID)
      .in("stock_item", items.slice(i, i + 40))
      .gt("balance", 0)
      .order("stock_item").order("batch_name")
      .returns<{ stock_item: string; batch_name: string | null; balance: number; last_godown: string | null }[]>();
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      const list = out.get(r.stock_item) ?? [];
      list.push({ batch: r.batch_name ?? PRIMARY_BATCH, balance: Number(r.balance) || 0, godown: r.last_godown ?? "" });
      out.set(r.stock_item, list);
    }
  }
  for (const list of out.values()) list.sort((a, b) => b.balance - a.balance);
  return out;
}

export function useLots(items: string[]) {
  const key = [...new Set(items)].sort();
  return useQuery({
    queryKey: ["physical-verification", "lots", key],
    queryFn: () => fetchLots(key),
    enabled: key.length > 0,
    staleTime: 5 * 60_000,
  });
}

/**
 * The first suggestion for a line: the whole difference against the item's biggest lot, in
 * that lot's godown. Without a lot: the main godown and Tally's "Primary Batch".
 */
export function suggestAlloc(c: CountRow, lots: Lot[] | undefined): TallyAlloc[] {
  const qty = Math.abs(c.difference ?? 0);
  const top = lots?.[0];
  return [{ godown: top?.godown || DEFAULT_GODOWN, batch: top?.batch ?? PRIMARY_BATCH, qty }];
}

export const allocTotal = (a: TallyAlloc[]) => a.reduce((s, x) => s + (Number(x.qty) || 0), 0);

/** Ready to post: every line has a godown and a qty, and they add up to the difference. */
export function allocReady(c: CountRow, a: TallyAlloc[]): boolean {
  if (!a.length || a.some((x) => !x.godown.trim() || !(x.qty > 0))) return false;
  return Math.abs(allocTotal(a) - Math.abs(c.difference ?? 0)) < 0.0005;
}

/* ------------------------------------------------------------- the XML -- */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const n3 = (n: number) => String(Math.round(n * 1000) / 1000);
const n2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

export interface VoucherLine { count: CountRow; alloc: TallyAlloc[] }

/**
 * One Stock Journal voucher holding every line. Amounts follow Tally's sign rule: the
 * destination (IN) side is a debit — negative amount, ISDEEMEDPOSITIVE Yes; the source (OUT)
 * side is a credit — positive amount, ISDEEMEDPOSITIVE No. Rate = Tally's closing rate frozen
 * on the count.
 */
export function buildStockJournalXml(lines: VoucherLine[], opts: { date: string; voucherType: string; narration: string }): string {
  const ymd = opts.date.replace(/-/g, "");
  const entry = (l: VoucherLine, side: "IN" | "OUT") => {
    const c = l.count;
    const unit = c.unit ?? "";
    const rate = c.closingRate ?? 0;
    const qty = l.alloc.reduce((s, a) => s + a.qty, 0);
    const sign = side === "IN" ? -1 : 1;
    const q = (x: number) => ` ${n3(x)} ${esc(unit)}`;
    const batches = l.alloc.map((a) => [
      "      <BATCHALLOCATIONS.LIST>",
      `       <GODOWNNAME>${esc(a.godown.trim())}</GODOWNNAME>`,
      `       <BATCHNAME>${esc(a.batch.trim() || PRIMARY_BATCH)}</BATCHNAME>`,
      `       <AMOUNT>${n2(sign * a.qty * rate)}</AMOUNT>`,
      `       <ACTUALQTY>${q(a.qty)}</ACTUALQTY>`,
      `       <BILLEDQTY>${q(a.qty)}</BILLEDQTY>`,
      "      </BATCHALLOCATIONS.LIST>",
    ].join("\n")).join("\n");
    return [
      `     <INVENTORYENTRIES${side}.LIST>`,
      `      <STOCKITEMNAME>${esc(c.item)}</STOCKITEMNAME>`,
      `      <ISDEEMEDPOSITIVE>${side === "IN" ? "Yes" : "No"}</ISDEEMEDPOSITIVE>`,
      `      <RATE>${n2(rate)}/${esc(unit)}</RATE>`,
      `      <AMOUNT>${n2(sign * qty * rate)}</AMOUNT>`,
      `      <ACTUALQTY>${q(qty)}</ACTUALQTY>`,
      `      <BILLEDQTY>${q(qty)}</BILLEDQTY>`,
      batches,
      `     </INVENTORYENTRIES${side}.LIST>`,
    ].join("\n");
  };
  const ins = lines.filter((l) => (l.count.difference ?? 0) > 0).map((l) => entry(l, "IN"));
  const outs = lines.filter((l) => (l.count.difference ?? 0) < 0).map((l) => entry(l, "OUT"));
  const vt = esc(opts.voucherType.trim() || "Stock Journal");
  return [
    "<ENVELOPE>",
    " <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>",
    " <BODY>",
    "  <IMPORTDATA>",
    "   <REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC>",
    "   <REQUESTDATA>",
    '    <TALLYMESSAGE xmlns:UDF="TallyUDF">',
    `    <VOUCHER VCHTYPE="${vt}" ACTION="Create" OBJVIEW="Consumption Voucher View">`,
    `     <DATE>${ymd}</DATE>`,
    `     <EFFECTIVEDATE>${ymd}</EFFECTIVEDATE>`,
    `     <VOUCHERTYPENAME>${vt}</VOUCHERTYPENAME>`,
    `     <NARRATION>${esc(opts.narration)}</NARRATION>`,
    "     <PERSISTEDVIEW>Consumption Voucher View</PERSISTEDVIEW>",
    ...ins,
    ...outs,
    "    </VOUCHER>",
    "    </TALLYMESSAGE>",
    "   </REQUESTDATA>",
    "  </IMPORTDATA>",
    " </BODY>",
    "</ENVELOPE>",
    "",
  ].join("\n");
}

export function downloadText(fileName: string, text: string, type = "application/xml") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
