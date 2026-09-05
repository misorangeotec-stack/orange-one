import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import { FieldRow, SectionHeading } from "@/shared/components/ui/Readout";
import { TextInput } from "@/shared/components/ui/Form";
import { formatDateDMY } from "@/shared/lib/date";
import { useHrStore } from "../../store";
import { STAGE_LABEL } from "../../lib/board";
import { reconsiderTargetStage } from "../../lib/queues";
import { describeSignals, matchedRequisitionIds } from "../../lib/duplicates";
import { inr } from "../../lib/format";
import type { Candidate } from "../../types";

/**
 * The facts, in the order you'd ask for them, plus the two things only a person can
 * add: a private note and a tag.
 *
 * Both save through their OWN one-column RPCs rather than the general candidate edit.
 * That edit needs the resume-upload permission (HR) and rewrites every column from
 * the form, so routing a note through it would (a) lock out the HOD and interviewers
 * the note is FOR, and (b) let a stale browser copy silently overwrite a name or
 * phone number that somebody else had corrected in the meantime.
 */
export default function CandidateDetailsCard({
  candidate: c,
  onOpenOnboarding,
}: {
  candidate: Candidate;
  /** The joining details live on the onboarding; this is the way through to them. */
  onOpenOnboarding?: () => void;
}) {
  const s = useHrStore();
  const r = s.requisitionById(c.requisitionId);

  const offered = c.stage === "finalized" || c.stage === "hired";
  const onb = offered ? s.onboardingForCandidate(c.id) : undefined;
  const checks = onb ? s.checksFor(onb.id) : [];
  const ticked = checks.filter((k) => k.done).length;
  const dupes = s.duplicatesOf(
    {
      name: c.name,
      phone: c.phone,
      email: c.email,
      resumeName: c.resumeName,
      sha256: c.resumeSha256,
      excludeId: c.id,
    },
    c.requisitionId,
  );
  // Split them: another vacancy is context, THIS vacancy is a duplicate row that
  // should not exist. Before FIX-5 both rendered as the same bland "also applied".
  const alsoApplied = dupes.filter((d) => !d.sameRequisition);
  const sameVacancy = dupes.filter((d) => d.sameRequisition);
  const platform = s.jobPlatforms.find((p) => p.id === c.sourcePlatformId)?.name ?? null;

  /* ------------------------------- quick note ------------------------------- */
  const [note, setNote] = useState(c.notes ?? "");
  const [noteErr, setNoteErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Someone else may have edited it while this page was open; re-sync when the store
  // refreshes, but never while the box is being typed in.
  useEffect(() => setNote(c.notes ?? ""), [c.notes]);

  const saveNote = async () => {
    const next = note.trim();
    if (next === (c.notes ?? "")) return; // nothing changed — do not write
    setSaving(true);
    setNoteErr(null);
    try {
      await s.setCandidateNote(c.id, next);
    } catch (e) {
      setNoteErr(e instanceof Error ? e.message : "Could not save the note");
      setNote(c.notes ?? "");
    } finally {
      setSaving(false);
    }
  };

  /* ---------------------------------- tags ---------------------------------- */
  const [draft, setDraft] = useState("");
  const [tagErr, setTagErr] = useState<string | null>(null);

  // Tags are a WRITE, and this was the one place in the module that asked nothing
  // at all before performing one — not even ownership. The ceiling belongs at the
  // write itself, so both the chip "×" and the Enter-to-add path are covered.
  const writeTags = async (next: string[]) => {
    if (!s.canEdit) return;
    setTagErr(null);
    try {
      await s.setCandidateTags(c.id, next);
    } catch (e) {
      setTagErr(e instanceof Error ? e.message : "Could not save the tags");
    }
  };

  const addTag = () => {
    const t = draft.trim();
    if (!t) return;
    // The RPC de-duplicates too; this stops the pointless round trip.
    if (c.tags.some((x) => x.toLowerCase() === t.toLowerCase())) {
      setDraft("");
      return;
    }
    setDraft("");
    void writeTags([...c.tags, t]);
  };

  return (
    <div className="space-y-5">
      <div>
        <SectionHeading>Details</SectionHeading>
        <div className="mt-2 space-y-1.5">
          <FieldRow labelClassName="w-[92px]" label="Stage" value={STAGE_LABEL[c.stage]} />
          <FieldRow labelClassName="w-[92px]" label="Position" value={r?.jobTitle ?? "—"} />
          <FieldRow labelClassName="w-[92px]"
            label="Vacancy"
            value={
              r ? (
                <Link
                  to={`/hr-recruitment/requisitions/${r.id}`}
                  className="font-semibold text-orange hover:underline"
                >
                  {r.mrfNo}
                </Link>
              ) : (
                "—"
              )
            }
          />
          <FieldRow labelClassName="w-[92px]" label="Phone" value={c.phone ?? "—"} />
          <FieldRow labelClassName="w-[92px]" label="Email" value={c.email ?? "—"} />
          <FieldRow labelClassName="w-[92px]" label="Current company" value={c.currentCompany ?? "—"} />
          <FieldRow labelClassName="w-[92px]"
            label="Experience"
            value={c.experienceYears !== null ? `${c.experienceYears} yrs` : "—"}
          />
          {platform && <FieldRow labelClassName="w-[92px]" label="Source" value={platform} />}
        </div>

        {c.skills.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {c.skills.map((sk) => (
              <span key={sk} className="rounded-full bg-page px-2 py-0.5 text-[11.5px] font-medium text-navy">
                {sk}
              </span>
            ))}
          </div>
        )}

        {alsoApplied.length > 0 && (
          <p className="mt-2.5 rounded-xl border border-line bg-page px-3 py-2 text-[12px] text-grey-2">
            Also applied to{" "}
            {matchedRequisitionIds(alsoApplied)
              .map((id) => s.requisitionById(id)?.mrfNo ?? "another vacancy")
              .join(", ")}
            .
          </p>
        )}

        {/* Same vacancy, twice. This is the FIX-5 defect showing itself on the page —
            seven such rows were live when it was found, and nothing anywhere said so. */}
        {sameVacancy.length > 0 && (
          <div className="mt-2.5 rounded-xl border border-ryg-red/40 bg-[#FDECEC] px-3 py-2.5">
            <p className="text-[12.5px] font-semibold text-navy">
              {sameVacancy.length === 1
                ? "Another record on this same vacancy looks like the same person"
                : `${sameVacancy.length} other records on this same vacancy look like the same person`}
            </p>
            <ul className="mt-1.5 space-y-1">
              {sameVacancy.map((d) => (
                <li key={d.candidate.id} className="text-[12px] text-navy">
                  <Link
                    to={`/hr-recruitment/candidates/${d.candidate.id}`}
                    className="font-semibold text-orange hover:underline"
                  >
                    {d.candidate.candidateNo}
                  </Link>{" "}
                  — {STAGE_LABEL[d.candidate.stage]} · matched on{" "}
                  {describeSignals(d.signals)}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[11.5px] text-grey">
              Every pipeline count treats these as separate people. Ask HR which one is the real
              record.
            </p>
          </div>
        )}
      </div>

      {/*
        Dropped — and the way back.

        This is FIX-5's actual remedy. Twice in three weeks HR wanted to look at a
        rejected candidate again, and the only route they could see was to upload the
        CV a second time — which started the person over at stage one, lost their
        history, and left the vacancy counting one person as two. The capability to
        reopen a card already existed on the board; nobody could find it from here.
      */}
      {c.stage === "disqualified" && <ReconsiderSection candidate={c} />}

      {/* The offer and its onboarding — the same fact the board shows, with the way through. */}
      {offered && (
        <div>
          <SectionHeading>Offer</SectionHeading>
          <div className="mt-2 space-y-1.5">
            {s.canViewSalary && (
              <FieldRow labelClassName="w-[92px]"
                label="Agreed salary"
                value={c.offeredCtc !== null ? `${inr(c.offeredCtc)}/month` : "—"}
              />
            )}
            <FieldRow labelClassName="w-[92px]"
              label="Joining date"
              value={onb?.joiningDate ? formatDateDMY(onb.joiningDate) : "not set"}
            />
          </div>
          {onb && (
            <div className="mt-2 rounded-xl border border-line bg-page/40 px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12.5px] font-semibold text-navy">Onboarding</span>
                <span className="text-[11.5px] text-grey-2">
                  {onb.completedAt
                    ? `Completed ${formatDateDMY(onb.completedAt)}`
                    : checks.length > 0
                      ? `${ticked} of ${checks.length} done`
                      : "Not started"}
                </span>
              </div>
              {checks.length > 0 && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${Math.round((ticked / checks.length) * 100)}%`,
                      background: onb.completedAt ? "#27AE60" : "#FF6A1F",
                    }}
                  />
                </div>
              )}
              {onOpenOnboarding && (
                <button
                  type="button"
                  onClick={onOpenOnboarding}
                  className="mt-2 text-[12px] font-semibold text-orange hover:underline"
                >
                  Open the onboarding →
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div>
        <SectionHeading>Quick note</SectionHeading>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={saveNote}
          rows={3}
          placeholder="Anything worth remembering about them…"
          className="mt-2 w-full resize-y rounded-lg border border-line bg-white px-3 py-2 text-[13px] text-navy placeholder:text-grey-2 focus:border-orange focus:outline-none"
        />
        {saving && <p className="mt-1 text-[11.5px] text-grey-2">Saving…</p>}
        {noteErr && <p className="mt-1 text-[11.5px] text-ryg-red">{noteErr}</p>}
      </div>

      <div>
        <SectionHeading>Tags</SectionHeading>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {c.tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full bg-orange/[0.08] px-2 py-0.5 text-[11.5px] font-medium text-orange"
            >
              {t}
              <button
                type="button"
                aria-label={`Remove ${t}`}
                onClick={() => void writeTags(c.tags.filter((x) => x !== t))}
                className="text-orange/70 hover:text-orange"
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag();
            }
          }}
          onBlur={addTag}
          placeholder="Add a tag, then Enter"
          className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-1.5 text-[12.5px] text-navy placeholder:text-grey-2 focus:border-orange focus:outline-none"
        />
        {tagErr && <p className="mt-1 text-[11.5px] text-ryg-red">{tagErr}</p>}
      </div>
    </div>
  );
}

/**
 * Bring a dropped candidate back into play.
 *
 * ⚠ This calls `fms_hr_reconsider_candidate`, NOT `moveCandidate`. Dragging a card
 * back out of Disqualified also works and is what a person would reach for — but
 * that path's backward branch runs `delete from fms_hr_interviews where round > …`,
 * so reopening someone who was dropped at Round 3 would destroy all three of their
 * interview records on the way. The dedicated RPC deletes nothing, and writes the
 * original rejection reason into the activity trail before clearing it.
 */
function ReconsiderSection({ candidate: c }: { candidate: Candidate }) {
  const s = useHrStore();
  const r = s.requisitionById(c.requisitionId);
  const reason =
    c.disqualificationNote ??
    s.disqualificationReasons.find((x) => x.id === c.disqualificationReasonId)?.name ??
    null;

  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // The RPC enforces all of this too — this only decides whether to offer the
  // button, so nobody is shown a control that will refuse them.
  const offered = !!s.onboardingForCandidate(c.id);
  const sourcing = r?.status === "sourcing";
  const allowed = s.canReconsiderCandidate(c) && sourcing && !offered;

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      await s.reconsiderCandidate(c.id, note.trim() || null);
      setOpen(false);
      setNote("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <SectionHeading>Dropped</SectionHeading>
      <div className="mt-2 space-y-1.5">
        <FieldRow labelClassName="w-[92px]" label="Dropped on" value={formatDateDMY(c.disqualifiedAt)} />
        <FieldRow labelClassName="w-[92px]" label="Reason" value={reason ?? "—"} />
      </div>

      {allowed && !open && (
        <div className="mt-2.5">
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Reconsider this person
          </Button>
          <p className="mt-1.5 text-[11.5px] text-grey">
            Puts them back where they had reached, keeping every interview and note. Use this
            instead of uploading their CV again — a second upload counts them twice.
          </p>
        </div>
      )}

      {allowed && open && (
        <div className="mt-2.5 rounded-xl border border-line bg-page px-3 py-3">
          <TextInput
            value={note}
            placeholder="Why are they being reconsidered? (optional)"
            onChange={(e) => setNote(e.target.value)}
          />
          <p className="mt-1.5 text-[11.5px] text-grey">
            The original reason — {reason ? `“${reason}”` : "none recorded"} — is kept in their
            timeline.
          </p>
          {err && <p className="mt-1.5 text-[11.5px] text-ryg-red">{err}</p>}
          <div className="mt-2.5 flex gap-2">
            <Button size="sm" onClick={run} disabled={busy}>
              {busy ? "Bringing them back…" : "Bring back into play"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Go back
            </Button>
          </div>
        </div>
      )}

      {!allowed && (
        <p className="mt-2 text-[11.5px] text-grey-2">
          {offered
            ? "An offer was already made to this person — re-offer them from the board rather than reconsidering."
            : !sourcing
              ? `This vacancy is ${r?.status ?? "not sourcing"}, so nobody can be brought back into play on it.`
              : `Bringing them back puts them at ${STAGE_LABEL[reconsiderTargetStage(c, s.interviewsFor(c.id))]}, and that stage is not yours to decide — ask whoever owns it.`}
        </p>
      )}
    </div>
  );
}
