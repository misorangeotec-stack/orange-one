import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { FieldRow } from "@/shared/components/ui/Readout";
import { formatDateDMY } from "@/shared/lib/date";
import { useHrStore } from "../store";
import { salaryLabel } from "../lib/format";
import { experienceLabel } from "../lib/jd";
import { hrDocUrl, type MrfStage } from "../data/hrWrites";
import type { Requisition } from "../types";

/** How many must-have skills the panel prints before it starts counting. */
const SKILL_CAP = 6;

/** Open the private JD in a new tab via a short-lived signed URL. */
async function openJd(path: string) {
  const url = await hrDocUrl(path);
  if (url) window.open(url, "_blank", "noreferrer");
}

/** One captioned paragraph — the long-text facts, which no row gutter can hold. */
function Block({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-grey">{caption}</div>
      <p className="mt-1 text-[13px] leading-relaxed text-navy">{children}</p>
    </div>
  );
}

/**
 * The briefing at the top of the MRF decision modal: what this vacancy is, who
 * asked for it, what it costs and why it exists — so an approver never has to
 * close the dialog and go read the requisition to answer "should I approve this?".
 *
 * It is a SUMMARY, not the requisition. The detail page renders every field the
 * MRF has; this shows the handful a decision actually turns on and links out for
 * the rest. Two deliberate cuts:
 *
 *  • Must-have skills stop at {@link SKILL_CAP} and then count. A requisition
 *    routinely carries a dozen, and the full list would swamp the panel it is
 *    supposed to be a briefing in.
 *  • Responsibilities, role summary and the legacy narrative fields are absent
 *    entirely — that is what the JD file and the link out are for.
 *
 * THREE THINGS KEEP A DOZEN FACTS FROM READING AS CLUTTER (the same three the
 * sampling app's StepRecap settled on):
 *
 *  1. AN IDENTITY STRIP, not fields. Which job, which department, how many seats
 *     and new-or-replacement is one sentence, and pulling it up here is what
 *     stops the list below repeating it.
 *
 *  2. SPEC-SHEET ROWS (`FieldRow`), not stacked label-over-value. Stacking costs
 *     two lines per fact and shouts a dozen uppercase labels at once.
 *
 *  3. TWO STABLE COLUMNS with a fixed meaning — LEFT is who is asking, RIGHT is
 *     what is being asked for. Each column is its own stack, NOT a row-major
 *     grid, so an absent optional field (incentives, JD file) shortens its own
 *     column instead of shunting every later field into the wrong one.
 *
 * ⚠ THE SALARY BAND IS NOT GATED. `store.canViewSalary` governs the OFFERED CTC;
 * the requisition's approved RANGE is public by design (see store.tsx) — and it
 * is the single biggest thing an approver is approving.
 */
