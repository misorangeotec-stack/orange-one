import { useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import FileCapture from "@/shared/components/ui/FileCapture";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { SECTION_HEADING_CLASS } from "@/shared/components/ui/Readout";
import { formatDateDMY } from "@/shared/lib/date";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { useTravelStore } from "../store";
import { money, LEG_LABEL } from "../lib/format";
import { uploadTravelDoc, travelDocUrl } from "../data/travelBookingWrites";
import type { Trip, TripLeg } from "../types";

/**
 * Cancelling a trip that closed at booking — in two hands (since 2026-10-23).
 *
 *   1. The person who RAISED the trip clicks "Cancel booking", chooses the
 *      ticket(s) and writes the reason. Nothing is cancelled yet: the trip goes
 *      to the Cancel Trip bucket.
 *   2. Whoever owns "Cancel Trip" in Settings opens it, uploads the credit note
 *      and types its number and amount. Only then are the tickets cancelled.
 *
 * The record of each cancellation shows to everyone who can see the trip.
 */
export default function CancelBookingPanel({ trip }: { trip: Trip }) {
  const s = useTravelStore();
  const personById = useOrgPersonById();
  const legs = s.legsOf(trip.id);
  const cancellations = s.cancellationsOf(trip.id);
  const pending = cancellations.find((c) => c.status === "requested") ?? null;
  const done = cancellations.filter((c) => c.status === "completed");
  const live = legs.filter((l) => !l.cancelledAt);

  // Step 1 — the raiser's popup.
  const [asking, setAsking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  // Step 2 — the Cancel Trip owner's form.
  const [file, setFile] = useState<File | null>(null);
  const [cnNo, setCnNo] = useState("");
  const [cnAmount, setCnAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!trip.closedAtBooking) return null;

  const mine = trip.raisedBy === s.userId || trip.travellerId === s.userId;
  const canAsk =
    trip.status === "closed" && live.length > 0 && s.canEdit && (mine || s.isProcessCoordinator || s.isAdmin);
  const canComplete = trip.status === "cancel_pending" && !!pending && s.canActOn("cancel_trip", trip);

  if (!canAsk && !pending && done.length === 0) return null;

  const legText = (l: TripLeg): string =>
    [
      LEG_LABEL[l.kind],
      [s.cityById(l.fromCityId)?.name, s.cityById(l.toCityId)?.name].filter(Boolean).join(" → "),
      l.startOn ? formatDateDMY(l.startOn) : null,
      l.bookingRef,
    ]
      .filter(Boolean)
      .join(" · ");
  const legsOfIds = (ids: string[]): TripLeg[] =>
    ids.map((id) => legs.find((l) => l.id === id)).filter((l): l is TripLeg => !!l);

  const whole = picked.length > 0 && picked.length === live.length;

  // ---- step 2 figures -------------------------------------------------------
  const pendingLegs = pending ? legsOfIds(pending.legIds) : [];
  const paid = pendingLegs.reduce((sum, l) => sum + l.ticketCost + l.otherCharges, 0);
  const amount = cnAmount.trim() === "" ? null : Number(cnAmount);
  const missing: string[] = [];
  if (!file) missing.push("the credit note file");
  if (!cnNo.trim()) missing.push("the credit note number");
  if (amount === null || !Number.isFinite(amount) || amount < 0) missing.push("the credit note amount");
  const tooMuch = amount !== null && amount > paid;

  const resetAsk = () => {
    setAsking(false);
    setPicked([]);
    setReason("");
    setErr(null);
  };

  const ask = async () => {
    if (picked.length === 0 || !reason.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await s.requestCancelBooking(trip.id, picked, reason.trim());
      resetAsk();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    if (!pending || missing.length || tooMuch || !file || amount === null) return;
    setBusy(true);
    setErr(null);
    try {
      const path = await uploadTravelDoc(trip.id, "cancellation", file);
      await s.completeCancelBooking(pending.id, {
        creditNoteNo: cnNo.trim(),
        creditNoteAmount: amount,
        creditNotePath: path,
      });
      setFile(null);
      setCnNo("");
      setCnAmount("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openDoc = async (path: string) => {
    try {
      window.open(await travelDocUrl(path), "_blank", "noopener");
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <>
      {/* ---- waiting in the Cancel Trip bucket ------------------------------ */}
      {pending && (
        <Card className="border-orange/40 p-4">
          <h2 className={SECTION_HEADING_CLASS}>Cancel Trip — waiting for the credit note</h2>
          <div className="mt-2 space-y-1 text-[12.5px] text-navy">
            <div>
              <span className="text-grey">Asked by </span>
              {personById(pending.requestedBy)?.name ?? "—"}
              <span className="text-grey"> on {formatDateDMY(pending.requestedAt)}</span>
            </div>
            <div>
              <span className="text-grey">Tickets: </span>
              {pending.wholeTrip && <strong className="text-ryg-red">Whole trip — </strong>}
              {pendingLegs.map(legText).join("; ") || "—"}
            </div>
            <div>
              <span className="text-grey">Reason: </span>
              {pending.reason}
            </div>
          </div>

          {canComplete ? (
            <div className="mt-4 space-y-3 rounded-xl border border-line p-3">
              {/* Not a FieldLabel: a <label> around FileCapture's buttons would fire
                  "Take photo" whenever the caption is clicked. */}
              <div>
                <div className="mb-1.5 text-[13px] font-medium text-navy">
                  Credit note<span className="text-orange"> *</span>
                </div>
                <FileCapture value={file} onChange={setFile} disabled={busy} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <FieldLabel label="Credit note number" required>
                  <TextInput value={cnNo} onChange={(e) => setCnNo(e.target.value)} />
                </FieldLabel>
                <FieldLabel label="Credit note amount" required hint={`paid for these tickets: ${money(paid)}`}>
                  <TextInput
                    type="number"
                    min={0}
                    step="0.01"
                    value={cnAmount}
                    onChange={(e) => setCnAmount(e.target.value)}
                  />
                </FieldLabel>
              </div>
              {tooMuch && (
                <p className="text-[12.5px] text-ryg-red">
                  The credit note is more than was paid for these tickets ({money(paid)}).
                </p>
              )}
              {missing.length > 0 && (file || cnNo || cnAmount) && (
                <p className="text-[12px] text-grey-2">Still needed: {missing.join(", ")}.</p>
              )}
              {err && <p className="break-words text-[12.5px] text-ryg-red">{err}</p>}
              <Button onClick={complete} disabled={busy || missing.length > 0 || tooMuch}>
                {busy ? "Saving…" : pending.wholeTrip ? "Submit — cancel the whole trip" : "Submit — cancel the ticket(s)"}
              </Button>
            </div>
          ) : (
            <p className="mt-3 text-[12.5px] text-grey-2">
              It is in the Cancel Trip bucket. The tickets are cancelled once the Cancel Trip team
              uploads the credit note.
            </p>
          )}
        </Card>
      )}

      {/* ---- the raiser asks ------------------------------------------------ */}
      {(canAsk || done.length > 0) && (
        <Card className="p-4">
          <h2 className={SECTION_HEADING_CLASS}>
            {trip.status === "cancelled" ? "Cancelled" : "Booked and closed"}
          </h2>
          {canAsk && (
            <>
              <p className="mt-1 text-[12.5px] text-grey">
                If a ticket has to be cancelled, choose it and give the reason. The Cancel Trip team
                then files the credit note.
              </p>
              <div className="mt-3">
                <Button variant="outline" onClick={() => setAsking(true)}>
                  Cancel booking
                </Button>
              </div>
            </>
          )}

          {done.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-[12.5px]">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-grey">
                    <th className="py-1.5 pr-3">Cancelled</th>
                    <th className="py-1.5 pr-3">Tickets</th>
                    <th className="py-1.5 pr-3">Reason</th>
                    <th className="py-1.5 pr-3">Credit note</th>
                    <th className="py-1.5 pr-3 text-right">Amount</th>
                    <th className="py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {done.map((c) => (
                    <tr key={c.id} className="border-b border-line align-top last:border-b-0">
                      <td className="whitespace-nowrap py-1.5 pr-3 text-grey">
                        {c.cancelledAt ? formatDateDMY(c.cancelledAt) : "—"}
                        <div className="text-[11.5px] text-grey-2">
                          asked by {personById(c.requestedBy)?.name ?? "—"}
                        </div>
                        <div className="text-[11.5px] text-grey-2">
                          filed by {personById(c.cancelledBy)?.name ?? "—"}
                        </div>
                      </td>
                      <td className="py-1.5 pr-3">
                        {c.wholeTrip && (
                          <div className="text-[11.5px] font-semibold text-ryg-red">Whole trip</div>
                        )}
                        {legsOfIds(c.legIds).map((l) => (
                          <div key={l.id}>{legText(l)}</div>
                        ))}
                      </td>
                      <td className="py-1.5 pr-3 text-grey">{c.reason}</td>
                      <td className="whitespace-nowrap py-1.5 pr-3">{c.creditNoteNo ?? "—"}</td>
                      <td className="whitespace-nowrap py-1.5 pr-3 text-right font-semibold text-navy">
                        {money(c.creditNoteAmount)}
                      </td>
                      <td className="whitespace-nowrap py-1.5 text-right">
                        {c.creditNotePath && (
                          <button
                            type="button"
                            onClick={() => openDoc(c.creditNotePath as string)}
                            className="text-[12px] font-medium text-navy hover:text-orange hover:underline"
                          >
                            Credit note
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {err && !asking && !pending && <p className="mt-2 break-words text-[12.5px] text-ryg-red">{err}</p>}
        </Card>
      )}

      <Modal open={asking} onClose={resetAsk} title="Cancel booking">
        <div className="space-y-3">
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-grey">
                Which tickets — required
              </span>
              <button
                type="button"
                onClick={() => setPicked(whole ? [] : live.map((l) => l.id))}
                className="text-[12px] font-medium text-navy hover:text-orange hover:underline"
              >
                {whole ? "Clear" : "Whole trip (all tickets)"}
              </button>
            </div>
            <div className="space-y-1 rounded-xl border border-line p-2">
              {live.map((l) => (
                <label key={l.id} className="flex items-start gap-2 text-[12.5px] text-navy">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={picked.includes(l.id)}
                    onChange={(e) =>
                      setPicked((p) => (e.target.checked ? [...p, l.id] : p.filter((x) => x !== l.id)))
                    }
                  />
                  <span className="flex-1">{legText(l)}</span>
                  <span className="whitespace-nowrap text-grey">{money(l.ticketCost + l.otherCharges)}</span>
                </label>
              ))}
            </div>
            {whole && (
              <p className="mt-1 text-[11.5px] text-ryg-red">
                Every ticket is chosen, so the whole trip will be cancelled.
              </p>
            )}
          </div>

          <FieldLabel label="Reason for cancellation" required>
            <TextArea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </FieldLabel>

          <p className="text-[12px] text-grey-2">
            This goes to the Cancel Trip team, who upload the credit note. The tickets are cancelled
            once they submit it.
          </p>

          {err && <p className="break-words text-[12.5px] text-ryg-red">{err}</p>}

          <div className="flex items-center gap-3 pt-1">
            <Button onClick={ask} disabled={busy || picked.length === 0 || !reason.trim()}>
              {busy ? "Sending…" : "Submit"}
            </Button>
            <Button variant="ghost" onClick={resetAsk} disabled={busy}>
              Never mind
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
