import { useMemo } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { Field, SECTION_HEADING_CLASS } from "@/shared/components/ui/Readout";
import { formatDateDMY } from "@/shared/lib/date";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { useDirectory } from "@/core/platform/store";
import { useTravelStore } from "../../store";
import TripStepper from "../../components/TripStepper";
import StatusPill from "../../components/StatusPill";
import EntitlementPanel from "../../components/EntitlementPanel";
import ApprovalPanel, { ApprovalHistory } from "../../components/ApprovalPanel";
import AdvancePanel, { AdvanceRecoveryPanel } from "../../components/AdvancePanel";
import BookingPanel from "../../components/BookingPanel";
import ClaimPanel from "../../components/ClaimPanel";
import ClaimReviewPanel from "../../components/ClaimReviewPanel";
import FinanceReviewPanel from "../../components/FinanceReviewPanel";
import SettlementPanel from "../../components/SettlementPanel";
import TripThread from "../../components/TripThread";
import LegRows from "../../components/LegRows";
import TripActions from "../../components/TripActions";
import { money } from "../../lib/format";
import { CATEGORY_LABEL } from "../../lib/format";
import { tripDueIso } from "../../lib/queues";
import type { QueueStep } from "../../lib/queues";
import { STATUS_STEP, TIME_SLOTS } from "../../types";
import NotFound from "../system/NotFound";

/**
 * One trip, end to end.
 *
 * Phase 3 gives it the request, the lifecycle rail and the frozen entitlement.
 * The approvals, the booked legs, the claim, the daily allowance and the
 * settlement are added by the phases that own them — each as its own card on
 * this same page, so a reader never has to go looking for the other half of a
 * trip.
 *
 * ⚠ THE ENTITLEMENT HERE IS READ OFF THE TRIP'S **FROZEN** CARD
 *   (`snapRateCardId`), never off today's. A trip submitted in March is priced
 *   by March's card even after January's revision supersedes it, and showing
 *   anything else would quietly restate history — the exact failure the whole
 *   snapshot exists to prevent.
 */
