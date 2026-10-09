/**
 * How a lot's dates read in every Ink Expiry table — one place, so the dashboard, the consume-first
 * plan and the Expiry status page never disagree:
 *
 *   Purchase / prod. date   the lot's first real receipt (expiry.ts → StockLot.inward), with a hint
 *                           under it: Purchase / Production, "at Otec Surat" when another company
 *                           bought it, and "rec'd here 28-Sep (Material in)" when this book got it later.
 *   Sales return            the latest return of the lot from a customer, if any.
 */
import { fmtDate, type StockLot } from "../lib/expiry";

/** 'GST PURCHASE-INK' → 'Purchase', 'STOCK JOURNAL-PRODUCTION' → 'Production', … */
export function receiptKind(t: string | null): string {
  if (!t) return "";
  if (/PRODUCTION/i.test(t)) return "Production";
  if (/PURCHASE/i.test(t)) return "Purchase";
  if (/RECEIPT NOTE/i.test(t)) return "Receipt note";
  if (/MATERIAL IN/i.test(t)) return "Material in";
  if (/OPENING/i.test(t)) return "Opening";
  return t.charAt(0) + t.slice(1).toLowerCase();
}

/** One line of text for exports and filters: '04-Jun-2026 · Purchase · at Otec Surat'. */
export function purchaseText(l: StockLot): string {
  if (!l.inward) return "";
  return [fmtDate(l.inward), receiptKind(l.inwardType), l.inwardCompany ? `at ${l.inwardCompany}` : ""].filter(Boolean).join(" · ");
}

export function PurchaseDateCell({ lot }: { lot: StockLot }) {
  if (!lot.inward) return <span className="text-grey-2">—</span>;
  const hint = [receiptKind(lot.inwardType), lot.inwardCompany ? `at ${lot.inwardCompany}` : ""].filter(Boolean).join(" · ");
  return (
    <div className="leading-tight">
      <div>{fmtDate(lot.inward)}</div>
      {hint && <div className="text-[10.5px] text-grey">{hint}</div>}
      {lot.receivedHere && (
        <div className="text-[10.5px] text-grey" title="When this company received the lot">
          rec'd here {fmtDate(lot.receivedHere)}{lot.receivedHereType ? ` (${receiptKind(lot.receivedHereType)})` : ""}
        </div>
      )}
    </div>
  );
}

export function ReturnDateCell({ lot }: { lot: StockLot }) {
  return lot.returnDate
    ? <span className="font-medium text-[#8a5d00]" title="Latest sales return of this lot from a customer">{fmtDate(lot.returnDate)}</span>
    : <span className="text-grey-2">—</span>;
}
