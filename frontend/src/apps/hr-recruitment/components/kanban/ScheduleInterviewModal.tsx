import { useMemo, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { todayIso } from "@/shared/lib/time";
import { interviewerPool, interviewerOptions } from "../../lib/interviewers";
import { useHrStore } from "../../store";
import type { Candidate } from "../../types";

/**
 * Book a round the system moved the candidate into on its own.
 *
 * Recording "selected" on a round auto-advances the card to the next one — which is
 * right, but it arrives with no interviewer and no date. The card said "To be scheduled"
 * and offered nothing to schedule it with, so rounds 2 and 3 could never actually be
 * booked after a pass. This is that missing step.
 *
 * The people offered are the same ones the drag-a-card path offers — one rule, in
 * lib/interviewers.ts, so the two routes cannot disagree about who may take a round.
 */
export default function ScheduleInterviewModal({
  candidate,
  round,
  open,
  onClose,
}: {
  candidate: Candidate;
  round: 1 | 2 | 3;
  open: boolean;
  onClose: () => void;
}) {
  const s = useHrStore();
  const req = s.requisitionById(candidate.requisitionId);

  const [interviewerId, setInterviewerId] = useState("");
  const [interviewerName, setInterviewerName] = useState("");
  const [scheduledOn, setScheduledOn] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pool = useMemo(
    () => interviewerPool(round, s.profiles, s.departments, req),
    [round, s.profiles, s.departments, req],
  );
  const people: ComboOption[] = useMemo(() => interviewerOptions(pool.people), [pool]);

  // The date is REQUIRED. A booking with no date is a round whose due date falls back to
  // "no date" — so it quietly leaves the overdue counts and the Control Center entirely,
  // while still being someone's work. An un-dated booking is not a booking.
  const invalid = (!interviewerId && !interviewerName.trim()) || !scheduledOn;

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await s.scheduleInterview(
        candidate.id,
        round,
        interviewerId || null,
        interviewerId ? null : interviewerName.trim() || null,
        scheduledOn || null,
      );
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Book Round ${round} — ${candidate.name}`}
      subtitle="They passed the last round, so they're already through. This just books who sees them, and when."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy || invalid}>
            {busy ? "Booking…" : "Book the interview"}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <FieldLabel label={`Who is taking Round ${round}?`} required hint={pool.restricted ? pool.hint : undefined}>
          <Combobox
            value={interviewerId}
            onChange={(v) => {
              setInterviewerId(v);
              if (v) setInterviewerName("");
            }}
            options={people}
            placeholder="Pick a person"
            searchable
          />
          {!pool.restricted && (
            <span className="mt-1.5 block text-[11.5px] leading-snug text-grey">{pool.fallbackNote}</span>
          )}
          <TextInput
            className="mt-2"
            value={interviewerName}
            onChange={(e) => {
              setInterviewerName(e.target.value);
              if (e.target.value) setInterviewerId("");
            }}
            placeholder="Or type a name — an external consultant, say"
          />
        </FieldLabel>

        <FieldLabel label="Interview date" required>
          <TextInput type="date" value={scheduledOn} onChange={(e) => setScheduledOn(e.target.value)} />
        </FieldLabel>

        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}
