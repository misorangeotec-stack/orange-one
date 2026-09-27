import { useState } from "react";
import Card from "@/shared/components/ui/Card";
import { SECTION_HEADING_CLASS } from "@/shared/components/ui/Readout";
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
 *
 * ⚠ SIX FIGURES BY DEFAULT, THE REST BEHIND "Policy detail". The first build put
 *   every rate on the card on screen with its section reference underneath, and
 *   a panel meant to answer "what may I spend" took eleven rows and four grey
 *   paragraphs to do it — so it read as fine print and got skipped, which is the
 *   exact failure it exists to prevent. The rest is COLLAPSED, never deleted:
 *   Rate Cards sits behind `RequireMasterOwner`, so for an ordinary traveller
 *   this panel is the only place those figures exist at all.
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
  /** Shown only while the panel is expanded — see the note on the default six. */
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
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium text-navy">{label}</div>
        {hint && <div className="text-[11.5px] text-grey-2">{hint}</div>}
      </div>
      {/*
        ⚠ NO `shrink-0` ON THE VALUE. A long entitlement — "Business class
          permitted; the upgrade is reimbursed" — kept its full width against a
          label that could not shrink past its own text, and the two printed on
          top of each other. It wraps inside its own column instead.
      */}
      <div className="min-w-0 max-w-[58%] break-words text-right">
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

const GROUP_HEADING_CLASS = "mb-1 text-[11px] font-semibold uppercase tracking-wide text-grey";

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
  const [detail, setDetail] = useState(false);

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
        <span className="text-[11.5px] text-grey-2">Band {bandNo}</span>
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
          <span className="text-[11.5px] text-grey-2">Destination sets the hotel cap</span>
        )}
      </div>

      {/*
        ⚠ AN UNCONFIRMED CARD ADVISES; IT DOES NOT ENFORCE. Saying so is not a
          disclaimer — it is the difference between a traveller treating ₹1,750
          as a rule and treating it as a proposal nobody has signed off.
          `fms_travel_confirm_rate_card` is what flips that, and it refuses while
          any figure is still disputed. One line, because the four-line tinted
          box that said it was the first thing the eye learned to skip.
      */}
      {card.status !== "confirmed" && (
        <p className="mt-2 text-[11.5px] text-grey-2">
          <strong className="font-semibold">Draft figures</strong> — guidance, not yet signed off.
        </p>
      )}

      {/*
        ⚠ THE §2 CONTRADICTION, SAID OUT LOUD RATHER THAN AVERAGED AWAY. Section
          2 of the policy holds two tables that disagree one row apart, and 23 of
          59 live employees sit in the two bands they disagree about. Showing a
          figure without this line would quote somebody a hotel cap that is wrong
          by ₹1,500 a night and let them plan around it. It keeps its tint: this
          one is about somebody booking to the wrong number.
      */}
      {e.anyDisputed && (
        <p className="mt-2 rounded-lg bg-[#FDECEC] px-3 py-2 text-[12px] text-ryg-red">
          <strong>A figure below is disputed</strong> — the policy gives two answers and HR has not
          said which applies. Book to the lower one.
        </p>
      )}

      <div className="mt-3 space-y-3">
        <div>
          <div className={GROUP_HEADING_CLASS}>Money</div>
          <Row
            label="Hotel, per night"
            rate={e.hotelCap}
            pending={tier ? undefined : "Choose a destination"}
            hint={
              detail
                ? "including GST (§7.2). Over-cap needs evidence plus HOD approval, and never above 1.5×."
                : undefined
            }
          />
          <Row
            label="Daily allowance"
            rate={e.da}
            hint={detail ? "per calendar day away, no receipts (§8)" : undefined}
          />
          <Row
            label="Local conveyance"
            rate={e.conveyanceCap}
            /* TC-A is uncapped on every tier, so it is answerable without one. */
            pending={tier || e.conveyanceCap?.amount === null ? undefined : "Choose a destination"}
            hint={detail ? "per day at the destination (§10), separate from the daily allowance" : undefined}
          />
          {detail && e.conveyanceSelfDec && (
            <Row
              label="Conveyance without a receipt"
              rate={e.conveyanceSelfDec}
              hint="per trip, self-declared (§10)"
            />
          )}
          {detail && (
            <Row
              label="Full-day vehicle hire"
              rate={e.rentalCap}
              hint="including driver (§10.1), HOD pre-approved"
            />
          )}
        </div>

        <div>
          <div className={GROUP_HEADING_CLASS}>How you may travel</div>
          <Row
            label="Air"
            rate={e.air.travelClass}
            kind="text"
            hint={detail ? e.air.bookingType?.textValue ?? undefined : undefined}
          />
          {detail && e.air.upgrade?.textValue && (
            <Row label="Air — upgrades" rate={e.air.upgrade} kind="text" />
          )}
          <Row
            label="Train"
            rate={e.train.travelClass}
            kind="text"
            hint={
              detail && e.train.overnight?.textValue
                ? `Overnight: ${e.train.overnight.textValue}`
                : undefined
            }
          />
          <Row label="Road" rate={e.road.mode} kind="text" />
          {detail && (e.mileage.fourWheeler || e.mileage.twoWheeler) && (
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
        {detail && airRule && (
          <p className="text-[11.5px] leading-5 text-grey">
            {airRule}
            {e.air.advanceBookingDays?.amount
              ? ` Tickets are booked at least ${e.air.advanceBookingDays.amount} days ahead; later than that needs approval with a reason in writing.`
              : ""}
          </p>
        )}

        {detail && <p className="text-[11.5px] text-grey-2">Rate card: {card.label}</p>}
      </div>

      <button
        type="button"
        onClick={() => setDetail((v) => !v)}
        className="mt-3 text-[11.5px] font-semibold text-orange hover:underline"
      >
        {detail ? "Hide policy detail" : "Policy detail"}
      </button>
    </Card>
  );
}
