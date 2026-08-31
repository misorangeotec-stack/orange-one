import Card from "@/shared/components/ui/Card";
import { Field, SECTION_HEADING_CLASS } from "@/shared/components/ui/Readout";
import { money } from "../lib/format";
import { CATEGORY_LABEL, TIER_LABEL } from "../lib/format";
import type { Entitlement, ResolvedRate } from "../lib/entitlement";
import { airRuleSentence } from "../lib/entitlement";
import type { CityTier, TravelRateCard } from "../types";

/**
 * What the policy allows this traveller, shown BESIDE the form they are filling
 * in — not after the money has been spent.
 *
 * ⚠ THIS IS THE POINT OF THE WHOLE MODULE, AND THE REASON IT IS A PANEL RATHER
 *   THAN A REPORT. The Domestic Travel Policy is a 30-page document nobody reads
 *   before booking a hotel; every cap in it is currently discovered at claim
 *   time, when the money is already gone and the only remaining move is to
 *   disallow it. Putting the figures on the request screen turns a policy
 *   somebody is punished by into a policy they can follow.
 *
 * ⚠ IT SHOWS FIGURES; IT DECIDES NOTHING. Nothing here caps, blocks or
 *   disallows. The caps are applied in SQL and only in SQL (phase 7), because a
 *   cap enforced in two languages is a cap with two authors, and on somebody's
 *   reimbursement the two will eventually disagree.
 */

/** A missing row and a deliberate no-cap must not read the same. */
function rateText(r: ResolvedRate | null, kind: "money" | "text"): string {
  if (!r) return "Not set on this card";
  if (kind === "text") return r.textValue ?? "—";
  return r.amount === null ? "No cap — actuals with a receipt" : money(r.amount);
}

function Row({
  label,
  rate,
  kind = "money",
  hint,
  pending,
}: {
  label: string;
  rate: ResolvedRate | null;
  kind?: "money" | "text";
  hint?: string;
  /**
   * The figure exists but cannot be looked up yet, because the axis it varies on
   * has not been chosen.
   *
   * ⚠ THREE STATES, NOT TWO, AND CONFLATING ANY PAIR OF THEM MISLEADS. "Not set
   *   on this card" is a gap somebody has to go and fill in; "No cap" is a
   *   decision the policy took; and this one is simply "you have not told me the
   *   destination". Showing the first for the third had the hotel cap reading as
   *   missing from a card that in fact carries all twelve of them.
   */
  pending?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line py-1.5 last:border-b-0">
      <div className="min-w-0">
        <div className="text-[12.5px] font-medium text-navy">{label}</div>
        {hint && <div className="text-[11.5px] text-grey-2">{hint}</div>}
      </div>
      <div className="shrink-0 text-right">
        <div className={`text-[13px] ${pending ? "font-normal text-grey-2" : rate ? "font-semibold text-navy" : "font-semibold text-grey-2"}`}>
          {pending ?? rateText(rate, kind)}
        </div>
        {rate?.disputed && (
          <div className="text-[11px] font-semibold text-ryg-red">figure disputed</div>
        )}
      </div>
    </div>
  );
}

