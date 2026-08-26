import { useMemo, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { interviewerPool, interviewerOptions, panelNames, withoutModuleAccess } from "../../lib/interviewers";
import { useHrStore } from "../../store";
import type { Candidate } from "../../types";

/**
 * Hand a booked round to somebody else.
 *
 * A round could be booked and never re-aimed. Once a name was on it the queue offered
 * one button — Record result — and only that person could press it, so a wrong pick, a
 * head on leave or a panel that simply changed had no way out of the system: the round
 * sat there owed by somebody who was not going to take it.
 *
 * Deliberately NOT the same dialog as booking, even though both end in an upsert on
 * (candidate, round). Booking an unbooked round and re-aiming a booked one differ in
 * what they may safely do — `fms_hr_reassign_interview` refuses a round that has
 * already been held, where `fms_hr_schedule_interview` would blank its result. Showing
 * who currently holds it is the other half: a handover you cannot see the start of is
 * just a second booking.
 */
export default function ReassignInterviewModal({
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
  const current = s.interviewRound(candidate.id, round);

  // Pre-filled with whoever holds it: most handovers ADD or SWAP one member of a panel
  // rather than replacing it wholesale, and starting from empty invites the rest of the
  // panel being dropped by accident.
  const [interviewerIds, setInterviewerIds] = useState<string[]>(current?.interviewerIds ?? []);
  const [interviewerName, setInterviewerName] = useState(current?.interviewerName ?? "");
  const [scheduledOn, setScheduledOn] = useState(current?.scheduledOn ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const roundLabel = round === 0 ? "the telephonic screen" : `Round ${round}`;
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

  const held = !!current?.heldAt;
  const currentPanel = current
    ? panelNames(current.interviewerIds, current.interviewerName, s.personNameOrNull)
    : "";

  // Unchanged is not a handover. Without this the button writes an identical row and
  // announces a change to people whose work has not moved.
  const unchanged =
    !!current &&
    interviewerIds.length === current.interviewerIds.length &&
    interviewerIds.every((id) => current.interviewerIds.includes(id)) &&
    (interviewerName.trim() || null) === (current.interviewerName ?? null) &&
    (scheduledOn || null) === (current.scheduledOn ?? null);

  const invalid = held || unchanged || (interviewerIds.length === 0 && !interviewerName.trim()) || !scheduledOn;

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await s.reassignInterview(
        candidate,
        round,
        interviewerIds,
        interviewerName.trim() || null,
        scheduledOn || null,
        reason,
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
      title={`Change who takes ${roundLabel} — ${candidate.name}`}
      subtitle="The round keeps its place in the pipeline. Only who is expected to turn up changes."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy || invalid}>
            {busy ? "Handing over…" : "Hand it over"}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {held ? (
          <p className="rounded-xl border border-yellow/40 bg-[#FFF7E6] px-4 py-3 text-[13px] text-navy">
            {roundLabel} has already been held, so it cannot be handed over — its result is recorded against
            the people who took it. Correct that on the Completed tab instead.
          </p>
        ) : (
          <p className="text-[12.5px] text-grey-2">
            Currently booked with{" "}
            <span className="font-semibold text-navy">{currentPanel || "nobody"}</span>
            {current?.scheduledOn ? ` for ${current.scheduledOn}` : ""}.
          </p>
        )}

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
          {noAccess.length > 0 && (
            <span className="mt-1.5 block text-[11.5px] leading-snug text-yellow">
              {noAccess.join(", ")} {noAccess.length === 1 ? "has" : "have"} no access to New Recruitment. The
              handover still works and they will be told, but the link in it lands on Access Denied until an
              admin grants them the module.
            </span>
          )}
          <TextInput
            className="mt-2"
            value={interviewerName}
            onChange={(e) => setInterviewerName(e.target.value)}
            placeholder="And / or type names not in the portal — an external consultant, say"
          />
        </FieldLabel>

        <FieldLabel label="Interview date" required>
          <TextInput type="date" value={scheduledOn} onChange={(e) => setScheduledOn(e.target.value)} />
          <span className="mt-1 block text-[11px] leading-snug text-grey-2">
            Keep the date if the slot stands — only the people change.
          </span>
        </FieldLabel>

        <FieldLabel label="Why the change?" hint="optional">
          <TextArea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="On leave, wrong department, panel changed…"
          />
          <span className="mt-1 block text-[11px] leading-snug text-grey-2">
            Goes to whoever is picking it up, and stays on the candidate's trail.
          </span>
        </FieldLabel>

        {unchanged && !held && (
          <p className="text-[12px] text-grey-2">Nothing has changed yet — pick a different panel or date.</p>
        )}
        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}
