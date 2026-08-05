import { useMemo, useState } from "react";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { SectionHeading } from "@/shared/components/ui/Readout";
import { todayIso } from "@/shared/lib/time";
import MrfRecap from "./MrfRecap";
import RequestMasterModal from "./RequestMasterModal";
import { useHrStore } from "../store";
import type { MrfDecision, MrfStage } from "../data/hrWrites";
import type { Requisition } from "../types";

/**
 * Approve / Reject / Send back an MRF.
 *
 * Reject is terminal. Send back returns it to the requester to fix and resubmit —
 * and resubmission restarts the approval clock, so a fixed requisition doesn't
 * arrive already overdue. Both need a reason; approving doesn't.
 *
 * Opens with {@link MrfRecap} — the briefing — above the choice, because the
 * question this dialog asks ("approve this vacancy?") is unanswerable from an
 * MRF number and a job title alone. Most decisions are taken from the approvals
 * QUEUE, where finding the answer used to mean leaving the queue entirely.
 */
export function MrfDecisionModal({
  requisition,
  stage,
  open,
  onClose,
  editing = false,
}: {
  requisition: Requisition;
  stage: MrfStage;
  open: boolean;
  onClose: () => void;
  /** Correcting a decision already taken (Completed tab), not deciding a pending one. */
  editing?: boolean;
}) {
  const s = useHrStore();
  const [decision, setDecision] = useState<MrfDecision>("approve");
  // When editing an approval, start from the remark that was recorded with it.
  const [remarks, setRemarks] = useState(() =>
    editing ? ((stage === "hr" ? requisition.hrRemarks : requisition.mgmtRemarks) ?? "") : "",
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const needsReason = decision !== "approve";
  const invalid = needsReason && !remarks.trim();

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (editing) await s.updateDecideMrf(requisition.id, stage, decision, remarks.trim());
      else await s.decideMrf(requisition.id, stage, decision, remarks.trim());
      onClose();
      setRemarks("");
      setDecision("approve");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const label = stage === "hr" ? "HR Head" : "Management";

  const choices: Array<{ key: MrfDecision; label: string; hint: string }> = [
    { key: "approve", label: "Approve", hint: stage === "hr" ? "Passes it to Management" : "HR can now post the job" },
    { key: "send_back", label: "Send back", hint: "The requester fixes it and resubmits" },
    { key: "reject", label: "Reject", hint: "This vacancy will not be filled" },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      // Two columns of briefing cannot breathe in the default 448px dialog.
      size="xl"
      title={`${editing ? "Edit " : ""}${label} decision — ${requisition.mrfNo}`}
      // No subtitle: the recap below already says the job title and the seats,
      // and repeating it under the title read as the same line twice.
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy || invalid}>
            {busy ? "Saving…" : "Confirm"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <MrfRecap requisition={requisition} stage={stage} />

        <div className="space-y-3.5">
          <SectionHeading>Decision</SectionHeading>

          {/* Three across at this width. Grid children stretch, so the cards stay
              equal height even though only one hint wraps to a second line. */}
          <div className="grid gap-2 sm:grid-cols-3">
            {choices.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setDecision(c.key)}
                className={`rounded-xl border px-3.5 py-2.5 text-left transition ${
                  decision === c.key ? "border-orange bg-orange/5" : "border-line hover:border-grey-2/40"
                }`}
              >
                <div className="text-[13.5px] font-semibold text-navy">{c.label}</div>
                <div className="text-[12px] text-grey-2">{c.hint}</div>
              </button>
            ))}
          </div>

          <FieldLabel label={needsReason ? "Reason" : "Remarks"} required={needsReason} hint={needsReason ? undefined : "optional"}>
            <TextArea
              rows={3}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder={needsReason ? "The requester will see this." : "Anything worth recording."}
            />
          </FieldLabel>

          {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
        </div>
      </div>
    </Modal>
  );
}

/**
 * Post the job. At least one platform is required — the whole point of capturing
 * them is being able to say later which one actually produced the hire.
 *
 * The date posted is a business fact HR types; it is stored separately from the
 * timestamp of when this step completed, because they are genuinely different
 * things (HR often records a posting a day or two after the fact).
 *
 * "Others" is the one platform that asks a follow-up question. Ticking it reveals
 * a name box, and the name is kept against THIS posting — it does not become a
 * platform master, because a reusable platform goes through request → approval and
 * a one-off ("a WhatsApp group") should not silently become one.
 */