export default function EntitlementPanel({
  entitlement: e,
  card,
  tier,
  bandNo,
  cityName,
}: {
  entitlement: Entitlement;
  /** The card these figures came off. A draft advises; a confirmed one enforces. */
  card: TravelRateCard | undefined;
  tier: CityTier | null;
  bandNo: number | null;
  cityName: string | null;
}) {
  if (bandNo === null || bandNo === undefined) {
    return (
      <Card className="p-4">
        <h2 className={SECTION_HEADING_CLASS}>Your entitlement</h2>
        <p className="mt-2 text-[12.5px] text-grey">
          Choose who is travelling. Every figure in the policy — the class of travel, the hotel cap,
          the daily allowance — is decided by that person's band, so nothing can be shown until the
          traveller is named.
        </p>
      </Card>
    );
  }

  if (!card) {
    return (
      <Card className="p-4">
        <h2 className={SECTION_HEADING_CLASS}>Your entitlement</h2>
        <p className="mt-2 text-[12.5px] text-ryg-red">
          There is no rate card in force, so nothing can be priced. An administrator needs to set one
          up under Rate Cards before a trip can be submitted.
        </p>
      </Card>
    );
  }

  if (!e.category) {
    return (
      <Card className="p-4">
        <h2 className={SECTION_HEADING_CLASS}>Your entitlement</h2>
        <p className="mt-2 text-[12.5px] text-ryg-red">
          The rate card “{card.label}” does not say which travel category band {bandNo} falls into,
          so this trip cannot be priced. Submitting it will be refused until that row is filled in.
        </p>
      </Card>
    );
  }

  const airRule = airRuleSentence(e);

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={SECTION_HEADING_CLASS}>Your entitlement</h2>
        <span className="text-[11.5px] text-grey-2">
          Band {bandNo} · {card.label}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="rounded-pill bg-orange-soft px-2.5 py-0.5 text-[12px] font-semibold text-orange">
          {CATEGORY_LABEL[e.category]}
        </span>
        {tier ? (
          <span className="rounded-pill bg-page px-2.5 py-0.5 text-[12px] font-semibold text-navy">
            {cityName ? `${cityName} · ` : ""}
            {TIER_LABEL[tier]}
          </span>
        ) : (
          <span className="text-[11.5px] text-grey-2">
            Choose a destination for the hotel and conveyance caps
          </span>
        )}
      </div>

      {/*
        ⚠ AN UNCONFIRMED CARD ADVISES; IT DOES NOT ENFORCE. Saying so here is not
          a disclaimer — it is the difference between a traveller treating ₹1,750
          as a rule and treating it as a proposal that has not been signed off.
          `fms_travel_confirm_rate_card` is what flips that, and it refuses while
          any figure is still disputed.
      */}
      {card.status !== "confirmed" && (
        <p className="mt-2 rounded-lg bg-page px-3 py-2 text-[12px] text-grey">
          These figures are from a <strong>draft</strong> rate card. They are what the policy
          proposes and what your claim will be measured against for guidance, but they are not yet
          signed off, so nothing is refused on their basis.
        </p>
      )}

      {/*
        ⚠ THE §2 CONTRADICTION, SAID OUT LOUD RATHER THAN AVERAGED AWAY. Section
          2 of the policy holds two tables that disagree one row apart, and 23 of
          59 live employees sit in the two bands they disagree about. Showing a
          figure without this line would quote somebody a hotel cap that is wrong
          by ₹1,500 a night and let them plan around it.
      */}
      {e.anyDisputed && (
        <p className="mt-2 rounded-lg bg-[#FDECEC] px-3 py-2 text-[12px] text-ryg-red">
          <strong>At least one figure below is disputed.</strong> The source policy gives two
          different answers for it, and HR has not yet said which one applies. Book to the lower
          reading and flag it — the rate card cannot be signed off until this is settled.
        </p>
      )}

      <div className="mt-3 space-y-3">
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-grey">
            Money
          </div>
          <Row
            label="Hotel, per night"
            rate={e.hotelCap}
            pending={tier ? undefined : "Choose a destination"}
            hint={
              tier
                ? "including GST (§7.2). Over-cap needs evidence plus HOD approval, and never above 1.5×."
                : "the cap varies by the destination's tier"
            }
          />
          <Row label="Daily allowance" rate={e.da} hint="per calendar day away, no receipts (§8)" />
          <Row
            label="Local conveyance"
            rate={e.conveyanceCap}
            /* TC-A is uncapped on every tier, so it is answerable without one. */
            pending={tier || e.conveyanceCap?.amount === null ? undefined : "Choose a destination"}
            hint="per day at the destination (§10), separate from the daily allowance"
          />
          {e.conveyanceSelfDec && (
            <Row
              label="Conveyance without a receipt"
              rate={e.conveyanceSelfDec}
              hint="per trip, self-declared (§10)"
            />
          )}
          <Row label="Full-day vehicle hire" rate={e.rentalCap} hint="including driver (§10.1), HOD pre-approved" />
        </div>

        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-grey">
            How you may travel
          </div>
          <Row label="Air" rate={e.air.travelClass} kind="text" hint={e.air.bookingType?.textValue ?? undefined} />
          {e.air.upgrade?.textValue && (
            <Row label="Air — upgrades" rate={e.air.upgrade} kind="text" />
          )}
          <Row label="Train" rate={e.train.travelClass} kind="text" hint={e.train.overnight?.textValue ? `Overnight: ${e.train.overnight.textValue}` : undefined} />
          <Row label="Road" rate={e.road.mode} kind="text" />
          {(e.mileage.fourWheeler || e.mileage.twoWheeler) && (
            <Row
              label="Own vehicle, per km"
              rate={e.mileage.fourWheeler ?? e.mileage.twoWheeler}
              hint={
                e.mileage.twoWheeler?.amount
                  ? `Two-wheeler ${money(e.mileage.twoWheeler.amount)}/km. HOD approval before travel (§6.3).`
                  : "HOD approval before travel (§6.3)"
              }
            />
          )}
        </div>

        {/*
          ⚠ STATED, NOT APPLIED. The distance between two cities is not a fact
            this portal holds, so the module cannot decide whether a flight is
            permitted and must not pretend to. What it can do is tell a traveller
            the test they will be measured against, at the moment they are asking
            — which is the whole difference between a rule and an ambush.
        */}
        {airRule && (
          <div className="rounded-lg bg-page px-3 py-2">
            <Field label="When you may fly" value={airRule} emphasis="quiet" />
            {e.air.advanceBookingDays?.amount && (
              <p className="mt-1 text-[11.5px] text-grey">
                Tickets are booked at least {e.air.advanceBookingDays.amount} days ahead; later than
                that needs approval with a reason in writing.
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
