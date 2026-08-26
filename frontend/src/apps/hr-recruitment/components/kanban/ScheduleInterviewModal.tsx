import { useMemo, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { todayIso } from "@/shared/lib/time";
import { interviewerPool, interviewerOptions, withoutModuleAccess } from "../../lib/interviewers";
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
  round: 0 | 1 | 2 | 3;
  open: boolean;
  onClose: () => void;
}) {
  const s = useHrStore();
  const req = s.requisitionById(candidate.requisitionId);

  const [interviewerIds, setInterviewerIds] = useState<string[]>([]);
  const [interviewerName, setInterviewerName] = useState("");
  const [scheduledOn, setScheduledOn] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const roundLabel = round === 0 ? "the telephonic screen" : `Round ${round}`;
  // `orgPeople`, not `profiles`: the directory is RLS-scoped, so a head of department
  // outside the reader's own department never reached the browser and was dropped from
  // the list without a word. See lib/interviewers.ts.
  const pool = useMemo(
    () => interviewerPool(round, s.orgPeople, s.departments, req, s.mrfOwnerIds),
    [round, s.orgPeople, s.departments, req, s.mrfOwnerIds],
  );
  const people: MultiOption[] = useMemo(
    () => interviewerOptions(pool, s.moduleUserIds),
    [pool, s.moduleUserIds],
  );
  const noAccess = useMemo(
    () => withoutModuleAccess(pool, interviewerIds, s.moduleUserIds),
    [pool, interviewerIds, s.moduleUserIds],
  );

  // The date is REQUIRED. A booking with no date is a round whose due date falls back to
  // "no date" — so it quietly leaves the overdue counts and the Control Center entirely,
  // while still being someone's work. An un-dated booking is not a booking.
  const invalid = (interviewerIds.length === 0 && !interviewerName.trim()) || !scheduledOn;

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await s.scheduleInterview(
        candidate.id,
        round,
        interviewerIds,
        interviewerName.trim() || null,
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
      title={`Book ${roundLabel} — ${candidate.name}`}
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
        <FieldLabel label={`Who is taking ${roundLabel}?`} required hint="one or more">
          <MultiSelect
            values={interviewerIds}
            onChange={setInterviewerIds}
            options={people}
            placeholder="Pick the panel"
            searchable
          />
          {pool.restricted ? (
            <span className="mt-1.5 block text-[11.5px] leading-snug text-grey-2">{pool.hint}</span>
          ) : (
            <span className="mt-1.5 block text-[11.5px] leading-snug text-grey">{pool.fallbackNote}</span>
          )}
          {/* Warn, never block: a head may genuinely be taking the interview. But they
              would be notified about work behind a door they cannot open, and finding
              that out from the recipient is worse than reading it here. */}
          {noAccess.length > 0 && (
            <span className="mt-1.5 block text-[11.5px] leading-snug text-yellow">
              {noAccess.join(", ")} {noAccess.length === 1 ? "has" : "have"} no access to New Recruitment. The
              booking still works and they will be told, but the link in it lands on Access Denied until an
              admin grants them the module.
            </span>
          )}
          {/* Additive, not exclusive: a panel is often two portal users PLUS an
              external consultant, and forcing a choice would lose one of them. */}
          <TextInput
            className="mt-2"
            value={interviewerName}
            onChange={(e) => setInterviewerName(e.target.value)}
            placeholder="And / or type names not in the portal — an external consultant, say"
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
