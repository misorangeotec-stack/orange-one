import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import { TextArea } from "@/shared/components/ui/Form";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { useDirectory } from "@/core/platform/store";
import { useTravelStore } from "../store";
import { downloadTravelAuthorisation } from "../lib/travelAuthorisationPdf";
import { downloadClaimForm } from "../lib/claimFormPdf";
import { OPEN_STATUSES, type Trip } from "../types";

/**
 * What can be done TO a trip, as opposed to at one of its steps.
 *
 * ⚠ HOLD IS OFFERED TO THE TRAVELLER, and that is a deliberate correction. They
 *   could already cancel — losing the number, the approvals and the history — so
 *   leaving the safe action harder to reach than the destructive one taught
 *   people to cancel a trip that had merely slipped a fortnight. Both RPCs take
 *   the same list of people.
 *
 * ⚠ TRVL-FRM-01 APPEARS ONLY ONCE THE CLAIM HAS BEEN FILED, for the same
 *   reason. It prints allowed amounts, a daily allowance and four signature
 *   blocks; produced from an unfiled claim it would show every figure as a
 *   blank or a zero and still look like a signed-off document.
 *
 * ⚠ THE AUTHORISATION APPEARS ONLY ONCE EVERY REQUIRED APPROVAL IS IN. A slip
 *   headed "Travel Authorisation" that was printed before anyone approved
 *   anything is worse than no slip: it is a document a hotel or an auditor will
 *   read as permission. "Required" means what the trip's own skip flags say, not
 *   what the matrix says today.
 */
export default function TripActions({ trip }: { trip: Trip }) {
  const s = useTravelStore();
  const personById = useOrgPersonById();
  const { departmentById, designationById } = useDirectory();

  const [ask, setAsk] = useState<"hold" | "cancel" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const isOpen = OPEN_STATUSES.includes(trip.status);
  const mine = trip.raisedBy === s.userId || trip.travellerId === s.userId;
  const canPark = s.canEdit && (mine || s.isProcessCoordinator || s.isAdmin);

  const canHold = canPark && isOpen && trip.status !== "draft" && trip.status !== "on_hold";
  const canResume = canPark && trip.status === "on_hold";
  const canCancel = canPark && isOpen && trip.status !== "draft";

  const managerDone = trip.managerApprovalSkipped || trip.maDecision === "approve";
  const directorDone = trip.directorApprovalSkipped || trip.daDecision === "approve";
  const approved = managerDone && directorDone && trip.status !== "draft"
    && trip.status !== "returned" && trip.status !== "rejected";

  const run = async (fn: () => Promise<unknown>, tag: string) => {
    setBusy(tag);
    setErr(null);
    try {
      await fn();
      setAsk(null);
      setReason("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const makePdf = () =>
    run(async () => {
      const city = s.cityById(trip.destinationCityId);
      await downloadTravelAuthorisation({
        trip,
        // ⚠ THE TRIP'S OWN FROZEN CARD, never today's. A card superseded the week
        //   after departure must not change what the traveller was told.
        entitlement: s.entitlementOn(trip.snapRateCardId, trip.snapBandNo, city?.tier ?? null),
        card: s.rateCards.find((c) => c.id === trip.snapRateCardId),
        city,
        purpose: s.purposes.find((p) => p.id === trip.purposeId),
        passengers: s.passengersOf(trip.id),
        names: {
          traveller: trip.travellerName,
          raisedBy: personById(trip.raisedBy)?.name ?? null,
          manager: personById(trip.maBy)?.name ?? null,
          director: personById(trip.daBy)?.name ?? null,
          department: departmentById(trip.snapDepartmentId)?.name ?? null,
          designation: designationById(trip.snapDesignationId)?.name ?? null,
        },
        company: s.config.companyIdentity,
      });
    }, "pdf");

  const claimFiled = trip.clAt !== null;

  const makeClaimPdf = () =>
    run(async () => {
      await downloadClaimForm({
        trip,
        lines: s.claimLinesOf(trip.id),
        // The FROZEN days, not a fresh computation. A form regenerated months
        // later must print what was settled, not what today's rules would give.
        daDays: s.daDaysOf(trip.id),
        categories: s.expenseCategories,
        cities: s.cities,
        card: s.rateCards.find((c) => c.id === trip.snapRateCardId),
        names: {
          traveller: trip.travellerName,
          department: departmentById(trip.snapDepartmentId)?.name ?? null,
          designation: designationById(trip.snapDesignationId)?.name ?? null,
          manager: personById(trip.crBy)?.name ?? null,
          finance: personById(trip.frBy)?.name ?? null,
        },
        company: s.config.companyIdentity,
      });
    }, "claimpdf");

  if (!canHold && !canResume && !canCancel && !approved && !claimFiled) return null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        {approved && (
          <Button variant="outline" onClick={makePdf} disabled={!!busy}>
            {busy === "pdf" ? "Building…" : "Travel Authorisation (PDF)"}
          </Button>
        )}
        {claimFiled && (
          <Button variant="outline" onClick={makeClaimPdf} disabled={!!busy}>
            {busy === "claimpdf" ? "Building…" : "Expense claim TRVL-FRM-01 (PDF)"}
          </Button>
        )}
        {canResume && (
          <Button onClick={() => run(() => s.resumeTrip(trip.id), "resume")} disabled={!!busy}>
            {busy === "resume" ? "Resuming…" : "Take off hold"}
          </Button>
        )}
        {canHold && (
          <Button variant="outline" onClick={() => setAsk("hold")} disabled={!!busy}>
            Put on hold
          </Button>
        )}
        {canCancel && (
          <button
            type="button"
            onClick={() => setAsk("cancel")}
            disabled={!!busy}
            className="text-[12.5px] font-medium text-ryg-red hover:underline disabled:opacity-50"
          >
            Cancel this trip
          </button>
        )}
      </div>

      {err && <p className="mt-2 break-words text-[12.5px] text-ryg-red">{err}</p>}

      <Modal
        open={ask !== null}
        onClose={() => {
          setAsk(null);
          setReason("");
          setErr(null);
        }}
        title={ask === "cancel" ? "Cancel this trip" : "Put this trip on hold"}
      >
        <p className="text-[13px] text-grey">
          {ask === "cancel" ? (
            <>
              The trip keeps its number and its history — a cancelled trip is a record, not a
              deletion. Any advance already paid still has to be recovered.
            </>
          ) : (
            <>
              It stops appearing in anybody's queue and moves to the Parked strip. Taking it off
              hold puts it back exactly where it was — never at a step it had skipped.
            </>
          )}
        </p>

        <div className="mt-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-grey">
            Reason — required
          </div>
          <TextArea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
        </div>

        {err && <p className="mt-2 break-words text-[12.5px] text-ryg-red">{err}</p>}

        <div className="mt-4 flex items-center gap-3">
          <Button
            onClick={() =>
              run(
                () =>
                  ask === "cancel"
                    ? s.cancelTrip(trip.id, reason.trim())
                    : s.holdTrip(trip.id, reason.trim()),
                "modal",
              )
            }
            disabled={!!busy || !reason.trim()}
          >
            {busy === "modal" ? "Saving…" : ask === "cancel" ? "Cancel the trip" : "Put on hold"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setAsk(null);
              setReason("");
            }}
          >
            Never mind
          </Button>
        </div>
      </Modal>
    </>
  );
}
