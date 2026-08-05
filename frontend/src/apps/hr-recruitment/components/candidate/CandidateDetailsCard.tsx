import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FieldRow, SectionHeading } from "@/shared/components/ui/Readout";
import { formatDateDMY } from "@/shared/lib/date";
import { useHrStore } from "../../store";
import { STAGE_LABEL } from "../../lib/board";
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
  const dupes = s.duplicatesOf(c.phone, c.email, c.id);
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

  const writeTags = async (next: string[]) => {
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

        {dupes.length > 0 && (
          <p className="mt-2.5 rounded-xl border border-yellow/40 bg-[#FFF7E6] px-3 py-2 text-[12px] text-navy">
            Also applied to{" "}
            {dupes.map((d) => s.requisitionById(d.requisitionId)?.mrfNo ?? "another vacancy").join(", ")}.
          </p>
        )}
      </div>

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
