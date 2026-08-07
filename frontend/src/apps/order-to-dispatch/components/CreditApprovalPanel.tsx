import { TextInput } from "@/shared/components/ui/Form";
import { pendingTotalOf } from "../lib/rounds";
import { sharedUnit } from "../lib/format";
import type { DispatchOrder } from "../types";

/**
 * How much of an order credit is releasing — the control that makes a partial
 * approval expressible.
 *
 * TWO BOXES, ONE FACT. The quantity is what is stored and what caps the stock
 * check; the percentage is a second way to say the same thing, because
 * collections think in "release half" as often as in "release 35 kg". Typing in
 * either fills the other, and neither is the master: whichever was typed last is
 * what the person meant.
 *
 * ⚠ THE REFERENCE IS WHAT IS STILL PENDING, NOT WHAT WAS ORDERED. On round 2 of
 *   a 70 kg order with 35 already delivered, "half" means half of the remaining
 *   35. Anchoring on 70 would let credit re-release quantity it has already
 *   released, and the ceiling would quietly stop meaning anything.
 *
 * ⚠ THE TOTAL PRINTS A UNIT ONLY WHEN EVERY LINE SHARES ONE. 500 KGS plus 3 PCS
 *   is a number with no unit; labelling it with either would be a lie. Same rule
 *   as ShipLinesGrid's totals row.
 */

/** Round to the 3 decimals the numeric(14,3) columns actually store. */
const q3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Blank, or a finite number — anything else is "not a figure yet", not zero. */
const parse = (v: string): number | null => {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/**
 * What is wrong with this figure, or null. Exported because the modal blocks its
 * own Save on it — the person should never learn from a round-trip to Postgres
 * that 70 of 70 is not a partial approval.
 */
export function approvedQtyError(order: DispatchOrder, value: string): string | null {
  const pending = pendingTotalOf(order);
  const qty = parse(value);
  if (qty === null) return "Enter how much of this order is approved.";
  if (qty <= 0) return "The approved quantity must be more than zero.";
  if (qty >= pending) {
    return `That is the whole balance of ${q3(pending)} — record it as Approved instead.`;
  }
  return null;
}

export default function CreditApprovalPanel({
  order, value, onChange, readOnly = false,
}: {
  order: DispatchOrder;
  value: string;
  onChange: (next: string) => void;
  readOnly?: boolean;
}) {
  const pending = pendingTotalOf(order);
  const unit = sharedUnit(order.lines);
  const qty = parse(value);
  const error = approvedQtyError(order, value);

  // Derived, never stored: a percentage of a quantity that can change under it
  // (an amended round moves `pending`) would go stale the moment it did.
  const pct = qty !== null && pending > 0 ? q3((qty / pending) * 100) : null;

  const setPct = (raw: string) => {
    const p = parse(raw);
    if (p === null) return onChange("");
    onChange(String(q3((pending * p) / 100)));
  };

  return (
    <section className="rounded-lg border border-line bg-page p-3 space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block text-[11.5px] font-semibold uppercase tracking-wide text-grey-2">
            Approve
          </span>
          <span className="flex items-center gap-1.5">
            <TextInput
              value={pct === null ? "" : String(pct)}
              onChange={(e) => setPct(e.target.value)}
              disabled={readOnly}
              inputMode="decimal"
              placeholder="0"
              className="w-20 text-right tabular-nums"
              aria-label="Percentage of the pending quantity to approve"
            />
            <span className="text-[13px] text-grey">%</span>
          </span>
        </label>

        <label className="space-y-1">
          <span className="block text-[11.5px] font-semibold uppercase tracking-wide text-grey-2">
            Quantity
          </span>
          <span className="flex items-center gap-1.5">
            <TextInput
              value={value}
              onChange={(e) => onChange(e.target.value)}
              disabled={readOnly}
              inputMode="decimal"
              placeholder="0"
              className="w-28 text-right tabular-nums"
              aria-label="Quantity to approve"
            />
            {unit && <span className="text-[13px] text-grey">{unit}</span>}
          </span>
        </label>

        <p className="pb-2 text-[12.5px] text-grey-2">
          of <span className="font-semibold text-navy tabular-nums">{q3(pending)}</span>
          {unit ? ` ${unit}` : ""} pending
        </p>
      </div>

      <p className={`text-[12.5px] ${error ? "text-ryg-red" : "text-grey-2"}`}>
        {error ?? "The stock check will not be able to send more than this."}
      </p>
    </section>
  );
}
