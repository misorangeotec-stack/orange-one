import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import EmptyState from "@/shared/components/ui/EmptyState";
import DueCell from "@/shared/components/ui/DueCell";
import { Field } from "@/shared/components/ui/Readout";
import { formatDateDMY, formatDateTimeDMY } from "@/shared/lib/date";
import Tabs from "@/shared/components/ui/Tabs";
import MrfStepper from "../../components/MrfStepper";
import StatusPill from "../../components/StatusPill";
import CandidateBoard from "../../components/kanban/CandidateBoard";
import CandidateDrawer from "../../components/kanban/CandidateDrawer";
import OnboardingPanel from "../../components/onboarding/OnboardingPanel";
import ProbationPanel from "../../components/probation/ProbationPanel";
import { HoldCancelModal, JobPostingModal, MrfDecisionModal } from "../../components/MrfModals";
import MrfForm from "../../components/MrfForm";
import { useHrStore } from "../../store";
import { inr, salaryLabel } from "../../lib/format";
import type { MrfInput } from "../../data/hrWrites";
import type { StepKey } from "../../lib/steps";
import type { Candidate, Onboarding, Probation } from "../../types";

const OFFER_LABEL: Record<string, string> = {
  pending: "Awaiting answer",
  accepted: "Accepted",
  declined: "Declined",
  no_show: "Did not join",
};

/** One requisition: where it is, what it says, and what you can do about it. */
export default function MrfDetail() {
  const { id = "" } = useParams();
  const s = useHrStore();

  const [decideStage, setDecideStage] = useState<"hr" | "mgmt" | null>(null);
  const [posting, setPosting] = useState(false);
  const [holdMode, setHoldMode] = useState<"hold" | "resume" | "cancel" | null>(null);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState("mrf");
  const [openCandidate, setOpenCandidate] = useState<Candidate | null>(null);
  const [openOnboarding, setOpenOnboarding] = useState<Onboarding | null>(null);
  const [openProbation, setOpenProbation] = useState<Probation | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
  const person = (uid: string | null) => (uid ? (s.profileById(uid)?.name ?? "Unknown") : "—");
  const peopleList = (ids: string[], note: string | null) => {
    const names = ids.map((uid) => person(uid)).filter(Boolean);
    const all = [...names, ...(note ? [note] : [])];
    return all.length ? all.join(", ") : "—";
  };

  const platforms = s
    .platformIdsFor(r.id)
    .map((pid) => s.jobPlatforms.find((p) => p.id === pid)?.name)
    .filter(Boolean) as string[];

  // What this user may do, at this step, on THIS requisition.
  const canDecideHr = r.status === "hr_review" && s.canActOn("hr_head_approval", r);
  const canDecideMgmt = r.status === "mgmt_review" && s.canActOn("mgmt_approval", r);
  const canPost = r.status === "posting" && s.canActOn("job_posting", r);
  // Only the person who raised it can fix a sent-back requisition and resubmit.
  const isMine = s.myRequisitions.some((m) => m.id === r.id);
  const canResubmit = r.status === "sent_back" && (isMine || s.isAdmin);
  const canHold = s.isProcessCoordinator;

  const candidates = s.candidatesFor(r.id);
  // "Filled" means someone actually JOINED — not that they were finalized. A
  // finalized candidate who declines hands the seat straight back.
  const joined = s.seatsJoined(r.id);
  const taken = s.seatsTaken(r.id);
  const live = candidates.filter((c) => c.stage !== "finalized" && c.stage !== "disqualified").length;

  const onboardings = candidates
    .filter((c) => c.stage === "finalized")
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

  const resubmit = async (input: MrfInput) => {
    setBusy(true);
    setErr(null);
    try {
      await s.resubmitMrf(r.id, input);
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

        {r.status === "sent_back" && r.sentBackReason && (
          <div className="rounded-xl border border-ryg-red/30 bg-[#FDECEC]/50 px-4 py-3">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-ryg-red">Sent back</div>
            <p className="mt-1 text-[13px] text-navy">{r.sentBackReason}</p>
          </div>
        )}
        {r.status === "rejected" && r.rejectReason && (
          <div className="rounded-xl border border-ryg-red/30 bg-[#FDECEC]/50 px-4 py-3">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-ryg-red">Rejected</div>
            <p className="mt-1 text-[13px] text-navy">{r.rejectReason}</p>
          </div>
        )}
        {r.status === "on_hold" && r.holdReason && (
          <div className="rounded-xl border border-line bg-page px-4 py-3">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-grey">On hold</div>
            <p className="mt-1 text-[13px] text-navy">{r.holdReason}</p>
          </div>
        )}

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
            <CandidateBoard requisition={r} onOpenCandidate={setOpenCandidate} />
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
                        {OFFER_LABEL[o.offerStatus] ?? o.offerStatus}
                        {o.joiningDate ? ` · joining ${formatDateDMY(o.joiningDate)}` : " · joining date not set"}
                        {checks.length > 0 && ` · ${ticked}/${checks.length} done`}
                        {c.offeredCtc !== null && ` · ${inr(c.offeredCtc)}`}
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
          <Field label="Job type">{jobType}</Field>
          <Field label="Expected start date">{formatDateDMY(r.expectedStartDate)}</Field>
          <Field label="Hiring manager">{peopleList(r.hiringManagerIds, null)}</Field>
          <Field label="Reporting to">{peopleList(r.reportingToIds, r.reportingToNote)}</Field>
          <Field label="Salary range">{salaryLabel(r.salaryMin, r.salaryMax, r.salaryNote)}</Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {r.whyNeeded && <Field label="Why is this position needed?">{r.whyNeeded}</Field>}
          {r.businessContribution && (
            <Field label="Contribution to business objectives">{r.businessContribution}</Field>
          )}
          {r.impactIfUnfilled && <Field label="Impact if not filled">{r.impactIfUnfilled}</Field>}
          {r.keyResponsibilities && <Field label="Key responsibilities">{r.keyResponsibilities}</Field>}
          {r.requiredSkills && <Field label="Required skills and qualifications">{r.requiredSkills}</Field>}
          {r.preferredExperience && <Field label="Preferred experience">{r.preferredExperience}</Field>}
        </div>
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
      {holdMode && (
        <HoldCancelModal requisition={r} mode={holdMode} open={!!holdMode} onClose={() => setHoldMode(null)} />
      )}
      {openCandidate && (
        <CandidateDrawer
          candidate={openCandidate}
          open={!!openCandidate}
          onClose={() => setOpenCandidate(null)}
        />
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
