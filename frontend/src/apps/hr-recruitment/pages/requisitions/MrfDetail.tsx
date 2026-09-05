import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import EmptyState from "@/shared/components/ui/EmptyState";
import DueCell from "@/shared/components/ui/DueCell";
import { Field } from "@/shared/components/ui/Readout";
import { formatDateDMY, formatDateTimeDMY } from "@/shared/lib/date";
import Tabs from "@/shared/components/ui/Tabs";
import Modal from "@/shared/components/ui/Modal";
import MrfStepper from "../../components/MrfStepper";
import StateNote from "../../components/StateNote";
import StatusPill from "../../components/StatusPill";
import CandidateBoard from "../../components/kanban/CandidateBoard";
import OnboardingPanel from "../../components/onboarding/OnboardingPanel";
import ProbationPanel from "../../components/probation/ProbationPanel";
import { HoldCancelModal, JobPostingModal, MrfDecisionModal } from "../../components/MrfModals";
import MrfForm from "../../components/MrfForm";
import { useHrStore } from "../../store";
import { inr, salaryLabel } from "../../lib/format";
import { experienceLabel } from "../../lib/jd";
import { isOpenCandidate } from "../../lib/queues";
import { bulletsFromText } from "../../components/BulletList";
import { hrDocUrl, type MrfInput } from "../../data/hrWrites";
import type { StepKey } from "../../lib/steps";
import { SKILL_CATEGORIES, type Candidate, type Onboarding, type Probation } from "../../types";

/**
 * One labelled row of skill/qualification chips.
 *
 * Chips rather than a comma-joined sentence: a requisition routinely asks for a
 * dozen skills, and a wrapped sentence of them is unreadable at a glance — which
 * is exactly the moment an approver is deciding whether the ask is reasonable.
 */
function ChipRow({ label, names, muted = false }: { label: string; names: string[]; muted?: boolean }) {
  return (
    <div>
      <p className="text-[11.5px] font-semibold uppercase tracking-wide text-grey-2">{label}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {names.map((n) => (
          <span
            key={n}
            className={
              muted
                ? "rounded-pill border border-line px-2.5 py-1 text-[12px] text-grey"
                : "rounded-pill border border-orange/25 bg-orange/5 px-2.5 py-1 text-[12px] font-medium text-navy"
            }
          >
            {n}
          </span>
        ))}
      </div>
    </div>
  );
}

const OFFER_LABEL: Record<string, string> = {
  pending: "Awaiting answer",
  accepted: "Accepted",
  declined: "Declined",
  no_show: "Did not join",
};

/** Open the private JD in a new tab via a short-lived signed URL. */
async function openJd(path: string) {
  const url = await hrDocUrl(path);
  if (url) window.open(url, "_blank", "noreferrer");
}