export default function MrfRecap({
  requisition: r,
  stage,
}: {
  requisition: Requisition;
  stage: MrfStage;
}) {
  const s = useHrStore();

  const dept = s.departments.find((d) => d.id === r.departmentId)?.name ?? null;
  const loc = s.locations.find((l) => l.id === r.locationId)?.name ?? null;
  const jobType = s.jobTypes.find((t) => t.id === r.jobTypeId)?.name ?? null;

  const person = (uid: string | null) => (uid ? (s.profileById(uid)?.name ?? "Unknown") : null);
  /** Resolved names plus any free-text note, as one line. */
  const peopleList = (ids: string[], note: string | null) => {
    const names = ids.map((uid) => person(uid)).filter((n): n is string => !!n);
    const all = [...names, ...(note ? [note] : [])];
    return all.length ? all.join(", ") : null;
  };

  // Joined into ONE string rather than separate spans, so a separator can never
  // orphan onto its own line when the strip wraps.
  const identity = [
    dept,
    loc,
    `${r.positionsRequired} ${r.positionsRequired === 1 ? "seat" : "seats"}`,
    r.positionKind === "replacement"
      ? `Replacing ${r.previousEmployeeName ?? "someone who left"}`
      : "New position",
  ]
    .filter((part): part is string => !!part)
    .join(" · ");

  const qualifications = s.qualificationNames(r.qualificationIds);
  const skills = s.skillNames(r.skillIds);
  const shownSkills = skills.slice(0, SKILL_CAP);
  const moreSkills = skills.length - shownSkills.length;

  return (
    <div className="rounded-xl bg-page px-4 py-3.5">
      {/* IDENTITY — one line: which job, where, how many, and why there is a seat. */}
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 border-b border-line pb-2.5">
        <span className="text-[15px] font-bold text-navy">{r.jobTitle}</span>
        <span className="text-[12.5px] text-grey">{identity}</span>
      </div>

      {/* space-y-3.5 (14px) between rows: the gap has to stay clearly LARGER than
          the 20px line-height's own leading, or a value that wraps reads as two
          separate rows. */}
      <div className="mt-3.5 grid grid-cols-1 gap-x-8 gap-y-3.5 sm:grid-cols-2">
        {/* LEFT — who is asking, and for when. */}
        <div className="space-y-3.5">
          <FieldRow label="Raised by" value={person(r.requesterId)} />
          <FieldRow label="Requested on" value={formatDateDMY(r.requestDate)} />
          <FieldRow label="Hiring manager" value={peopleList(r.hiringManagerIds, null)} />
          <FieldRow label="Reporting to" value={peopleList(r.reportingToIds, r.reportingToNote)} />
          <FieldRow label="Employment type" value={jobType} />
          <FieldRow label="Joining by" value={formatDateDMY(r.expectedStartDate)} />
        </div>

        {/* RIGHT — what it costs and what it asks for. */}
        <div className="space-y-3.5">
          <FieldRow
            label="Salary"
            value={salaryLabel(r.salaryMin, r.salaryMax, r.salaryStructure, r.salaryPeriod)}
          />
          {r.incentiveNote && <FieldRow label="Incentives" value={r.incentiveNote} />}
          <FieldRow
            label="Experience"
            value={experienceLabel(r.experienceMinYears, r.experienceMaxYears, r.freshersOk)}
          />
          <FieldRow label="Education" value={qualifications.join(", ")} />
          <FieldRow
            label="Must-have skills"
            value={
              shownSkills.length > 0 ? (
                <>
                  {shownSkills.join(", ")}
                  {moreSkills > 0 && <span className="text-grey-2"> +{moreSkills} more</span>}
                </>
              ) : null
            }
          />
          {r.jdPath && (
            <FieldRow label="Job description">
              <button
                type="button"
                onClick={() => void openJd(r.jdPath!)}
                className="font-semibold text-orange hover:underline"
              >
                {r.jdName ?? "Open JD"} →
              </button>
            </FieldRow>
          )}
        </div>
      </div>

      {/* The narrative facts, full width — a 124px label gutter cannot hold a
          paragraph, and this is the one an approval actually turns on. */}
      {(r.whyNeeded || (stage === "mgmt" && r.hrRemarks)) && (
        <div className="mt-3.5 space-y-3 border-t border-line pt-3">
          {r.whyNeeded && <Block caption="Why this is needed">{r.whyNeeded}</Block>}
          {/* Management decides SECOND, so what the HR Head made of it is part of
              the brief. On the `hr` stage there is no prior verdict to show. */}
          {stage === "mgmt" && r.hrRemarks && (
            <Block caption="The HR Head said">{r.hrRemarks}</Block>
          )}
        </div>
      )}

      {/* Everything this panel deliberately left out. Opens in a NEW TAB: this
          dialog holds a half-made decision, and navigating in place would bin it
          — one of the two callers is already on that very page. */}
      <div className="mt-3 flex justify-end">
        <Link
          to={`/hr-recruitment/requisitions/${r.id}`}
          target="_blank"
          rel="noreferrer"
          className="text-[12px] font-semibold text-orange hover:underline"
        >
          The rest of the requisition ↗
        </Link>
      </div>
    </div>
  );
}
