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
  confirmTicket,
  recategoriseTicket,
  reassignTicket,
  reopenTicket,
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
export default function TicketActions({
  ticket,
  compact = false,
}: {
  ticket: Ticket;
  /**
   * ⚠ THE QUEUE SHOWS ONLY THE STEP ACTIONS, NOT THE REPAIRS.
   *
   *   Found by looking at a screenshot: four buttons in a narrow ACTIONS column
   *   wrap onto four lines and blow the row height out, so one ticket filled the
   *   screen. "Hand it on" and "Wrong category" are the rarer of the four and
   *   they are BOTH still on the ticket page — nothing is lost, which is the
   *   only condition under which a control may be dropped from a screen.
   */
  compact?: boolean;
}) {
  const s = useHelpStore();
  const [open, setOpen] = useState<null | "ack" | "resolve" | "ask" | "answer" | "confirm" | "reopen" | "hand" | "refile">(null);
  const [note, setNote] = useState("");
  const [resolution, setResolution] = useState("");
  const [askWho, setAskWho] = useState("");
  const [reply, setReply] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [handTo, setHandTo] = useState("");
  const [newCat, setNewCat] = useState("");
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
  // The employee's two. Both are the RAISER's alone — the desk says "resolved",
  // the employee says "satisfied", and one person supplying both is how a CSAT
  // score stops meaning anything.
  const canClose = s.canActOn("confirm", ticket) && ticket.currentStep === "confirm";
  // Repairing a ticket is the desk's business, and it stays possible for as long
  // as the ticket is open — including while it sits at `confirm`, because "the
  // wrong person answered it" is usually only discovered then.
  const canRepair =
    s.canActOn("resolve", ticket) ||
    (s.isDeskStaff && ticket.status !== "closed" && ticket.status !== "cancelled" && s.canActOn("acknowledge", ticket));

  const cat = s.categoryById(ticket.categoryId);
  const peopleOptions = useMemo(
    () =>
      s.orgPeople
        .filter((p) => p.id !== s.userId)
        .map((p) => ({ value: p.id, label: p.name, sublabel: p.designation ?? undefined })),
    [s.orgPeople, s.userId],
  );

  const handOptions = useMemo(
    () =>
      s.orgPeople
        .filter((p) => p.id !== ticket.assigneeId && s.canReceive(p.id))
        .map((p) => ({ value: p.id, label: p.name, sublabel: p.designation ?? undefined })),
    [s, ticket.assigneeId],
  );

  // \u26a0 CONFIDENTIAL CATEGORIES ARE NOT OFFERED. The server refuses a move into
  //   one, so listing them would be a menu of guaranteed errors.
  const refileOptions = useMemo(
    () =>
      s.raisableCategories
        .filter((c) => c.id !== ticket.categoryId && !c.confidential)
        .map((c) => ({ value: c.id, label: c.name, sublabel: tatWords(c) })),
    [s.raisableCategories, ticket.categoryId],
  );

  if (!canAck && !canResolve && !canAnswer && !canClose && !canRepair) return null;

  const close = () => {
    setOpen(null);
    setNote("");
    setResolution("");
    setAskWho("");
    setReply("");
    setRating(null);
    setHandTo("");
    setNewCat("");
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
      <div className={compact ? "flex items-center gap-1.5" : "flex flex-wrap items-center gap-2"}>
        {canAck && (
          <Button size={compact ? "sm" : "md"} variant="outline" disabled={held} onClick={() => setOpen("ack")}>
            I have this
          </Button>
        )}
        {canAsk && (
          <Button size={compact ? "sm" : "md"} variant="outline" disabled={held} onClick={() => setOpen("ask")}>
            Ask for something
          </Button>
        )}
        {canResolve && (
          <Button size={compact ? "sm" : "md"} disabled={held} onClick={() => setOpen("resolve")}>
            Answer it
          </Button>
        )}
        {canAnswer && (
          <Button size={compact ? "sm" : "md"} disabled={held} onClick={() => setOpen("answer")}>
            Reply to HR
          </Button>
        )}
        {canClose && (
          <>
            <Button size={compact ? "sm" : "md"} disabled={held} onClick={() => setOpen("confirm")}>
              That sorted it
            </Button>
            <Button size={compact ? "sm" : "md"} variant="outline" disabled={held} onClick={() => setOpen("reopen")}>
              It is still not right
            </Button>
          </>
        )}
        {canRepair && !compact && (
          <>
            <Button variant="outline" disabled={held} onClick={() => setOpen("hand")}>
              Hand it on
            </Button>
            {/* ⚠ Not offered on a confidential ticket: the server refuses the move
                in both directions, and a button that always errors is worse than
                no button. */}
            {!cat?.confidential && (
              <Button variant="outline" disabled={held} onClick={() => setOpen("refile")}>
                Wrong category
              </Button>
            )}
          </>
        )}
        {held && !compact && (
          <span className="text-[12.5px] text-[#B54708]">
            On hold{ticket.holdReason ? `: ${ticket.holdReason}` : ""}. Take it off hold to work on
            it.
          </span>
        )}
        {held && compact && (
          <span className="text-[12px] font-semibold text-[#B54708]">On hold</span>
        )}
      </div>

      {open === "ack" && (
        <Modal open title="Let them know you have it" onClose={close}>
          <p className="text-[13px] text-grey-2">
            {s.personName(ticket.raisedBy)} will be told you have picked this up. The turnaround
            does not change. It runs from when the ticket was raised.
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
            <FieldLabel label="Attach the proof" hint="Optional. The corrected payslip, the approval, the letter.">
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
            <FieldLabel label="Attach something" hint="Optional. Whatever they asked for.">
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
      {open === "confirm" && (
        <Modal open title="Close this ticket" onClose={close}>
          <p className="text-[13px] text-grey-2">
            {s.personName(ticket.resolvedBy)} answered this. Closing it tells them it worked.
          </p>

          <div className="mt-4">
            <FieldLabel label="How was it handled?" hint="Optional, and only you and HR see it.">
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating(rating === n ? null : n)}
                    className={
                      "rounded-lg border px-3 py-1.5 text-[13px] font-semibold " +
                      (rating === n
                        ? "border-orange bg-[#FFF6ED] text-orange"
                        : "border-line text-grey-2 hover:border-orange hover:text-orange")
                    }
                  >
                    {RATING_LABEL[n]}
                  </button>
                ))}
              </div>
            </FieldLabel>
          </div>

          <div className="mt-3">
            <FieldLabel label="Anything to add?" hint="Optional.">
              <TextArea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} />
            </FieldLabel>
          </div>
          {err && <ErrLine msg={err} />}
          <div className="mt-4 flex items-center gap-3">
            <Button
              disabled={busy}
              onClick={() => void run(() => confirmTicket(ticket.id, rating, reply.trim() || null))}
            >
              {busy ? "Closing\u2026" : "Close it"}
            </Button>
            <CancelLink onClick={close} />
          </div>
        </Modal>
      )}

      {open === "reopen" && (
        <Modal open title="Send it back" onClose={close}>
          <p className="text-[13px] text-grey-2">
            This goes back to {s.personName(ticket.resolvedBy)}.
          </p>

          {/* \u26a0 THE LADDER IS SAID OUT LOUD BEFORE THE CLICK. Reopening is not a
              neutral act \u2014 it brings somebody else in, and the employee should
              know who and why rather than discovering it from a notification. */}
          <p className="mt-2 rounded-lg border border-[#FEDF89] bg-[#FFFAEB] px-3 py-2 text-[13px] text-[#B54708]">
            {ticket.reopenCount === 0
              ? escalationLine(cat?.escalationL1Label, cat?.escalationL1Ids?.length, s, cat?.escalationL1Ids)
              : escalationLine(cat?.escalationL2Label, cat?.escalationL2Ids?.length, s, cat?.escalationL2Ids)}
          </p>

          <div className="mt-3">
            <FieldLabel label="What is still wrong?" required>
              <TextArea
                rows={4}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="Be specific \u2014 it is going back to the same person."
              />
            </FieldLabel>
          </div>
          {err && <ErrLine msg={err} />}
          <div className="mt-4 flex items-center gap-3">
            <Button
              disabled={busy || reply.trim().length === 0}
              onClick={() => void run(() => reopenTicket(ticket.id, reply.trim()))}
            >
              {busy ? "Sending\u2026" : "Send it back"}
            </Button>
            <CancelLink onClick={close} />
          </div>
        </Modal>
      )}
      {open === "hand" && (
        <Modal open title="Hand this ticket on" onClose={close}>
          <p className="text-[13px] text-grey-2">
            The turnaround and the escalation do not change. Only who holds it does. If the CATEGORY is
            wrong, use &ldquo;Wrong category&rdquo; instead: that moves the deadline too.
          </p>
          <div className="mt-3">
            <FieldLabel
              label="Who takes it?"
              required
              hint="Only people set up to receive tickets: the reassign pool, or somebody who owns a category."
            >
              <Combobox
                options={handOptions}
                value={handTo}
                onChange={setHandTo}
                autoAdvance
                searchable
                placeholder="Search the desk"
              />
            </FieldLabel>
          </div>

          {cat?.confidential && handTo && (
            <p className="mt-3 rounded-lg border border-[#FECDCA] bg-[#FEF3F2] px-3 py-2 text-[13px] text-[#B42318]">
              This is a confidential ticket. {s.personName(handTo)} will be able to read all of it,
              and the history will record that you handed it to them.
            </p>
          )}

          <div className="mt-3">
            <FieldLabel label="Why?" hint="Optional, but it saves the next person asking.">
              <TextArea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} />
            </FieldLabel>
          </div>
          {err && <ErrLine msg={err} />}
          <div className="mt-4 flex items-center gap-3">
            <Button
              disabled={busy || !handTo}
              onClick={() => void run(() => reassignTicket(ticket.id, handTo, reply.trim() || null))}
            >
              {busy ? "Handing over…" : "Hand it on"}
            </Button>
            <CancelLink onClick={close} />
          </div>
        </Modal>
      )}

      {open === "refile" && (
        <Modal open title="File it under the right thing" onClose={close}>
          <p className="text-[13px] text-grey-2">
            The category decides who answers it and how long they have, so re-filing changes both.
          </p>
          <div className="mt-3">
            <FieldLabel label="What should it be?" required>
              <Combobox
                options={refileOptions}
                value={newCat}
                onChange={setNewCat}
                autoAdvance
                searchable
                placeholder="Search the categories"
              />
            </FieldLabel>
          </div>

          {/* ⚠ THE DEADLINE MOVES, AND THE READER SEES IT BEFORE THE CLICK. A
              3-day query re-filed as a 1-day one can be overdue the instant it
              moves, and discovering that from a red cell afterwards is how the
              feature gets blamed for the lateness. */}
          {newCat && (
            <p className="mt-3 rounded-lg border border-line bg-[#FAFAFB] px-3 py-2 text-[13px] text-grey-2">
              Turnaround goes from <b className="text-navy">{tatWords(cat)}</b> to{" "}
              <b className="text-navy">{tatWords(s.categoryById(newCat))}</b>, counted from when the
              ticket was raised. It becomes <b className="text-navy">{ownerWords(s, newCat)}</b>
              &rsquo;s.
            </p>
          )}

          <div className="mt-3">
            <FieldLabel label="Why?" hint="Optional.">
              <TextArea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} />
            </FieldLabel>
          </div>
          {err && <ErrLine msg={err} />}
          <div className="mt-4 flex items-center gap-3">
            <Button
              disabled={busy || !newCat}
              onClick={() =>
                void run(() => recategoriseTicket(ticket.id, newCat, reply.trim() || null))
              }
            >
              {busy ? "Re-filing…" : "Re-file it"}
            </Button>
            <CancelLink onClick={close} />
          </div>
        </Modal>
      )}
    </>
  );
}

