import { useState } from "react";
import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { appName, appBasePath } from "@/apps/appInfo";
import { useHelpStore } from "../store";
import { clearHandoff, recordHandoff } from "../data/helpWrites";
import type { Ticket } from "../types";

/**
 * Decision D1, on the ticket page: Help Desk is the front door, but the WORK
 * belongs to another module.
 *
 * Eleven of the thirty categories point somewhere else \u2014 four at Travel Desk,
 * four at New Recruitment, and one each at General Purchase, Learning &
 * Development and Employee Exit. The owner starts it there and records the
 * reference here.
 *
 * \u26a0 THE LINK OPENS IN A NEW TAB, ON PURPOSE. Navigating away mid-ticket
 *   would lose whatever the owner had half-written in the thread, and they have
 *   to come back here anyway to record the reference.
 *
 * \u26a0 THERE IS NO AUTOMATIC ROUND TRIP, and the panel says so rather than
 *   implying one. Having Travel Desk stamp this ticket when the trip is saved
 *   would mean teaching five other modules about Help Desk. See the header of
 *   the HD-8 migration.
 *
 * \u26a0 THE TICKET DOES NOT WAIT FOR THAT WORK TO FINISH. It closes when the
 *   employee confirms, like any other. A ticket held open until a six-week
 *   recruitment closed would wreck the ageing report; the ASK is what Help Desk
 *   tracks.
 */
export default function HandoffPanel({ ticket }: { ticket: Ticket }) {
  const s = useHelpStore();
  const cat = s.categoryById(ticket.categoryId);
  const [open, setOpen] = useState<null | "record" | "clear">(null);
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const target = cat?.handoffAppId;
  if (!target) return null;

  const canRecord = s.canActOn("resolve", ticket) || s.canActOn("acknowledge", ticket);
  const close = () => {
    setOpen(null);
    setRef("");
    setNote("");
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
    <div className="mt-4 rounded-xl border border-line bg-[#FAFAFB] p-4">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-grey-2">
        Handled in {appName(target)}
      </p>

      {ticket.handoffRef ? (
        <p className="mt-1 text-[13.5px] text-navy">
          Started as{" "}
          <Link
            to={appBasePath(target)}
            target="_blank"
            rel="noopener"
            className="font-semibold text-orange hover:underline"
          >
            {ticket.handoffRef}
          </Link>
          .
        </p>
      ) : (
        <p className="mt-1 text-[13.5px] text-grey-2">
          {canRecord
            ? "Start it there, then record the reference here so the employee can follow it."
            : "HR will start this in " + appName(target) + " and the reference will appear here."}
        </p>
      )}

      {canRecord && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Link to={appBasePath(target)} target="_blank" rel="noopener">
            <Button variant="outline">Open {appName(target)}</Button>
          </Link>
          {ticket.handoffRef ? (
            <Button variant="outline" onClick={() => setOpen("clear")}>
              Wrong reference
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setOpen("record")}>
              Record the reference
            </Button>
          )}
        </div>
      )}

      {open === "record" && (
        <Modal open title={"Record the " + appName(target) + " reference"} onClose={close}>
          <p className="text-[13px] text-grey-2">
            {/* \u26a0 Verified, not trusted \u2014 the server looks it up and refuses
                what it cannot find. Saying so here stops the owner reading a
                rejection as a system fault. */}
            It is checked against {appName(target)}, so it has to be one that really exists.
          </p>
          <div className="mt-3">
            <FieldLabel label="Reference" required hint="Capitals and spaces do not matter.">
              <TextInput
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                placeholder="e.g. TRV-2627-0007"
              />
            </FieldLabel>
          </div>
          <div className="mt-3">
            <FieldLabel label="Anything to add?" hint="Optional.">
              <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </FieldLabel>
          </div>
          {err && <Err msg={err} />}
          <div className="mt-4 flex items-center gap-3">
            <Button
              disabled={busy || ref.trim().length === 0}
              onClick={() => void run(() => recordHandoff(ticket.id, ref.trim(), note.trim() || null))}
            >
              {busy ? "Checking\u2026" : "Record it"}
            </Button>
            <Cancel onClick={close} />
          </div>
        </Modal>
      )}

      {open === "clear" && (
        <Modal open title="Remove this reference" onClose={close}>
          <p className="text-[13px] text-grey-2">
            {ticket.handoffRef} will stop being shown on this ticket. The history keeps the record
            that it was set.
          </p>
          <div className="mt-3">
            <FieldLabel label="Why?" hint="Optional.">
              <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </FieldLabel>
          </div>
          {err && <Err msg={err} />}
          <div className="mt-4 flex items-center gap-3">
            <Button disabled={busy} onClick={() => void run(() => clearHandoff(ticket.id, note.trim() || null))}>
              {busy ? "Removing\u2026" : "Remove it"}
            </Button>
            <Cancel onClick={close} />
          </div>
        </Modal>
      )}
    </div>
  );
}

function Err({ msg }: { msg: string }) {
  return (
    <p className="mt-3 rounded-lg border border-[#FDA29B] bg-[#FEF3F2] px-3 py-2 text-[13px] text-[#B42318]">
      {msg}
    </p>
  );
}

function Cancel({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="text-[13px] font-semibold text-grey-2 hover:text-navy" onClick={onClick}>
      Cancel
    </button>
  );
}
