import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import FileCapture from "@/shared/components/ui/FileCapture";
import { useHelpStore } from "../store";
import { acknowledgeTicket, resolveTicketWithFile } from "../data/helpWrites";
import type { Ticket } from "../types";

/**
 * What the reader can DO to this ticket right now.
 *
 * ⚠ A BUTTON IS SHOWN ONLY WHEN THE SERVER WOULD ACCEPT THE CLICK. `canActOn`
 *   mirrors `fms_help_can_act`; when the two disagree the button is either
 *   missing (work nobody can do) or dead (a click that errors), and the SQL is
 *   the authority. Never widen this without widening that.
 *
 * ⚠ A HELD TICKET KEEPS ITS BUTTONS, GREYED, WITH THE REASON. Removing them
 *   would make a parked ticket look like one the reader has no rights to —
 *   which is a different and much more alarming thing, and it is how a ticket
 *   sits for five weeks with nobody asking why.
 *
 * ⚠ ACKNOWLEDGE IS OFFERED ALONGSIDE RESOLVE, NEVER BEFORE IT. Half of these
 *   are answered in one go and the server back-fills the acknowledgement, so
 *   forcing two clicks would either be ignored or obeyed — and obeyed is worse,
 *   because it produces a ticket acknowledged and resolved in the same second
 *   and a First Response Time of zero that means nothing.
 */
export default function TicketActions({ ticket }: { ticket: Ticket }) {
  const s = useHelpStore();
  const [open, setOpen] = useState<null | "ack" | "resolve">(null);
  const [note, setNote] = useState("");
  const [resolution, setResolution] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const held = ticket.status === "on_hold";
  const canAck = s.canActOn("acknowledge", ticket) && !ticket.acknowledgedAt;
  const canResolve =
    s.canActOn("resolve", ticket) &&
    (ticket.currentStep === "acknowledge" || ticket.currentStep === "resolve");

  if (!canAck && !canResolve) return null;

  const close = () => {
    setOpen(null);
    setNote("");
    setResolution("");
    setFile(null);
    setErr(null);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await s.refresh();
      close();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {canAck && (
          <Button variant="outline" disabled={held} onClick={() => setOpen("ack")}>
            I have this
          </Button>
        )}
        {canResolve && (
          <Button disabled={held} onClick={() => setOpen("resolve")}>
            Answer it
          </Button>
        )}
        {held && (
          <span className="text-[12.5px] text-[#B54708]">
            On hold{ticket.holdReason ? ` — ${ticket.holdReason}` : ""}. Take it off hold to work on
            it.
          </span>
        )}
      </div>

      {open === "ack" && (
        <Modal open title="Let them know you have it" onClose={close}>
          <p className="text-[13px] text-grey-2">
            {s.personName(ticket.raisedBy)} will be told you have picked this up. The turnaround
            does not change — it runs from when the ticket was raised.
          </p>
          <div className="mt-3">
            <FieldLabel label="Anything to say now?" hint="Optional.">
              <TextArea
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Checking with payroll, will come back today"
              />
            </FieldLabel>
          </div>
          {err && <ErrLine msg={err} />}
          <div className="mt-4 flex items-center gap-3">
            <Button
              disabled={busy}
              onClick={() => void run(() => acknowledgeTicket(ticket.id, note.trim() || null))}
            >
              {busy ? "Saving…" : "Yes, I have it"}
            </Button>
            <CancelLink onClick={close} />
          </div>
        </Modal>
      )}

      {open === "resolve" && (
        <Modal open title="Answer this ticket" onClose={close}>
          <p className="text-[13px] text-grey-2">
            {s.personName(ticket.raisedBy)} will be asked to confirm they are happy with this, or to
            reopen it. Write it for them, not for the file.
          </p>
          <div className="mt-3">
            {/* Mandatory, and the server refuses a blank one — see the ⚠ on
                resolveTicket. There is deliberately no way to skip it. */}
            <FieldLabel label="What did you do?" required>
              <TextArea
                rows={5}
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                placeholder="e.g. The August payslip was held back by a payroll re-run. It has been re-sent to your work email this morning."
              />
            </FieldLabel>
          </div>
          <div className="mt-3">
            <FieldLabel label="Attach the proof" hint="Optional — the corrected payslip, the approval, the letter.">
              <FileCapture value={file} onChange={setFile} />
            </FieldLabel>
          </div>
          {err && <ErrLine msg={err} />}
          <div className="mt-4 flex items-center gap-3">
            <Button
              disabled={busy || resolution.trim().length === 0}
              onClick={() => void run(() => resolveTicketWithFile(ticket.id, resolution.trim(), file))}
            >
              {busy ? "Sending…" : "Send the answer"}
            </Button>
            <CancelLink onClick={close} />
          </div>
        </Modal>
      )}
    </>
  );
}

function ErrLine({ msg }: { msg: string }) {
  return (
    <p className="mt-3 rounded-lg border border-[#FDA29B] bg-[#FEF3F2] px-3 py-2 text-[13px] text-[#B42318]">
      {msg}
    </p>
  );
}

function CancelLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="text-[13px] font-semibold text-grey-2 hover:text-navy"
      onClick={onClick}
    >
      Cancel
    </button>
  );
}
