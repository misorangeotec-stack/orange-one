import { inr, fxMoney } from "../lib/format";

/**
 * A money figure shown in BOTH currencies: the INR amount (the approval /
 * accounting basis) as the headline, with the vendor-currency amount beside it.
 *
 * Import deals in a foreign currency with an INR equivalent, and both matter — the
 * FX amount is what was agreed with the vendor, the INR is what the business books
 * and routes approvals on. Every "total" across the import stages uses this so the
 * two are always shown together and read consistently.
 */
export default function MoneyCell({
  inrValue,
  fxValue,
  currency,
  align = "left",
}: {
  inrValue: number | null | undefined;
  fxValue: number | null | undefined;
  currency: string | null | undefined;
  align?: "left" | "right";
}) {
  // One line since PF-20 — "₹12,34,567 · USD 14,800" — so a PO list row is one line like every
  // other table. Both figures are still always shown, side by side instead of stacked; the
  // columns that use this are never cut.
  return (
    <span className={`whitespace-nowrap ${align === "right" ? "block text-right" : ""}`}>
      <span className="font-semibold text-navy">{inr(inrValue)}</span>
      <span className="text-[11.5px] text-grey-2"> · {fxMoney(fxValue, currency)}</span>
    </span>
  );
}