/** A category's turnaround in the reader's words, never an invented number. */
function tatWords(c: { tatDays: number | null; tatText: string | null } | undefined): string {
  if (!c) return "—";
  if (c.tatDays === null) return c.tatText ?? "no fixed turnaround";
  if (c.tatDays === 0) return c.tatText ?? "the same working day";
  return `${c.tatDays} working day${c.tatDays === 1 ? "" : "s"}`;
}

/** Who a re-filed ticket becomes, said plainly when the answer is "nobody". */
function ownerWords(s: ReturnType<typeof useHelpStore>, categoryId: string): string {
  const names = (s.categoryById(categoryId)?.ownerIds ?? [])
    .map((i) => s.personName(i))
    .filter((n) => n !== "—");
  return names.length ? names.join(", ") : "nobody, because that category has no owner set";
}

/** Said in words, not numbers \u2014 "3 out of 5" is a grade, not an opinion. */
const RATING_LABEL: Record<number, string> = {
  1: "Badly",
  2: "Not well",
  3: "All right",
  4: "Well",
  5: "Very well",
};

/**
 * Who a reopen will actually reach, said honestly.
 *
 * \u26a0 IT MUST NOT PROMISE A PERSON WHO IS NOT THERE. On 28-09-2026 every
 *   Level 2 on all 30 categories is a LABEL with no portal account behind it \u2014
 *   "Management", "Finance Head", "ICC Committee" \u2014 because not one of them is
 *   a user in this hub. Printing "this will be escalated to Management" would be
 *   a promise the system cannot keep, so when nobody is named the line says the
 *   HR Head will be told instead.
 */
function escalationLine(
  label: string | null | undefined,
  count: number | undefined,
  s: ReturnType<typeof useHelpStore>,
  ids: string[] | undefined,
): string {
  if (count && ids?.length) {
    return `This will also be raised with ${ids.map((i) => s.personName(i)).join(", ")}.`;
  }
  if (label) {
    return `This is meant to go to ${label}, but nobody has been named for that yet \u2014 so HR will be told instead.`;
  }
  return "This will go back to HR.";
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
