import { useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import { TextArea, Select } from "@/shared/components/ui/Form";
import { SECTION_HEADING_CLASS } from "@/shared/components/ui/Readout";
import { useTravelStore } from "../store";
import { money } from "../lib/format";
import type { Trip } from "../types";

/**
 * Closing the booking step, and the cancellation the desk has to decide.
 *
 * ⚠ "BOOKED" WITH NOTHING RECORDED IS A CLAIM NOBODY CAN CHECK, so completing
 *   the step is refused while the trip has no legs on it. The RPC refuses too;
 *   the button is disabled here so nobody has to discover it by pressing.
 *
 * ⚠ THERE IS NO SEPARATE "SHARE THE TICKET" ACTION. The source PRD lists
 *   `Booked` and `Ticket Shared` as two states, but the upload is what puts the
 *   document where the traveller can fetch it AND what notifies them — a second
 *   step would be one that is always already done.
 */
export default function BookingPanel({ trip }: { trip: Trip }) {
  const s = useTravelStore();
  const legs = s.legsOf(trip.id);

  const [busy, setBusy] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [ask, setAsk] = useState<"cancel" | "decide" | null>(null);
  const [reason, setReason] = useState("");
  const [kind, setKind] = useState<"business" | "personal">("business");

  const canBook = s.canActOn("booking", trip);
  const total = legs.reduce((sum, l) => sum + l.netCost, 0);

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

  // ---- the booking step is open -------------------------------------------
  if (trip.status === "awaiting_booking" && canBook) {
    return (
      <Card className="border-orange/40 p-4">
        <h2 className={SECTION_HEADING_CLASS}>Booking</h2>
        <p className="mt-1 text-[12.5px] text-grey">
          Record every flight, train, bus, cab and hotel below, then mark the trip booked. Uploading
          the ticket is what shares it — the traveller is notified and can fetch the document.
        </p>
        {err && <p className="mt-2 break-words text-[12.5px] text-ryg-red">{err}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            onClick={() => run(() => s.completeBooking(trip.id), "book")}
            disabled={!!busy || legs.length === 0}
          >
            {busy === "book" ? "Saving…" : `Mark booked — ${money(total)}`}
          </Button>
          {legs.length === 0 && (
            <span className="text-[12.5px] text-grey-2">
              Add what was booked first. A trip marked booked with nothing on it is a claim nobody
              can check.
            </span>
          )}
        </div>
      </Card>
    );
  }

  // ---- a cancellation is waiting on the desk ------------------------------
  if (trip.status === "cancellation_requested") {
    return (
      <>
        <Card className="border-ryg-red/40 p-4">
          <h2 className={SECTION_HEADING_CLASS}>Cancellation requested</h2>
          <p className="mt-1 text-[12.5px] text-grey">
            {trip.cancelReason ?? "No reason recorded."}
          </p>
          <p className="mt-2 text-[12.5px] text-grey-2">
            Cancel the bookings with the airline or hotel first, record any refund against each
            booking below, then decide here. §4.1 makes a cancellation charge reimbursable when the
            reason is <strong className="text-navy">business</strong> and not when it is personal, so
            that answer is required — it is what phase 8 reads to judge the claim.
          </p>
          {err && <p className="mt-2 break-words text-[12.5px] text-ryg-red">{err}</p>}
          {canBook && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button onClick={() => setAsk("decide")} disabled={!!busy}>
                Process the cancellation
              </Button>
              <button
                type="button"
                onClick={() => setAsk("cancel")}
                disabled={!!busy}
                className="text-[12.5px] font-medium text-navy hover:underline disabled:opacity-50"
              >
                The trip is still on — put it back
              </button>
            </div>
          )}
        </Card>

        <Modal
          open={ask !== null}
          onClose={() => {
            setAsk(null);
            setReason("");
            setErr(null);
          }}
          title={ask === "decide" ? "Process the cancellation" : "Put the trip back on"}
        >
          {ask === "decide" ? (
            <>
              <p className="text-[13px] text-grey">
                Unrefunded charges of <strong className="text-navy">{money(total)}</strong> are
                recorded against this trip
                {s.outstandingAdvanceFor(trip.travellerId, null) > 0 &&
                  `, and ${money(s.outstandingAdvanceFor(trip.travellerId, null))} of advance is still out`}
                . If anything is left to settle the trip goes to the claim step rather than being
                closed — the journey is off, the money is not.
              </p>
              <div className="mt-3">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-grey">
                  Reason — required (§4.1)
                </div>
                <Select value={kind} onChange={(e) => setKind(e.target.value as "business" | "personal")}>
                  <option value="business">
                    Business — the customer moved it, the plant shut, the work was called off
                  </option>
                  <option value="personal">Personal — the traveller chose not to go</option>
                </Select>
                <p className="mt-1 text-[11.5px] text-grey-2">
                  A business-reason charge is reimbursable; a personal one is not.
                </p>
              </div>
            </>
          ) : (
            <p className="text-[13px] text-grey">
              This puts the trip back to booked, with its bookings untouched. Say why so the
              traveller knows what happened.
            </p>
          )}

          <div className="mt-3">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-grey">
              Note {ask === "cancel" ? "— required" : ""}
            </div>
            <TextArea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </div>

          {err && <p className="mt-2 break-words text-[12.5px] text-ryg-red">{err}</p>}

          <div className="mt-4 flex items-center gap-3">
            <Button
              onClick={() =>
                run(
                  () =>
                    ask === "decide"
                      ? s.processCancellation(trip.id, "cancel", kind, reason.trim() || null)
                      : s.processCancellation(trip.id, "refuse", null, reason.trim()),
                  "modal",
                )
              }
              disabled={!!busy || (ask === "cancel" && !reason.trim())}
            >
              {busy === "modal"
                ? "Saving…"
                : ask === "decide"
                  ? "Cancel the trip"
                  : "Put it back on"}
            </Button>
            <Button variant="ghost" onClick={() => setAsk(null)}>
              Never mind
            </Button>
          </div>
        </Modal>
      </>
    );
  }

  // ---- booked: the traveller may ask for it to be cancelled ---------------
  if (trip.status === "booked") {
    const mine =
      trip.travellerId === s.userId || trip.raisedBy === s.userId || s.isProcessCoordinator;
    if (!mine || !s.canEdit) return null;
    return (
      <>
        <Card className="p-4">
          <h2 className={SECTION_HEADING_CLASS}>The trip is booked</h2>
          <p className="mt-1 text-[12.5px] text-grey">
            {money(total)} across {legs.length} {legs.length === 1 ? "booking" : "bookings"}. If the
            journey is off, ask the desk to cancel it — they have to unwind the bookings and record
            any refund.
          </p>
          {err && <p className="mt-2 break-words text-[12.5px] text-ryg-red">{err}</p>}
          <div className="mt-3">
            <Button variant="outline" onClick={() => setAsk("cancel")} disabled={!!busy}>
              Ask the desk to cancel this trip
            </Button>
          </div>
        </Card>

        <Modal
          open={ask === "cancel"}
          onClose={() => {
            setAsk(null);
            setReason("");
            setErr(null);
          }}
          title="Ask the desk to cancel"
        >
          <p className="text-[13px] text-grey">
            The Travel Desk unwinds the bookings and records what was refunded. Any charge that is
            not refunded stays on the trip — reimbursable if the reason is business (§4.1) — and any
            advance already paid still has to come back.
          </p>
          <div className="mt-3">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-grey">
              Why — required
            </div>
            <TextArea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </div>
          {err && <p className="mt-2 break-words text-[12.5px] text-ryg-red">{err}</p>}
          <div className="mt-4 flex items-center gap-3">
            <Button
              onClick={() => run(() => s.requestCancellation(trip.id, reason.trim()), "req")}
              disabled={!!busy || !reason.trim()}
            >
              {busy === "req" ? "Sending…" : "Send the request"}
            </Button>
            <Button variant="ghost" onClick={() => setAsk(null)}>
              Never mind
            </Button>
          </div>
        </Modal>
      </>
    );
  }

  return null;
}