export function JobPostingModal({
  requisition,
  open,
  onClose,
  editing = false,
}: {
  requisition: Requisition;
  open: boolean;
  onClose: () => void;
  /** Correcting a posting already made (Completed tab), not posting a fresh one. */
  editing?: boolean;
}) {
  const s = useHrStore();
  const [platformIds, setPlatformIds] = useState<string[]>(() => s.platformIdsFor(requisition.id));
  const [otherNote, setOtherNote] = useState(() => s.otherPlatformNoteFor(requisition.id) ?? "");
  /** Platform not in the master? Raise it for review without losing this form. */
  // null = closed. "" = open, blank. A name = open, prefilled with what they typed.
  const [raisePlatform, setRaisePlatform] = useState<string | null>(null);
  const [requested, setRequested] = useState<string | null>(null);
  // Editing keeps the date HR originally typed, not today.
  const [postedOn, setPostedOn] = useState(() => (editing ? (requisition.postedOn ?? todayIso()) : todayIso()));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const options: MultiOption[] = useMemo(
    () => s.jobPlatforms.filter((p) => p.active).map((p) => ({ value: p.id, label: p.name })),
    [s.jobPlatforms],
  );

  /** The catch-all row, found by its flag — an admin may have renamed it. */
  const otherId = useMemo(() => s.jobPlatforms.find((p) => p.isOther)?.id ?? null, [s.jobPlatforms]);
  const othersPicked = otherId !== null && platformIds.includes(otherId);
  const needsOtherNote = othersPicked && otherNote.trim() === "";

  const submit = async () => {
    setBusy(true);
    setErr(null);
    // Untick Others and whatever was typed goes with it, rather than being saved
    // against a platform that is no longer on the posting.
    const note = othersPicked ? otherNote.trim() : null;
    try {
      if (editing) await s.updatePostJob(requisition.id, platformIds, postedOn, note);
      else await s.postJob(requisition.id, platformIds, postedOn, note);
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
      title={`${editing ? "Edit job posting" : "Post the job"} — ${requisition.mrfNo}`}
      subtitle={requisition.jobTitle}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy || platformIds.length === 0 || needsOtherNote}>
            {busy ? (editing ? "Saving…" : "Posting…") : editing ? "Save changes" : "Mark as posted"}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <FieldLabel label="Platforms posted on" required hint="one or more">
          <MultiSelect
            values={platformIds}
            onChange={setPlatformIds}
            options={options}
            placeholder="Select platforms"
            chips
            onCreate={(name) => setRaisePlatform(name)}
            createLabel={(q) => `Request new platform “${q}”`}
          />
          <span className="mt-1 block text-[11px] leading-snug text-grey-2">
            Recording these is what later tells you which platform actually produces hires.{" "}
            {/* The picker now offers "Request new platform" on a term that matches
                nothing; this stays for anyone who reads before they type. */}
            <button
              type="button"
              onClick={() => setRaisePlatform("")}
              className="font-semibold text-orange hover:underline"
            >
              Request a new platform
            </button>
            .
          </span>
          {requested && (
            <span className="mt-1 block text-[11px] text-teal">
              Requested platform “{requested}” — selectable once the master's owner approves it.
            </span>
          )}
        </FieldLabel>

        {othersPicked && (
          <FieldLabel label="Which other platform?" required>
            <TextInput
              value={otherNote}
              onChange={(e) => setOtherNote(e.target.value)}
              placeholder="e.g. Indeed, a WhatsApp group, a trade association board"
            />
            <span className="mt-1 block text-[11px] leading-snug text-grey-2">
              Recorded against this posting only. If you will use it again, {" "}
              <button
                type="button"
                onClick={() => setRaisePlatform(otherNote.trim())}
                className="font-semibold text-orange hover:underline"
              >
                request it as a platform
              </button>{" "}
              so it gets its own line in the effectiveness report.
            </span>
          </FieldLabel>
        )}

        <FieldLabel label="Date of job posted" required>
          <TextInput type="date" value={postedOn} onChange={(e) => setPostedOn(e.target.value)} max={todayIso()} />
        </FieldLabel>

        {platformIds.length === 0 ? (
          <p className="text-[12.5px] text-grey-2">Pick at least one platform.</p>
        ) : needsOtherNote ? (
          <p className="text-[12.5px] text-grey-2">Name the other platform you posted on.</p>
        ) : null}
        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>

      {/* Opens on top of this dialog — `stacked` keeps the posting form intact. */}
      <RequestMasterModal
        stacked
        open={raisePlatform !== null}
        onClose={() => setRaisePlatform(null)}
        masterType="job_platform"
        lockType
        prefill={raisePlatform ? { name: raisePlatform } : undefined}
        onRequested={(_id, _mt, name) => setRequested(name)}
      />
    </Modal>
  );
}

/** Put a vacancy on hold (budget freeze) or cancel it outright. Coordinator/admin only. */
export function HoldCancelModal({
  requisition,
  mode,
  open,
  onClose,
}: {
  requisition: Requisition;
  mode: "hold" | "resume" | "cancel";
  open: boolean;
  onClose: () => void;
}) {
  const s = useHrStore();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const needsReason = mode !== "resume";

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (mode === "cancel") await s.cancelRequisition(requisition.id, reason.trim());
      else await s.holdRequisition(requisition.id, mode === "hold", reason.trim());
      onClose();
      setReason("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const title =
    mode === "cancel" ? "Cancel this requisition" : mode === "hold" ? "Put on hold" : "Take off hold";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${title} — ${requisition.mrfNo}`}
      subtitle={
        mode === "cancel"
          ? "The vacancy will not be filled. Candidates already in the pipeline are kept, not deleted."
          : mode === "hold"
            ? "The vacancy pauses where it is. Nothing is lost — it resumes at the same step."
            : "The vacancy resumes at the step it was paused at."
      }
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy || (needsReason && !reason.trim())}>
            {busy ? "Saving…" : "Confirm"}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {needsReason && (
          <FieldLabel label="Reason" required>
            <TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </FieldLabel>
        )}
        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}