/** One requisition: where it is, what it says, and what you can do about it. */
export default function MrfDetail() {
  const { id = "" } = useParams();
  const s = useHrStore();
  const navigate = useNavigate();

  const [decideStage, setDecideStage] = useState<"hr" | "mgmt" | null>(null);
  const [posting, setPosting] = useState(false);
  const [holdMode, setHoldMode] = useState<"hold" | "resume" | "cancel" | null>(null);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState("mrf");
  const [openOnboarding, setOpenOnboarding] = useState<Onboarding | null>(null);
  const [openProbation, setOpenProbation] = useState<Probation | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // ⚠ These four belong HERE, with the other hooks, and not beside the JD block
  //    they serve further down — that sits after `if (s.isLoading)` and `if (!r)`,
  //    so a hook declared there is skipped on the loading render and appears on the
  //    next one: "Rendered more hooks than during the previous render", and the
  //    whole requisition page goes to the error boundary.
  const jdInput = useRef<HTMLInputElement>(null);
  const [jdBusy, setJdBusy] = useState(false);
  const [jdErr, setJdErr] = useState<string | null>(null);
  const [removingJd, setRemovingJd] = useState(false);

  const r = s.requisitionById(id);
  if (s.isLoading) return <p className="text-[13.5px] text-grey-2">Loading…</p>;
  if (!r) {
    return (
      <EmptyState
        title="Requisition not found"
        message="It may have been removed, or you may not have permission to see it."
        actionLabel="Back to requisitions"
        actionTo="/hr-recruitment/requisitions"
      />
    );
  }

  const dept = s.departments.find((d) => d.id === r.departmentId)?.name ?? "—";
  const loc = s.locations.find((l) => l.id === r.locationId)?.name ?? "—";
  const jobType = s.jobTypes.find((t) => t.id === r.jobTypeId)?.name ?? "—";
  // `personName`, not `profileById`: the directory is scoped by RLS to the reader's own
  // department, so every actor outside it — the approver, the canceller, whoever raised
  // it — rendered as "Unknown". This page is mostly a record of who did what.
  const person = (uid: string | null) => (uid ? s.personName(uid) : "—");
  const peopleList = (ids: string[], note: string | null) => {
    const names = ids.map((uid) => person(uid)).filter(Boolean);
    const all = [...names, ...(note ? [note] : [])];
    return all.length ? all.join(", ") : "—";
  };

  // ---- The job description, resolved for display -------------------------
  // Responsibilities are stored newline-joined; ids resolve through the store,
  // which drops any whose master row has since been deleted.
  const responsibilities = bulletsFromText(r.keyResponsibilities);
  const qualificationNames = s.qualificationNames(r.qualificationIds);
  const preferredNames = s.skillNames(r.preferredSkillIds);
  /** Must-have skills split back into their categories, in SKILL_CATEGORIES order. */
  const mustHaveGroups = SKILL_CATEGORIES.map((c) => ({
    label: c.label,
    names: r.skillIds
      .map((id) => s.skillById(id))
      .filter((sk) => sk?.category === c.value)
      .map((sk) => sk!.name),
  })).filter((g) => g.names.length > 0);

  // "Others" reads as nothing on its own, so it carries the name HR typed with it.
  const otherNote = s.otherPlatformNoteFor(r.id);
  const platforms = s
    .platformIdsFor(r.id)
    .map((pid) => {
      const p = s.jobPlatforms.find((x) => x.id === pid);
      if (!p) return undefined;
      return p.isOther && otherNote ? `${p.name} (${otherNote})` : p.name;
    })
    .filter(Boolean) as string[];

  // What this user may do, at this step, on THIS requisition.
  // A view-only grant removes every action here while the requisition stays readable.
  const canDecideHr = s.canEdit && r.status === "hr_review" && s.canActOn("hr_head_approval", r);
  const canDecideMgmt = s.canEdit && r.status === "mgmt_review" && s.canActOn("mgmt_approval", r);
  const canPost = s.canEdit && r.status === "posting" && s.canActOn("job_posting", r);
  // Only the person who raised it can fix a sent-back requisition and resubmit.
  const isMine = s.myRequisitions.some((m) => m.id === r.id);
  const canResubmit = s.canEdit && r.status === "sent_back" && (isMine || s.isAdmin);
  const canHold = s.canEdit && s.isProcessCoordinator;

  // (NR-5) The job description could always be CLEARED — jd_path is written with
  // nullif(trim(...),''), not coalesce. What it never had was a control, and a
  // guard HR could pass: fms_hr_set_requisition_jd asked is_admin OR requester and
  // never fms_hr_can_act, so on a vacancy a department head raised, HR could not
  // touch it. Replacing it otherwise meant Edit & resubmit, which only exists on a
  // sent-back MRF.
  const jdRef = { kind: "jd", requisitionId: r.id, path: r.jdPath } as const;
  const canChangeJd = s.canChangeAttachment(jdRef);
  const replaceJd = async (file: File | undefined) => {
    if (!file) return;
    setJdBusy(true);
    setJdErr(null);
    try {
      await s.replaceAttachment(jdRef, file);
    } catch (e) {
      setJdErr(e instanceof Error ? e.message : "Could not replace the JD");
    } finally {
      setJdBusy(false);
    }
  };

  const removeJd = async () => {
    setJdBusy(true);
    setJdErr(null);
    try {
      await s.removeAttachment(jdRef);
      setRemovingJd(false);
    } catch (e) {
      setJdErr(e instanceof Error ? e.message : "Could not remove the JD");
    } finally {
      setJdBusy(false);
    }
  };

  const candidates = s.candidatesFor(r.id);
  // "Filled" means someone actually JOINED — not that they were finalized. A
  // finalized candidate who declines hands the seat straight back.
  const joined = s.seatsJoined(r.id);
  const taken = s.seatsTaken(r.id);
  const live = candidates.filter(isOpenCandidate).length;

  // Everyone who was offered, INCLUDING those already marked hired — a hire's
  // onboarding is the record of how they joined and must not vanish from this tab
  // the moment their card is acknowledged on the board.
  const onboardings = candidates
    .filter((c) => c.stage === "finalized" || c.stage === "hired")
    .map((c) => ({ c, o: s.onboardingForCandidate(c.id) }))
    .filter((x): x is { c: Candidate; o: Onboarding } => !!x.o);

  const dueStep: StepKey | null =
    r.status === "hr_review"
      ? "hr_head_approval"
      : r.status === "mgmt_review"
        ? "mgmt_approval"
        : r.status === "posting"
          ? "job_posting"
          : r.status === "sourcing"
            ? "resume_upload"
            : null;

  const resubmit = async (input: MrfInput, jdFile: File | null) => {
    setBusy(true);
    setErr(null);
    try {
      await s.resubmitMrf(r.id, input);
      // The requisition already exists here, so a new JD can upload straight away.
      if (jdFile) await s.attachRequisitionJd(r.id, jdFile);
      setEditing(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-[22px] font-bold text-navy">Edit & resubmit — {r.mrfNo}</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">
            Fix what was flagged and resubmit. It goes back to the HR Head, and the approval clock restarts.
          </p>
        </div>
        <MrfForm
          existing={r}
          busy={busy}
          error={err}
          submitLabel="Resubmit"
          onSubmit={resubmit}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ---- Header ---- */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-[22px] font-bold text-navy">{r.mrfNo}</h1>
            <StatusPill status={r.status} />
          </div>
          <p className="text-[13.5px] text-grey-2 mt-1">
            {r.jobTitle} · {dept} · {r.positionsRequired} {r.positionsRequired === 1 ? "seat" : "seats"}
            {r.positionKind === "replacement" && ` · replacing ${r.previousEmployeeName}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canDecideHr && <Button size="sm" onClick={() => setDecideStage("hr")}>HR Head decision</Button>}
          {canDecideMgmt && <Button size="sm" onClick={() => setDecideStage("mgmt")}>Management decision</Button>}
          {canPost && <Button size="sm" onClick={() => setPosting(true)}>Post the job</Button>}
          {canResubmit && <Button size="sm" onClick={() => setEditing(true)}>Edit & resubmit</Button>}
          {canHold && r.status === "on_hold" && (
            <Button size="sm" variant="ghost" onClick={() => setHoldMode("resume")}>Take off hold</Button>
          )}
          {canHold && r.status !== "on_hold" && r.status !== "cancelled" && r.status !== "closed" && (
            <Button size="sm" variant="ghost" onClick={() => setHoldMode("hold")}>Hold</Button>
          )}
          {canHold && r.status !== "cancelled" && r.status !== "closed" && (
            <Button size="sm" variant="ghost" onClick={() => setHoldMode("cancel")}>Cancel</Button>
          )}
        </div>
      </div>

      {/* ---- Where it is ---- */}
      <Card className="p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-navy">Progress</h2>
          {dueStep && (
            <span className="text-[12.5px] text-grey">
              Next step due: <DueCell dueIso={s.dueIsoFor(r, dueStep)} />
            </span>
          )}
        </div>
        <MrfStepper requisition={r} />

        {/* Sent back / Rejected / On hold / Cancelled / Closed — one component, so the
            reason, the person and the date are stated the same way everywhere. */}
        <StateNote requisition={r} />

        {(r.hrRemarks || r.mgmtRemarks) && (
          <div className="grid gap-3 sm:grid-cols-2">
            {r.hrRemarks && (
              <Field label={`HR Head · ${person(r.hrApproverId)}`}>{r.hrRemarks}</Field>
            )}
            {r.mgmtRemarks && (
              <Field label={`Management · ${person(r.mgmtApproverId)}`}>{r.mgmtRemarks}</Field>
            )}
          </div>
        )}

        {r.postedAt && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Posted on">{platforms.length ? platforms.join(", ") : "—"}</Field>
            <Field label="Date of job posted">{formatDateDMY(r.postedOn)}</Field>
          </div>
        )}
      </Card>

      {/* ---- MRF | Pipeline ---- */}
      <Tabs
        tabs={[
          { key: "mrf", label: "The requisition" },
          { key: "pipeline", label: `Pipeline${candidates.length ? ` (${candidates.length})` : ""}` },
          { key: "onboarding", label: `Onboarding${onboardings.length ? ` (${onboardings.length})` : ""}` },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "pipeline" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] text-grey-2">
              {joined} of {r.positionsRequired} {r.positionsRequired === 1 ? "seat" : "seats"} filled
              {taken > joined && ` · ${taken - joined} offered, not yet joined`} · {live} candidate
              {live === 1 ? "" : "s"} still in play
            </p>
          </div>

          {r.status !== "sourcing" && candidates.length === 0 ? (
            <Card className="p-5">
              <p className="text-[13.5px] text-grey-2">
                Candidates can be added once the job has been posted.
              </p>
            </Card>
          ) : (
            <CandidateBoard
              requisition={r}
              onOpenCandidate={(cand) => navigate(`/hr-recruitment/candidates/${cand.id}`)}
            />
          )}
        </div>
      )}

      {tab === "onboarding" && (
        <Card className="p-5 space-y-3">
          <div>
            <h2 className="text-[15px] font-semibold text-navy">Onboarding</h2>
            <p className="mt-0.5 text-[13px] text-grey-2">
              Everyone offered this job. A seat is only filled once the person actually joins — if someone
              declines, the seat comes straight back and this vacancy keeps looking.
            </p>
          </div>

          {onboardings.length === 0 ? (
            <p className="text-[13.5px] text-grey-2">
              Nobody has been finalized yet. Finalize a candidate on the Pipeline board and their onboarding
              opens here.
            </p>
          ) : (
            <ul className="space-y-2">
              {onboardings.map(({ c, o }) => {
                const checks = s.checksFor(o.id);
                const ticked = checks.filter((k) => k.done).length;
                const dropped = o.offerStatus === "declined" || o.offerStatus === "no_show";
                // Opened the moment they joined — never when they were merely offered.
                const probation = s.probationForOnboarding(o.id);
                return (
                  <li
                    key={o.id}
                    className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${
                      o.completedAt
                        ? "border-ryg-green/30 bg-[#E9F7EF]/40"
                        : dropped
                          ? "border-ryg-red/30 bg-[#FDECEC]/40"
                          : "border-line"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-semibold text-navy">{c.name}</div>
                      <div className="text-[12px] text-grey-2">
                        {/* Accepted is implied by being finalized, so it is not worth
                            a line — only a drop-out is. */}
                        {o.offerStatus !== "accepted" && `${OFFER_LABEL[o.offerStatus] ?? o.offerStatus} · `}
                        {o.joiningDate ? `joining ${formatDateDMY(o.joiningDate)}` : "joining date not set"}
                        {checks.length > 0 && ` · ${ticked}/${checks.length} done`}
                        {s.canViewSalary && c.offeredCtc !== null && ` · ${inr(c.offeredCtc)}`}
                        {o.employeeCode && ` · ${o.employeeCode}`}
                      </div>
                      {dropped && o.offerStatusReason && (
                        <div className="mt-0.5 text-[12px] text-ryg-red">{o.offerStatusReason}</div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setOpenOnboarding(o)}>
                        {o.completedAt || dropped ? "View" : "Open"}
                      </Button>
                      {/* They actually joined, so the three-month clock is running. */}
                      {probation && (
                        <Button size="sm" variant="ghost" onClick={() => setOpenProbation(probation)}>
                          Probation
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {/* ---- The requisition ---- */}
      {tab === "mrf" && (
      <Card className="p-5 space-y-5">
        <h2 className="text-[15px] font-semibold text-navy">The requisition</h2>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Raised by">{person(r.requesterId)}</Field>
          <Field label="Date of request">{formatDateDMY(r.requestDate)}</Field>
          <Field label="Department">{dept}</Field>
          <Field label="Location">{loc}</Field>
          <Field label="Employment type">{jobType}</Field>
          <Field label="Expected joining date">{formatDateDMY(r.expectedStartDate)}</Field>
          <Field label="Hiring manager">{peopleList(r.hiringManagerIds, null)}</Field>
          <Field label="Reporting to">{peopleList(r.reportingToIds, r.reportingToNote)}</Field>
          <Field label="Salary">{salaryLabel(r.salaryMin, r.salaryMax, r.salaryStructure, r.salaryPeriod)}</Field>
          <Field label="Experience">{experienceLabel(r.experienceMinYears, r.experienceMaxYears, r.freshersOk) ?? "—"}</Field>
          <Field label="Job description file">
            <input
              ref={jdInput}
              type="file"
              className="hidden"
              onChange={(e) => void replaceJd(e.target.files?.[0])}
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {r.jdPath ? (
                <button
                  type="button"
                  onClick={() => void openJd(r.jdPath!)}
                  className="text-[13px] font-semibold text-orange hover:underline"
                >
                  {r.jdName ?? "Open JD"} →
                </button>
              ) : (
                <span className="text-[13px] text-grey-2">—</span>
              )}
              {canChangeJd && (
                <>
                  <button
                    type="button"
                    disabled={jdBusy}
                    onClick={() => {
                      setJdErr(null);
                      if (jdInput.current) {
                        jdInput.current.value = "";
                        jdInput.current.click();
                      }
                    }}
                    className="text-[12px] font-semibold text-grey-2 hover:text-orange disabled:opacity-50"
                  >
                    {jdBusy ? "Working…" : r.jdPath ? "Replace" : "Attach"}
                  </button>
                  {r.jdPath && (
                    <button
                      type="button"
                      disabled={jdBusy}
                      onClick={() => {
                        setJdErr(null);
                        setRemovingJd(true);
                      }}
                      className="text-[12px] font-semibold text-grey-2 hover:text-red-600 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  )}
                </>
              )}
            </div>
            {jdErr && <p className="mt-1 text-[12px] text-red-600">{jdErr}</p>}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {r.whyNeeded && <Field label="Why is this position needed?">{r.whyNeeded}</Field>}
          {r.incentiveNote && <Field label="Performance incentives">{r.incentiveNote}</Field>}
          {r.roleSummary && <Field label="What the role is for">{r.roleSummary}</Field>}
          {/*
            Asked by the old form, dropped by the rebuild. Rendered conditionally so
            the ~13 requisitions raised before it keep showing what they captured —
            nothing writes these any more.
          */}
          {r.businessContribution && (
            <Field label="Contribution to business objectives">{r.businessContribution}</Field>
          )}
          {r.impactIfUnfilled && <Field label="Impact if not filled">{r.impactIfUnfilled}</Field>}
          {r.preferredExperience && <Field label="Preferred experience">{r.preferredExperience}</Field>}
        </div>

        {responsibilities.length > 0 && (
          <div>
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-grey-2">Key responsibilities</p>
            <ul className="mt-1.5 space-y-1">
              {responsibilities.map((line, i) => (
                <li key={i} className="flex gap-2 text-[13.5px] leading-relaxed text-navy">
                  <span className="shrink-0 text-grey-2">•</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(mustHaveGroups.length > 0 || preferredNames.length > 0 || qualificationNames.length > 0) && (
          <div className="space-y-3">
            {qualificationNames.length > 0 && <ChipRow label="Education" names={qualificationNames} />}
            {mustHaveGroups.map((g) => (
              <ChipRow key={g.label} label={g.label} names={g.names} />
            ))}
            {preferredNames.length > 0 && <ChipRow label="Good to have" names={preferredNames} muted />}
          </div>
        )}

        {r.skillsNote && <Field label="Anything else">{r.skillsNote}</Field>}
      </Card>
      )}

      {/* ---- History ---- */}
      <Card className="p-5">
        <h2 className="text-[15px] font-semibold text-navy">History</h2>
        <ul className="mt-3 space-y-2.5">
          {s.activityFor("requisition", r.id).length === 0 && (
            <li className="text-[13px] text-grey-2">Nothing recorded yet.</li>
          )}
          {[...s.activityFor("requisition", r.id)]
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map((a) => (
              <li key={a.id} className="flex items-start gap-3 text-[13px]">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-orange" />
                <span className="text-navy">{a.note ?? a.type}</span>
                <span className="ml-auto shrink-0 text-[12px] text-grey-2">
                  {person(a.actorId)} · {formatDateTimeDMY(a.createdAt)}
                </span>
              </li>
            ))}
        </ul>
      </Card>

      <Link to="/hr-recruitment/requisitions" className="inline-block text-[12.5px] font-semibold text-grey-2 hover:text-navy">
        ← All requisitions
      </Link>

      {decideStage && (
        <MrfDecisionModal
          requisition={r}
          stage={decideStage}
          open={!!decideStage}
          onClose={() => setDecideStage(null)}
        />
      )}
      {posting && <JobPostingModal requisition={r} open={posting} onClose={() => setPosting(false)} />}
      <Modal
        open={removingJd}
        onClose={() => !jdBusy && setRemovingJd(false)}
        title="Remove the job description?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setRemovingJd(false)} disabled={jdBusy}>
              Keep it
            </Button>
            <Button size="sm" onClick={() => void removeJd()} disabled={jdBusy}>
              {jdBusy ? "Removing…" : "Remove it"}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-[13px] text-navy">
          <p className="font-semibold">{r.jdName ?? "The attached job description"}</p>
          <p className="text-[12.5px] text-grey-2">
            The file is deleted from storage as well as from this requisition. There is no backup and no
            undo. Candidates already on this vacancy keep their AI fit scores, but a new score cannot be
            worked out without a JD to read against.
          </p>
          <p className="text-[12.5px] text-grey-2">Who removed it, and when, is written to the trail.</p>
        </div>
      </Modal>
      {holdMode && (
        <HoldCancelModal requisition={r} mode={holdMode} open={!!holdMode} onClose={() => setHoldMode(null)} />
      )}
      {openOnboarding && (
        <OnboardingPanel
          onboarding={openOnboarding}
          open={!!openOnboarding}
          onClose={() => setOpenOnboarding(null)}
        />
      )}
      {openProbation && (
        <ProbationPanel
          probation={openProbation}
          open={!!openProbation}
          onClose={() => setOpenProbation(null)}
        />
      )}
    </div>
  );
}
