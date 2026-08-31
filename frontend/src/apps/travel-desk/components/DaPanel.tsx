import Card from "@/shared/components/ui/Card";
import { formatDateDMY } from "@/shared/lib/date";
import { money } from "../lib/format";
import type { DaDay, ClaimPreview } from "../types";

/**
 * The daily allowance, day by day, with the reason each day was priced as it was.
 *
 * ⚠ EVERY DAY SHOWS ITS OWN SENTENCE, and that is the whole design. A day paying
 *   250 instead of 1,000 is the single most-queried figure on a travel claim,
 *   and the only alternative to printing the reason on the row is a traveller
 *   asking Finance, and Finance re-deriving the engine to answer.
 *
 * ⚠ READ-ONLY TO THE TRAVELLER. §8 is an entitlement computed from dates, times,
 *   the city's tier and the trip's length — not a figure anybody types. What the
 *   traveller CAN change is the input: the actual times, whether the customer
 *   fed them, whether family joined. Those are on the claim form above this.
 *
 * ⚠ IT RENDERS EITHER THE FROZEN DAYS OR THE LIVE PREVIEW, and says which.
 *   Before submit there is nothing frozen and the figures move as the form is
 *   edited; after submit they are fixed and a later rate-card change must not
 *   move them. Showing the two identically would hide the moment that matters.
 */
export default function DaPanel({
  frozen,
  preview,
  overrideTotal,
}: {
  /** What was frozen at submit. Empty before the claim is filed. */
  frozen: DaDay[];
  /** The live computation, while the claim is still being written. */
  preview?: ClaimPreview | null;
  /** The trip's stored `daTotal`, which already honours Finance's overrides. */
  overrideTotal?: number | null;
}) {
  const isFrozen = frozen.length > 0;

  const rows = isFrozen
    ? frozen.map((d) => ({
        key: d.id,
        day: d.day,
        tier: d.cityTier,
        rate: d.daRate,
        factor: d.factor,
        reason: d.factorReason,
        amount: d.overrideAmount ?? d.amount,
        overridden: d.overrideAmount !== null,
        overrideReason: d.overrideReason,
      }))
    : (preview?.da ?? []).map((d) => ({
        key: d.day,
        day: d.day,
        tier: d.city_tier,
        rate: d.da_rate,
        factor: d.factor,
        reason: d.factor_reason,
        amount: d.amount,
        overridden: false,
        overrideReason: null as string | null,
      }));

  const total = isFrozen
    ? (overrideTotal ?? rows.reduce((s, r) => s + r.amount, 0))
    : (preview?.totals.da ?? 0);

  if (rows.length === 0) {
    return (
      <Card className="p-4">
        <div className="text-[13px] font-semibold text-navy">Daily allowance</div>
        <p className="mt-1 text-[12.5px] text-grey-2">
          Record when the travel actually happened and the allowance appears here, one row per
          calendar day with the reason for each figure.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-[13px] font-semibold text-navy">Daily allowance (§8)</div>
          <p className="mt-0.5 text-[11.5px] text-grey-2">
            {isFrozen
              ? "Frozen when the claim was filed. A later change to the rate card does not move these figures."
              : "Computed live from the dates and times above. It is fixed when the claim is filed."}
          </p>
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wide text-grey">Total</div>
          <div className="text-[17px] font-semibold text-navy">{money(total)}</div>
        </div>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[540px] text-[12.5px]">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-grey">
              <th className="py-1.5 pr-3 font-semibold">Day</th>
              <th className="py-1.5 pr-3 font-semibold">Tier</th>
              <th className="py-1.5 pr-3 text-right font-semibold">Rate</th>
              <th className="py-1.5 pr-3 text-right font-semibold">Factor</th>
              <th className="py-1.5 pr-3 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-line/60 align-top">
                <td className="py-2 pr-3 whitespace-nowrap text-navy">{formatDateDMY(r.day)}</td>
                <td className="py-2 pr-3 text-grey-2">{r.tier ? `Tier ${r.tier}` : "—"}</td>
                <td className="py-2 pr-3 text-right text-grey-2">{money(r.rate)}</td>
                <td className="py-2 pr-3 text-right text-grey-2">
                  {/* A bare 1 reads as "full", not as a multiplier nobody applied. */}
                  {Number(r.factor) === 1 ? "Full" : `×${Number(r.factor)}`}
                </td>
                <td className="py-2 pr-3 text-right font-semibold text-navy">
                  {money(r.amount)}
                  {r.overridden && (
                    <span className="ml-1 rounded bg-[#FFF7E6] px-1 text-[10px] font-semibold uppercase text-navy">
                      Finance
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* The sentences, below the grid rather than inside it — a reason runs to a
          full line and squeezing it into a column makes both unreadable. */}
      <ul className="mt-3 space-y-1.5">
        {rows
          .filter((r) => r.reason || r.overrideReason)
          .map((r) => (
            <li key={`${r.key}-why`} className="text-[11.5px] text-grey-2">
              <span className="font-semibold text-navy">{formatDateDMY(r.day)}</span> —{" "}
              {r.overrideReason ? (
                <>
                  <span className="font-semibold">Finance overrode this day:</span>{" "}
                  {r.overrideReason}
                </>
              ) : (
                r.reason
              )}
            </li>
          ))}
      </ul>
    </Card>
  );
}
