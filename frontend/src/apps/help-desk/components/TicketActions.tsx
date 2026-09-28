import { useMemo, useState } from "react";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import Combobox from "@/shared/components/ui/Combobox";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import FileCapture from "@/shared/components/ui/FileCapture";
import { useHelpStore } from "../store";
import {
  acknowledgeTicket,
  answerInfo,
  requestInfo,
  resolveTicketWithFile,
  uploadThreadFile,
} from "../data/helpWrites";
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
  const [open, setOpen] = useState<null | "ack" | "resolve" | "ask" | "answer">(null);
  const [note, setNote] = useState("");
  const [resolution, setResolution] = useState("");
  const [askWho, setAskWho] = useState("");
  const [reply, setReply] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const held = ticket.status === "on_hold";
  const canAck = s.canActOn("acknowledge", ticket) && !ticket.acknowledgedAt;
  const onDesk = ticket.currentStep === "acknowledge" || ticket.currentStep === "resolve";
  const canResolve = s.canActOn("resolve", ticket) && onDesk;
  // Asking for more is the same right as resolving — it is the desk deciding it
  // cannot answer yet — so it is offered wherever Resolve is.
  const canAsk = canResolve;
  const canAnswer = s.canActOn("awaiting_info", ticket) && ticket.currentStep === "awaiting_info";

  const cat = s.categoryById(ticket.categoryId);
  const peopleOptions = useMemo(
    () =>
      s.orgPeople
        .filter((p) => p.id !== s.userId)
        .map((p) => ({ value: p.id, label: p.name, sublabel: p.designation ?? undefined })),
    [s.orgPeople, s.userId],
  );

  if (!canAck && !canResolve && !canAnswer) return null;

  const close = () => {
    setOpen(null);
    setNote("");
    setResolution("");
    setAskWho("");
    setReply("");
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
        {canAsk && (
          <Button variant="outline" disabled={held} onClick={() => setOpen("ask")}>
            Ask for something
          </Button>
        )}
        {canResolve && (
          <Button disabled={held} onClick={() => setOpen("resolve")}>
            Answer it
          </Button>
        )}
        {canAnswer && (
          <Button disabled={held} onClick={() => setOpen("answer")}>
            Reply to HR
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
      {open === "ask" && (
        <Modal open title="Ask for something" onClose={close}>
          <p className="text-[13px] text-grey-2">
            {/* ⚠ THE MOVE IS THE POINT. While the ticket waits on them it stops
                counting against the desk's turnaround — otherwise the SLA report
                measures how slowly employees answer their own questions. */}
            The ticket moves to whoever you name. It stops being yours until they reply, and the
            turnaround stops running against you.
          </p>
          <div className="mt-3">
            <FieldLabel label="Who do you need it from?" required>
              <Combobox
                options={peopleOptions}
                value={askWho}
                onChange={setAskWho}
                autoAdvance
                searchable
                placeholder="Search everyone"
              />
            </FieldLabel>
          </div>

          {/* ⚠⚠ ON A CONFIDENTIAL TICKET THIS GRANTS ACCESS, and the warning has
              to appear BEFORE the click, not after. The server allows it —
              blocking it would stop an HR Head investigating — and records an
              undeletable line naming who was let in. */}
          {cat?.confidential && askWho && askWho !== ticket.raisedBy && (
            <p className="mt-3 rounded-lg border border-[#FECDCA] bg-[#FEF3F2] px-3 py-2 text-[13px] text-[#B42318]">
              This is a confidential ticket. {s.personName(askWho)} will be able to read all of it,
              including everything said so far. It will be recorded on the history that you let them
              in.
            </p>
          )}

          <div className="mt-3">
            <FieldLabel label="What do you need?" required hint={"‘More information’ is not a question anybody can answer."}>
              <TextArea
                rows={4}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="e.g. Which month is this about, and did you get the earlier payslip?"
              />
            </FieldLabel>
          </div>
          {err && <ErrLine msg={err} />}
          <div className="mt-4 flex items-center gap-3">
            <Button
              disabled={busy || !askWho || reply.trim().length === 0}
              onClick={() =>
                void run(async () => {
                  const files = file ? [await uploadThreadFile(ticket.id, file)] : [];
                  await requestInfo(ticket.id, askWho, reply.trim(), files);
                })
              }
            >
              {busy ? "Sending…" : "Send the question"}
            </Button>
            <CancelLink onClick={close} />
          </div>
        </Modal>
      )}

      {open === "answer" && (
        <Modal open title="Reply to HR" onClose={close}>
          <p className="text-[13px] text-grey-2">
            This goes back to HR and they pick the ticket up again.
          </p>
          <div className="mt-3">
            <FieldLabel label="Your answer" required>
              <TextArea
                rows={4}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="Answer what they asked."
              />
            </FieldLabel>
          </div>
          <div className="mt-3">
            <FieldLabel label="Attach something" hint="Optional — whatever they asked for.">
              <FileCapture value={file} onChange={setFile} />
            </FieldLabel>
          </div>
          {err && <ErrLine msg={err} />}
          <div className="mt-4 flex items-center gap-3">
            <Button
              disabled={busy || (reply.trim().length === 0 && !file)}
              onClick={() =>
                void run(async () => {
                  const files = file ? [await uploadThreadFile(ticket.id, file)] : [];
                  await answerInfo(ticket.id, reply.trim(), files);
                })
              }
            >
              {busy ? "Sending…" : "Send it back"}
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
