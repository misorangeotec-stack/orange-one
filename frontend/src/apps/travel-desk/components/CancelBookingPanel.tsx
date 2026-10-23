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
 * A trip that closed at booking (new process, 2026-10): the booker may still
 * cancel one ticket or all of them, and must give the reason AND the credit
 * note — file, number and amount. Nothing follows; there is no claim.
 *
 * The record of each cancellation shows to everyone who can see the trip.
 */
export default function CancelBookingPanel({ trip }: { trip: Trip }) {
  const s = useTravelStore();
  const personById = useOrgPersonById();
  const legs = s.legsOf(trip.id);
  const cancellations = s.cancellationsOf(trip.id);
  const live = legs.filter((l) => !l.cancelledAt);

  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [cnNo, setCnNo] = useState("");
  const [cnAmount, setCnAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!trip.closedAtBooking) return null;

  const canCancel = trip.status === "closed" && live.length > 0 && s.canActOn("booking", trip);
  if (!canCancel && cancellations.length === 0) return null;

  const legText = (l: TripLeg): string =>
    [
      LEG_LABEL[l.kind],
      [s.cityById(l.fromCityId)?.name, s.cityById(l.toCityId)?.name].filter(Boolean).join(" → "),
      l.startOn ? formatDateDMY(l.startOn) : null,
      l.bookingRef,
    ]
      .filter(Boolean)
      .join(" · ");

  const pickedLegs = live.filter((l) => picked.includes(l.id));
  const paid = pickedLegs.reduce((sum, l) => sum + l.ticketCost + l.otherCharges, 0);
  const amount = cnAmount.trim() === "" ? null : Number(cnAmount);
  const whole = picked.length > 0 && picked.length === live.length;

  const missing: string[] = [];
  if (picked.length === 0) missing.push("choose the ticket(s)");
  if (!reason.trim()) missing.push("the reason");
  if (!file) missing.push("the credit note file");
  if (!cnNo.trim()) missing.push("the credit note number");
  if (amount === null || !Number.isFinite(amount) || amount < 0) missing.push("the credit note amount");
  const tooMuch = amount !== null && amount > paid && picked.length > 0;

  const reset = () => {
    setOpen(false);
    setPicked([]);
    setReason("");
    setFile(null);
    setCnNo("");
    setCnAmount("");
    setErr(null);
  };

  const submit = async () => {
    if (missing.length || tooMuch || !file || amount === null) return;
    setBusy(true);
    setErr(null);
    try {
      const path = await uploadTravelDoc(trip.id, "cancellation", file);
      await s.cancelBooking(trip.id, {
        legIds: picked,
        reason: reason.trim(),
        creditNoteNo: cnNo.trim(),
        creditNoteAmount: amount,
        creditNotePath: path,
      });
      reset();
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
      <Card className={canCancel ? "p-4" : "border-ryg-red/30 p-4"}>
        <h2 className={SECTION_HEADING_CLASS}>
          {trip.status === "cancelled" ? "Cancelled" : "Booked and closed"}
        </h2>
        {canCancel && (
          <>
            <p className="mt-1 text-[12.5px] text-grey">
              The trip closed at booking. If a ticket has to be cancelled, cancel it here — one ticket
              or the whole trip. The reason and the credit note are both required.
            </p>
            <div className="mt-3">
              <Button variant="outline" onClick={() => setOpen(true)}>
                Cancel booking
              </Button>
            </div>
          </>
        )}

        {cancellations.length > 0 && (
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
                {cancellations.map((c) => (
                  <tr key={c.id} className="border-b border-line align-top last:border-b-0">
                    <td className="whitespace-nowrap py-1.5 pr-3 text-grey">
                      {formatDateDMY(c.cancelledAt)}
                      <div className="text-[11.5px] text-grey-2">
                        {personById(c.cancelledBy)?.name ?? "—"}
                      </div>
                    </td>
                    <td className="py-1.5 pr-3">
                      {c.wholeTrip && (
                        <div className="text-[11.5px] font-semibold text-ryg-red">Whole trip</div>
                      )}
                      {c.legIds
                        .map((id) => legs.find((l) => l.id === id))
                        .filter((l): l is TripLeg => !!l)
                        .map((l) => (
                          <div key={l.id}>{legText(l)}</div>
                        ))}
                    </td>
                    <td className="py-1.5 pr-3 text-grey">{c.reason}</td>
                    <td className="whitespace-nowrap py-1.5 pr-3">{c.creditNoteNo}</td>
                    <td className="whitespace-nowrap py-1.5 pr-3 text-right font-semibold text-navy">
                      {money(c.creditNoteAmount)}
                    </td>
                    <td className="whitespace-nowrap py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => openDoc(c.creditNotePath)}
                        className="text-[12px] font-medium text-navy hover:text-orange hover:underline"
                      >
                        Credit note
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {err && !open && <p className="mt-2 break-words text-[12.5px] text-ryg-red">{err}</p>}
      </Card>

      <Modal open={open} onClose={reset} title="Cancel booking">
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
                Every ticket is chosen, so the trip will be cancelled.
              </p>
            )}
          </div>

          <FieldLabel label="Reason" required>
            <TextArea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </FieldLabel>

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
            <FieldLabel
              label="Credit note amount"
              required
              hint={picked.length ? `paid for the chosen tickets: ${money(paid)}` : undefined}
            >
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
              The credit note is more than was paid for the chosen tickets ({money(paid)}).
            </p>
          )}
          {missing.length > 0 && (picked.length > 0 || reason || file || cnNo || cnAmount) && (
            <p className="text-[12px] text-grey-2">Still needed: {missing.join(", ")}.</p>
          )}
          {err && <p className="break-words text-[12.5px] text-ryg-red">{err}</p>}

          <div className="flex items-center gap-3 pt-1">
            <Button onClick={submit} disabled={busy || missing.length > 0 || tooMuch}>
              {busy ? "Saving…" : whole ? "Cancel the whole trip" : "Cancel the ticket(s)"}
            </Button>
            <Button variant="ghost" onClick={reset} disabled={busy}>
              Never mind
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
