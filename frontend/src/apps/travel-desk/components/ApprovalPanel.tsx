import { useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { TextArea } from "@/shared/components/ui/Form";
import { SECTION_HEADING_CLASS } from "@/shared/components/ui/Readout";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { formatDateDMY } from "@/shared/lib/date";
import { useTravelStore } from "../store";
import { money } from "../lib/format";
import type { Decision } from "../data/travelApprovalWrites";
import type { Trip } from "../types";

/**
 * The decision itself — approve, send back, or turn down.
 *
 * ⚠ THREE OUTCOMES, NOT TWO, AND "SEND BACK" IS THE IMPORTANT ONE. Without it
 *   an approver looking at a hotel ₹800 over cap has only a rejection, which
 *   kills the trip number and makes the traveller start again. Returning it puts
 *   the request back in the author's hands with the reason attached, keeps the
 *   number, and — because `fms_travel_decide` clears the decision stamp on the
 *   way out — brings it back to the same approver rather than past them.
 *
 * ⚠ A REJECTION OR A RETURN WITHOUT A REASON IS REFUSED BY THE DATABASE. The
 *   button is disabled here too, but that is only so nobody has to discover it
 *   by pressing it: `fms_travel_decide` raises either way.
 *
 * ⚠ THE PANEL DOES NOT APPEAR FOR A STEP THIS TRIP SKIPPED. That is defect (E)
 *   from 20260905120000 — an approver "correcting" a decision that was never
 *   made, because the screen keyed on status alone and a skipped record sits at
 *   exactly the status the next step expects. The RPC refuses it as well; this
 *   is what stops the button being there to press.
 */
export default function ApprovalPanel({
  trip,
  step,
}: {
  trip: Trip;
  step: "manager_approval" | "director_approval";
}) {
  const s = useTravelStore();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<Decision | "">("");
  const [err, setErr] = useState<string | null>(null);

  const skipped =
    step === "director_approval" ? trip.directorApprovalSkipped : trip.managerApprovalSkipped;
  const expected =
    step === "director_approval" ? "awaiting_director_approval" : "awaiting_manager_approval";

  if (skipped || trip.status !== expected) return null;
  if (!s.canActOn(step, trip)) return null;

  const isSelf = trip.travellerId === s.userId;
  const label = step === "director_approval" ? "Director approval" : "Reporting manager approval";

  const act = async (decision: Decision) => {
    setBusy(decision);
    setErr(null);
    try {
      await s.decideApproval(step, trip.id, decision, note.trim() || null);
      setNote("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  return (
    <Card className="border-orange/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={SECTION_HEADING_CLASS}>{label}</h2>
        <span className="text-[11.5px] text-grey-2">
          {trip.submittedAt ? `submitted ${formatDateDMY(trip.submittedAt)}` : ""}
        </span>
      </div>

      {/*
        ⚠ SAID HERE, NOT DISCOVERED ON PRESSING APPROVE. A coordinator or an
          admin passes fms_travel_can_act on every step, so without this the
          panel appears in full for somebody the database will then refuse. The
          refusal is right — nobody approves their own travel — but being told
          afterwards reads as a bug rather than as the rule.
      */}
      {isSelf ? (
        <p className="mt-2 rounded-lg bg-[#FDECEC] px-3 py-2 text-[12.5px] text-ryg-red">
          This is your own trip, so you cannot decide it. It needs somebody else —
          {step === "director_approval"
            ? " a second Director,"
            : " your reporting manager,"}{" "}
          or whoever is named on this step in Settings.
        </p>
      ) : (
        <>
          <p className="mt-2 text-[12.5px] text-grey">
            {trip.travellerName} is asking for {money(trip.estimatedCost)}
            {trip.plannedDepartureDate ? `, leaving ${formatDateDMY(trip.plannedDepartureDate)}` : ""}
            {trip.advanceRequested
              ? `, with an advance of ${money(trip.advanceRequestedAmount)} before departure`
              : ""}
            . The entitlement this is measured against is shown beside it.
          </p>

          {/*
            §3.5's consequence, surfaced at the moment somebody is deciding. The
            downgrade already happened at submit; an approver who does not know
            it happened would read the TC-D caps as this person's normal
            entitlement and wonder why a band-7 traveller is on the bottom rate.
          */}
          {trip.tcDowngradedFrom && (
            <p className="mt-2 rounded-lg bg-[#FFF7E6] px-3 py-2 text-[12.5px] text-navy">
              This trip was regularised after departure, so §3.5 has already reduced it from{" "}
              <strong>{trip.tcDowngradedFrom}</strong> to <strong>TC-D</strong>. Approving it does
              not restore the original rate.
            </p>
          )}

          {trip.returnedStage && trip.returnedReason && (
            <p className="mt-2 text-[12px] text-grey-2">
              Previously sent back — “{trip.returnedReason}”
            </p>
          )}

          <div className="mt-3">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-grey">
              Your note
              <span className="ml-1 font-normal normal-case tracking-normal text-grey-2">
                — required to send back or turn down
              </span>
            </div>
            <TextArea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="what the author needs to change, or why this is refused"
            />
          </div>

          {err && <p className="mt-2 break-words text-[12.5px] text-ryg-red">{err}</p>}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button onClick={() => act("approve")} disabled={!!busy}>
              {busy === "approve" ? "Approving…" : "Approve"}
            </Button>
            <Button variant="outline" onClick={() => act("return")} disabled={!!busy || !note.trim()}>
              {busy === "return" ? "Sending back…" : "Send back for clarification"}
            </Button>
            <button
              type="button"
              onClick={() => act("reject")}
              disabled={!!busy || !note.trim()}
              className="text-[12.5px] font-medium text-ryg-red hover:underline disabled:opacity-50"
            >
              {busy === "reject" ? "Turning down…" : "Turn it down"}
            </button>
            {!note.trim() && (
              <span className="text-[12px] text-grey-2">
                Sending back and turning down both need a reason.
              </span>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

/**
 * What each gate DECIDED, once it has. Shown on every trip past the approvals.
 *
 * ⚠ A SKIPPED GATE SAYS SO RATHER THAN VANISHING. Dropping the row entirely
 *   would make a band-3 trip look identical to one whose Director approval is
 *   still pending — and "nobody has looked at this" and "nobody needed to" are
 *   the two readings that must never blur on a spending control.
 */
export function ApprovalHistory({ trip }: { trip: Trip }) {
  const personById = useOrgPersonById();

  const rows: {
    key: string;
    label: string;
    skipped: boolean;
    at: string | null;
    by: string | null;
    decision: string | null;
    note: string | null;
    why: string;
  }[] = [
    {
      key: "ma",
      label: "Reporting manager",
      skipped: trip.managerApprovalSkipped,
      at: trip.maAt,
      by: personById(trip.maBy)?.name ?? null,
      decision: trip.maDecision,
      note: trip.maNote,
      why: "The approval matrix sends this band straight to a Director.",
    },
    {
      key: "da",
      label: "Director",
      skipped: trip.directorApprovalSkipped,
      at: trip.daAt,
      by: personById(trip.daBy)?.name ?? null,
      decision: trip.daDecision,
      note: trip.daNote,
      why: `Band ${trip.snapBandNo ?? "—"} does not need one (§3.2).`,
    },
  ];

  if (trip.status === "draft") return null;

  return (
    <Card className="p-4">
      <h2 className={SECTION_HEADING_CLASS}>Approvals</h2>
      <div className="mt-3 space-y-3">
        {rows.map((r) => (
          <div key={r.key} className="border-b border-line pb-3 last:border-b-0 last:pb-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[13px] font-semibold text-navy">{r.label}</span>
              <span
                className={`text-[12px] ${
                  r.skipped
                    ? "text-grey-2"
                    : r.decision === "approve"
                      ? "text-ryg-green"
                      : r.decision
                        ? "text-ryg-red"
                        : "text-yellow"
                }`}
              >
                {r.skipped
                  ? "Not required"
                  : r.decision === "approve"
                    ? `Approved${r.by ? ` by ${r.by}` : ""}${r.at ? ` · ${formatDateDMY(r.at)}` : ""}`
                    : r.decision === "reject"
                      ? `Turned down${r.by ? ` by ${r.by}` : ""}`
                      : r.decision === "return"
                        ? `Sent back${r.by ? ` by ${r.by}` : ""}`
                        : "Waiting"}
              </span>
            </div>
            {r.skipped && <p className="mt-0.5 text-[11.5px] text-grey-2">{r.why}</p>}
            {r.note && !r.skipped && (
              <p className="mt-0.5 text-[12px] text-grey">“{r.note}”</p>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