export default function TripDetail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const s = useTravelStore();
  const personById = useOrgPersonById();
  const { profiles, bandById, departmentById, designationById } = useDirectory();

  const trip = s.tripById(id ?? null);
  const passengers = useMemo(() => (trip ? s.passengersOf(trip.id) : []), [trip, s]);

  // Deep-linked confirmation from the form: it names the number that was minted,
  // which is what somebody quotes when they chase it.
  const justSubmitted = params.get("submitted");

  if (!trip) return <NotFound />;

  const city = s.cityById(trip.destinationCityId);

  /*
    ⚠ A DRAFT HAS NO SNAPSHOT YET, SO IT PRICES OFF TODAY. `snapBandNo` and
      `snapRateCardId` are written at submit and are null before it, so reading
      them on a draft showed "choose who is travelling" on a screen that plainly
      names the traveller - the one place the entitlement is least use.

      A draft therefore falls back to the traveller's CURRENT band and the card in
      force today, which is exactly what submit would freeze if it happened now.
      A submitted trip never does this: it reads its own frozen card even after a
      later revision supersedes it, because a rule change may not rewrite history.
  */
  const isDraft = trip.status === "draft";
  const liveBandNo = bandById(profiles.find((p) => p.id === trip.travellerId)?.bandId ?? null)?.bandNo ?? null;
  const entBandNo = isDraft ? liveBandNo : trip.snapBandNo;
  const entCardId = isDraft ? (s.effectiveCard?.id ?? null) : trip.snapRateCardId;

  const card = s.rateCards.find((c) => c.id === entCardId);
  const ent = s.entitlementOn(entCardId, entBandNo, city?.tier ?? null);
  const purpose = s.purposes.find((p) => p.id === trip.purposeId);
  const step = STATUS_STEP[trip.status] as QueueStep | undefined;
  const dueIso = step ? tripDueIso(trip, step, s.stepSla) : null;

  const approverNames = trip.approverManagerIds
    .map((x) => personById(x)?.name)
    .filter(Boolean) as string[];

  /*
    ⚠ A RETURNED TRIP IS EDITABLE, AND WITHOUT THIS "send back for clarification"
      IS A DEAD END. The approver asks for a cheaper hotel, `fms_travel_save_draft`
      accepts the edit — and the author has no button anywhere that opens the
      form. They would have to cancel a numbered, part-approved trip and start
      again, which is exactly the outcome returning it was meant to avoid.
  */
  const editable =
    (trip.status === "draft" || trip.status === "returned") &&
    (trip.raisedBy === s.userId || s.isProcessCoordinator) &&
    s.canEdit;

  return (
    <div className="space-y-4">
      {justSubmitted && (
        <div className="rounded-xl bg-[#E9F7EF] px-4 py-3">
          <div className="text-[13.5px] font-semibold text-ryg-green">
            {justSubmitted} has gone for approval.
          </div>
          <div className="text-[12.5px] text-grey">
            {approverNames.length
              ? `It is with ${approverNames.join(" and ")}.`
              : "No reporting manager is on record, so it has gone to the people named on the Manager Approval step."}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[19px] font-bold text-navy">
              {trip.tripNo ?? "Draft trip request"}
            </h1>
            <StatusPill status={trip.status} />
          </div>
          <p className="text-[13px] text-grey">
            {trip.travellerName}
            {trip.travellerEmployeeCode ? ` · ${trip.travellerEmployeeCode}` : ""}
            {city ? ` · ${city.name}` : ""}
            {trip.plannedDepartureDate ? ` · ${formatDateDMY(trip.plannedDepartureDate)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {editable && (
            <Link to={`/travel-desk/drafts/${trip.id}`}>
              <Button variant={trip.status === "returned" ? "primary" : "outline"}>
                {trip.status === "returned" ? "Edit and resubmit" : "Edit this draft"}
              </Button>
            </Link>
          )}
          <TripActions trip={trip} />
        </div>
      </div>

      {/*
        §3.5's consequence, stated on the trip rather than left in an activity
        row. The downgrade happened at submit; anyone reading the caps later
        would otherwise take TC-D for this person's ordinary entitlement.
      */}
      {trip.tcDowngradedFrom && (
        <div className="rounded-xl bg-[#FFF7E6] px-4 py-3 text-[12.5px] text-navy">
          <strong>Reimbursed at TC-D under §3.5.</strong> This trip was put on record more than{" "}
          {s.config.policy.emergencyWindowHours} hours after departure, so it was reduced from{" "}
          {trip.tcDowngradedFrom}. Every figure below is the reduced one.
        </div>
      )}

      {trip.status === "on_hold" && trip.holdReason && (
        <div className="rounded-xl bg-page px-4 py-3 text-[12.5px] text-grey">
          <strong className="text-navy">On hold</strong> — {trip.holdReason}. It owes nobody an
          action until it is taken off hold, and it will go back to exactly where it stopped.
        </div>
      )}

      {trip.status === "returned" && trip.returnedReason && (
        <div className="rounded-xl bg-[#FDECEC] px-4 py-3 text-[12.5px] text-navy">
          <strong className="text-ryg-red">Sent back for clarification</strong> —{" "}
          {trip.returnedReason}. Edit the request and submit it again; it keeps its number and goes
          back to the same approver.
        </div>
      )}

      {trip.status === "rejected" && trip.rejectReason && (
        <div className="rounded-xl bg-[#FDECEC] px-4 py-3 text-[12.5px] text-navy">
          <strong className="text-ryg-red">Turned down</strong> — {trip.rejectReason}
        </div>
      )}

      <Card className="p-4">
        <TripStepper trip={trip} fit />
      </Card>

      {/*
        ⚠ BOTH PANELS RENDER; EACH DECIDES FOR ITSELF WHETHER IT APPLIES. A step
          this trip skipped returns null, which is defect (E) of 20260905120000
          handled where the reader can see it — the RPC refuses as well, but by
          then somebody has already pressed a button they should never have been
          shown.
      */}
      <ApprovalPanel trip={trip} step="manager_approval" />
      <ApprovalPanel trip={trip} step="director_approval" />
      <AdvancePanel trip={trip} />
      <AdvanceRecoveryPanel trip={trip} />
      <BookingPanel trip={trip} />

      {/*
        The claim half.

        ⚠ ONE OR THE OTHER, KEYED ON THE STATUS, because they are two different
          jobs on the same figures. Before it is filed the traveller is writing
          it and every number moves as they type; once filed it is frozen and
          somebody else is judging it. Showing both at once would offer an
          approve button beside an editable amount.

        ⚠ THE CLAIM PANEL ALSO SHOWS FOR A CANCELLED TRIP. `cancelled_pending_claim`
          is a journey that did not happen and money that did — a §4.1
          cancellation charge, or an advance to hand back.
      */}
      {(trip.status === "booked" || trip.status === "cancelled_pending_claim") && (
        <ClaimPanel trip={trip} />
      )}
      {trip.status === "awaiting_claim_review" && <ClaimReviewPanel trip={trip} />}
      {trip.status === "awaiting_finance_review" && <FinanceReviewPanel trip={trip} />}
      {/*
        ⚠ THE SETTLEMENT PANEL RENDERS PAST THE STEP, not only at it. Once a trip
          is closed it is the ONLY place the amount, the date, the mode and the
          reference are visible, and "what was actually paid, and against what
          reference" is the question asked most often about a trip that finished
          months ago. It returns null on its own for any other state.
      */}
      <SettlementPanel trip={trip} />

      {/*
        ⚠ THE THREAD SITS BELOW THE PANELS AND ABOVE NOTHING. It is the last
          thing on the page because it is the only part that grows without bound;
          putting it between the panels would push the actionable half of the
          screen off the fold on any trip with a long history.
      */}
      <TripThread trip={trip} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Card className="p-4">
            <h2 className={SECTION_HEADING_CLASS}>The request</h2>
            <div className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Field label="Traveller" value={trip.travellerName} />
              <Field label="Raised by" value={personById(trip.raisedBy)?.name ?? "—"} />
              <Field label="Purpose" value={purpose?.name ?? "—"} />
              <Field label="Destination" value={city?.name ?? "—"} />
              <Field
                label="Departure"
                value={trip.plannedDepartureDate ? formatDateDMY(trip.plannedDepartureDate) : "—"}
              />
              <Field
                label="Return"
                value={trip.plannedReturnDate ? formatDateDMY(trip.plannedReturnDate) : "—"}
              />
              <Field
                label="Journey"
                value={
                  trip.journeyType === "one_way"
                    ? "One way"
                    : trip.journeyType === "multi_city"
                      ? "Multi-city"
                      : trip.journeyType === "round_trip"
                        ? "Return"
                        : "—"
                }
              />
              <Field
                label="Preferred time"
                value={TIME_SLOTS.find((t) => t.value === trip.preferredSlot)?.label ?? "—"}
              />
              <Field label="Estimated cost" value={money(trip.estimatedCost)} />
              <Field label="Accommodation" value={trip.accommodationRequired ? "Needed" : "Not needed"} />
              {trip.purposeOtherRemarks && (
                <div className="sm:col-span-2">
                  <Field label="Why" value={trip.purposeOtherRemarks} emphasis="quiet" />
                </div>
              )}
              {trip.isEmergency && (
                <div className="sm:col-span-2">
                  <Field
                    label="Emergency travel (§3.5)"
                    value={trip.emergencyReason ?? "No reason recorded"}
                    emphasis="quiet"
                  />
                </div>
              )}
            </div>
          </Card>

          <ApprovalHistory trip={trip} />

          <Card className="p-4">
            <h2 className={SECTION_HEADING_CLASS}>Travel advance</h2>
            {trip.advanceSkipped || !trip.advanceRequested ? (
              <p className="mt-2 text-[12.5px] text-grey">
                No advance was requested, so the Advance step does not apply to this trip.
              </p>
            ) : (
              <div className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-3">
                <Field label="Requested" value={money(trip.advanceRequestedAmount)} />
                <Field label="Agreed" value={money(trip.advanceApprovedAmount)} />
                <Field label="Paid" value={money(trip.advancePaidAmount)} />
                {trip.advancePaidAt && (
                  <Field label="Paid on" value={formatDateDMY(trip.advancePaidAt)} />
                )}
                {trip.advancePaidMode && <Field label="Mode" value={trip.advancePaidMode} />}
                {trip.advancePaidRef && <Field label="Reference" value={trip.advancePaidRef} />}
                {trip.advanceRecoveredAmount !== null && (
                  <Field label="Recovered" value={money(trip.advanceRecoveredAmount)} />
                )}
                {trip.advNote && (
                  <div className="sm:col-span-3">
                    <Field label="Finance's note" value={trip.advNote} emphasis="quiet" />
                  </div>
                )}
              </div>
            )}
          </Card>

      {/*
        ⚠ SHOWN FROM THE BOOKING STEP ONWARDS, not only while booking is open.
          A refund lands weeks after the trip, and the claim is measured against
          what was actually booked — hiding the legs once the step closed would
          be hiding the evidence at exactly the moment somebody needs it.
      */}
          {trip.status !== "draft" &&
            trip.status !== "awaiting_manager_approval" &&
            trip.status !== "awaiting_director_approval" &&
            trip.status !== "returned" &&
            trip.status !== "rejected" && <LegRows trip={trip} />}

          <Card className="p-4">
            <h2 className={SECTION_HEADING_CLASS}>
              Who is on the booking
            </h2>
            {passengers.length === 0 ? (
              <p className="mt-2 text-[12.5px] text-grey">
                Nobody else. The traveller is the only name on this booking.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {passengers.map((p) => (
                  <div
                    key={p.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2 last:border-b-0 last:pb-0"
                  >
                    <div className="text-[13px] font-semibold text-navy">{p.fullName}</div>
                    <div className="text-[12px] text-grey-2">
                      {[
                        p.gender ? p.gender[0].toUpperCase() + p.gender.slice(1) : null,
                        p.dateOfBirth ? formatDateDMY(p.dateOfBirth) : null,
                        p.mobile,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "no ticketing details recorded"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-3">
          <Card className="p-4">
            <h2 className={SECTION_HEADING_CLASS}>Frozen at submit</h2>
            {trip.status === "draft" ? (
              <p className="mt-2 text-[12.5px] text-grey">
                Nothing is frozen yet. The band, the travel category, the rate card and the approvers
                are all resolved and written onto this trip when it is submitted — after which a
                promotion or a rate revision cannot re-price it.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                <Field
                  label="Band and category"
                  value={
                    trip.snapTravelCategory
                      ? `Band ${trip.snapBandNo ?? "—"} · ${CATEGORY_LABEL[trip.snapTravelCategory]}`
                      : "—"
                  }
                />
                <Field label="Rate card" value={card?.label ?? "—"} />
                <Field label="Department" value={departmentById(trip.snapDepartmentId)?.name ?? "—"} />
                <Field
                  label="Designation"
                  value={designationById(trip.snapDesignationId)?.name ?? "—"}
                />
                <Field
                  label="Approvers"
                  value={approverNames.length ? approverNames.join(", ") : "—"}
                />
                {trip.approverManagerNote && (
                  <p className="text-[12px] text-grey-2">{trip.approverManagerNote}</p>
                )}
                {dueIso && <Field label="Next step due" value={formatDateDMY(dueIso)} />}
                <Field label="Submitted" value={trip.submittedAt ? formatDateDMY(trip.submittedAt) : "—"} />
              </div>
            )}
          </Card>

          <div className="space-y-1">
            <EntitlementPanel
              entitlement={ent}
              card={card}
              tier={city?.tier ?? null}
              bandNo={entBandNo}
              cityName={city?.name ?? null}
            />
            {isDraft && entBandNo !== null && (
              <p className="px-1 text-[11.5px] text-grey-2">
                Read off today's band and today's rate card. Submitting freezes both onto the trip.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
