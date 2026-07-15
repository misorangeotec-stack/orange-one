import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import EmptyState from "@/shared/components/ui/EmptyState";
import DueCell from "@/shared/components/ui/DueCell";
import { Field, SectionHeading } from "@/shared/components/ui/Readout";
import { formatDateDMY, formatDateTimeDMY } from "@/shared/lib/date";
import { useEffectiveIdentity } from "@/shared/sandbox/useEffectiveIdentity";
import ExitStepper from "../../components/ExitStepper";
import StatusPill from "../../components/StatusPill";
import {
  ConfirmLwdModal,
  HeadDecisionModal,
  HoldWithdrawModal,
  HrVerifyModal,
  ManagerReviewModal,
  SkipStepModal,
} from "../../components/ExitModals";
import ClearancePanel from "../../components/clearance/ClearancePanel";
import AssetPanel from "../../components/assets/AssetPanel";
import HandoverPanel from "../../components/handover/HandoverPanel";
import ExitInterviewPanel from "../../components/interview/ExitInterviewPanel";
import SettlementPanel from "../../components/settlement/SettlementPanel";
import DocumentsPanel from "../../components/documents/DocumentsPanel";
import { useExitStore } from "../../store";
import { exitDocUrl } from "../../data/exitWrites";
import {
  CASE_TYPE_LABEL,
  RECOMMENDATION_CLASS,
  RECOMMENDATION_LABEL,
  noticeLabel,
} from "../../lib/format";
import type { StepKey } from "../../lib/steps";

/**
 * One exit case: where it is, what it says, and what you can do about it.
 *
 * Every action panel is READ-ONLY unless `canActOn(step, case)` — which mirrors
 * `fms_exit_can_act()` exactly, so the UI never offers a button the database will
 * reject. The RPC re-checks regardless; this is courtesy, not security.
 *
 * The **last working day is the hero field**, with a days-remaining chip. It is the
 * event seven downstream SLAs and the entire clearance checklist hang off, and a
 * date buried in a grid of fields is a date nobody notices going past.
 */
export default function ExitDetail() {
  const { id = "" } = useParams();
  const s = useExitStore();
  const { user } = useEffectiveIdentity();

  const [reviewing, setReviewing] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [holdMode, setHoldMode] = useState<"hold" | "resume" | "withdraw" | null>(null);
  const [skipping, setSkipping] = useState(false);
  const [confirmingLwd, setConfirmingLwd] = useState(false);

  const c = s.caseById(id);
  if (s.isLoading) return <p className="text-[13.5px] text-grey-2">Loading…</p>;
  if (!c) {
    return (
      <EmptyState
        title="Exit case not found"
        message="It may have been removed, or you may not have permission to see it."
        actionLabel="Back to exit cases"
        actionTo="/hr-exit/exits"
      />
    );
  }

  const dept = s.departments.find((d) => d.id === c.departmentId)?.name ?? "—";
  const person = (uid: string | null) => (uid ? (s.profileById(uid)?.name ?? "Unknown") : "—");
  const managers = [...c.reportingManagerIds.map(person), ...(c.reportingManagerNote ? [c.reportingManagerNote] : [])];
  const reason = s.reasons.find((r) => r.id === c.reasonId)?.name ?? null;
  const skips = s.skipsFor(c.id);

  // What this person may do, at this step, on THIS case.
  const canReview = c.status === "manager_review" && s.canActOn("manager_review", c);
  const canVerify = c.status === "hr_review" && s.canActOn("hr_verification", c);
  const canDecide = c.status === "head_approval" && s.canActOn("hr_head_approval", c);
  // The LWD is confirmable once the HR Head has approved, and RE-confirmable for as
  // long as the case is still in its clearance phase — HR agrees a date, and then it
  // changes. Moving it re-dates everything and rebuilds nothing (the RPC's seed is
  // guarded by `if count = 0`), which is exactly why it stays available.
  const canConfirmLwd = c.status === "clearance" && s.canActOn("lwd_confirm", c);
  const canHold = s.isProcessCoordinator;
  // Skipping a step is the HR Head's / a coordinator's call — the same rule the RPC uses.
  const canSkip = s.isProcessCoordinator || s.isStepOwner("hr_head_approval");
  // Mirrors fms_exit_withdraw_case: the employee, the raiser, or HR / a coordinator /
  // an admin — and only while the money has not moved. The reporting manager is
  // deliberately NOT on that list: it is not their resignation to retract.
  const canWithdraw =
    !c.fnfPaidAt &&
    !c.archivedAt &&
    !["withdrawn", "rejected", "archived"].includes(c.status) &&
    (c.employeeUserId === user.id ||
      c.raisedBy === user.id ||
      s.isProcessCoordinator ||
      s.isStepOwner("hr_verification"));

  // The step whose clock is currently running. Once the LWD exists, several run at
  // once — so the strip shows the clearance clock, which is the earliest thing the
  // case still owes across eight departments.
  const dueStep: StepKey | null =
    c.status === "manager_review"
      ? "manager_review"
      : c.status === "hr_review"
        ? "hr_verification"
        : c.status === "head_approval"
          ? "hr_head_approval"
          : c.status === "clearance"
            ? c.lwd
              ? "clearance"
              : "lwd_confirm"
            : null;

  const days = s.daysToLwd(c);
  const openLetter = async () => {
    if (!c.resignationLetterPath) return;
    const url = await exitDocUrl(c.resignationLetterPath);
    if (url) window.open(url, "_blank", "noopener");
  };

  return (
    <div className="space-y-5">
      {/* ---- Header ---- */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-[22px] font-bold text-navy">{c.exitNo}</h1>
            <StatusPill status={c.status} />
            {c.raisedOnBehalf && (
              <span className="rounded-full bg-page px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-grey-2">
                On behalf
              </span>
            )}
          </div>
          <p className="mt-1 text-[13.5px] text-grey-2">
            {c.employeeName} · {c.employeeCode} · {dept} · {CASE_TYPE_LABEL[c.caseType]}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canReview && <Button size="sm" onClick={() => setReviewing(true)}>Record your review</Button>}
          {canVerify && <Button size="sm" onClick={() => setVerifying(true)}>HR verification</Button>}
          {canDecide && <Button size="sm" onClick={() => setDeciding(true)}>HR Head decision</Button>}
          {canConfirmLwd && (
            <Button size="sm" variant={c.lwd ? "ghost" : undefined} onClick={() => setConfirmingLwd(true)}>
              {c.lwd ? "Change the last working day" : "Confirm the last working day"}
            </Button>
          )}
          {canWithdraw && (
            <Button size="sm" variant="ghost" onClick={() => setHoldMode("withdraw")}>
              Withdraw
            </Button>
          )}
          {canHold && c.status === "on_hold" && (
            <Button size="sm" variant="ghost" onClick={() => setHoldMode("resume")}>
              Take off hold
            </Button>
          )}
          {canHold && !["on_hold", "withdrawn", "rejected", "archived"].includes(c.status) && (
            <Button size="sm" variant="ghost" onClick={() => setHoldMode("hold")}>
              Hold
            </Button>
          )}
          {canSkip && s.isOpenCase(c) && (
            <Button size="sm" variant="ghost" onClick={() => setSkipping(true)}>
              Skip a step
            </Button>
          )}
        </div>
      </div>

      {/* ---- THE LAST WORKING DAY — the hero. Seven SLAs hang off it. ---- */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-grey">
              {c.lwd ? "Last working day" : "Proposed last working day"}
            </div>
            <div className="mt-1 flex items-center gap-2.5">
              <span className="text-[26px] font-bold leading-none text-navy">
                {c.lwd ? formatDateDMY(c.lwd) : c.proposedLwd ? formatDateDMY(c.proposedLwd) : "Not set yet"}
              </span>
              {c.lwd && days !== null && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                    days < 0
                      ? "bg-page text-grey-2"
                      : days <= 3
                        ? "bg-[#FDECEC] text-ryg-red"
                        : days <= 7
                          ? "bg-[#FFF7E6] text-yellow"
                          : "bg-[#E9F7EF] text-ryg-green"
                  }`}
                >
                  {days < 0 ? `${-days}d ago` : days === 0 ? "Today" : `${days}d to go`}
                </span>
              )}
              {!c.lwd && c.proposedLwd && (
                <span className="rounded-full bg-page px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-grey-2">
                  Not confirmed
                </span>
              )}
            </div>
            <p className="mt-1.5 max-w-xl text-[12px] leading-snug text-grey-2">
              Clearance, the asset return, the handover, the exit interview, leave, payroll and the F&amp;F are all
              dated from this one day. It is confirmed after the HR Head approves.
            </p>
          </div>

          {dueStep && (
            <div className="text-right">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-grey">Next step due</div>
              <div className="mt-1 text-[14px]">
                <DueCell dueIso={s.dueIsoFor(c, dueStep)} />
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* ---- Where it is ---- */}
      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-semibold text-navy">Progress</h2>
        <ExitStepper case={c} skips={skips} />

        {c.status === "on_hold" && c.holdReason && (
          <div className="rounded-xl border border-line bg-page px-4 py-3">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-grey">On hold</div>
            <p className="mt-1 text-[13px] text-navy">{c.holdReason}</p>
          </div>
        )}
        {c.status === "rejected" && c.rejectReason && (
          <div className="rounded-xl border border-ryg-red/30 bg-[#FDECEC]/50 px-4 py-3">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-ryg-red">Rejected</div>
            <p className="mt-1 text-[13px] text-navy">{c.rejectReason}</p>
          </div>
        )}
        {c.status === "withdrawn" && c.withdrawReason && (
          <div className="rounded-xl border border-line bg-page px-4 py-3">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-grey">Withdrawn</div>
            <p className="mt-1 text-[13px] text-navy">{c.withdrawReason}</p>
          </div>
        )}

        {skips.length > 0 && (
          <div className="rounded-xl border border-line bg-page px-4 py-3">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-grey">Steps waived</div>
            <ul className="mt-1.5 space-y-1">
              {skips.map((k) => (
                <li key={k.stepKey} className="text-[13px] text-navy">
                  <span className="font-semibold">{k.stepKey.replace(/_/g, " ")}</span> — {k.reason}
                  <span className="ml-1.5 text-[12px] text-grey-2">({person(k.skippedBy)})</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* ---- The case ---- */}
      <Card className="space-y-5 p-5">
        <h2 className="text-[15px] font-semibold text-navy">The case</h2>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Employee" value={c.employeeName} />
          <Field label="Employee code" value={c.employeeCode} />
          <Field label="Department" value={dept} />
          <Field label="Designation" value={c.designation} />
          <Field label="Date of joining" value={formatDateDMY(c.dateOfJoining)} />
          <Field label="Raised by" value={person(c.raisedBy)} />
          <Field label="Raised on" value={formatDateDMY(c.submittedAt)} />
          <Field label="Reporting manager" value={managers.join(", ")} />
          <Field label="Notice period" value={noticeLabel(c.noticePeriodDays, c.noticeWaived)} />
          <Field label="Reason" value={reason} />
          {!c.policyApplicable && <Field label="Policy does not apply" value={c.policyNaReason} />}
          {c.resignationLetterPath && (
            <Field label="Resignation letter">
              <button type="button" onClick={openLetter} className="font-semibold text-orange hover:underline">
                {c.resignationLetterName ?? "Open"}
              </button>
            </Field>
          )}
        </div>

        {c.reasonNote && <Field label="Notes" value={c.reasonNote} />}
      </Card>

      {/* ---- The approval chain. Each panel is a READOUT — the buttons are up top. ---- */}
      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-semibold text-navy">Approvals</h2>

        <SectionHeading>Reporting manager</SectionHeading>
        {c.managerReviewedAt ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Recommendation">
              {c.managerRecommendation && (
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${RECOMMENDATION_CLASS[c.managerRecommendation]}`}
                >
                  {RECOMMENDATION_LABEL[c.managerRecommendation]}
                </span>
              )}
            </Field>
            <Field label="Reviewed by" value={person(c.managerReviewerId)} />
            <Field label="On" value={formatDateDMY(c.managerReviewedAt)} />
            {c.managerRemarks && <Field className="sm:col-span-3" label="Remarks" value={c.managerRemarks} />}
          </div>
        ) : (
          <p className="text-[13px] text-grey-2">
            Waiting on {managers.join(", ") || "the reporting manager"}. Their answer is a recommendation — the
            case advances either way.
          </p>
        )}

        <SectionHeading>HR verification</SectionHeading>
        {c.hrVerifiedAt ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Verified by" value={person(c.hrVerifierId)} />
            <Field label="On" value={formatDateDMY(c.hrVerifiedAt)} />
            <Field label="Proposed last working day" value={formatDateDMY(c.proposedLwd)} />
            {c.hrRemarks && <Field className="sm:col-span-3" label="Remarks" value={c.hrRemarks} />}
          </div>
        ) : (
          <p className="text-[13px] text-grey-2">Not verified yet.</p>
        )}

        <SectionHeading>HR Head</SectionHeading>
        {c.approvedAt || c.rejectedAt ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Decision" value={c.approvedAt ? "Approved" : "Rejected"} />
            <Field label="By" value={person(c.approverId)} />
            <Field label="On" value={formatDateDMY(c.approvedAt ?? c.rejectedAt)} />
            {c.approvalRemarks && (
              <Field className="sm:col-span-3" label="Remarks" value={c.approvalRemarks} />
            )}
          </div>
        ) : (
          <p className="text-[13px] text-grey-2">
            Not decided yet. The HR Head is the only person who can stop this exit.
          </p>
        )}
      </Card>

      {/* ---- Clearance, then the asset return, then the handover — IN STEP ORDER
              (6, 7, 8). All three only once the case has been approved: before that
              none of them exists and none of them can, because every one is dated from
              a last working day nobody has confirmed.

              The asset return and the handover are steps AND clearance rows, and that
              is deliberate: each carries TWO signatures (HOD/manager, then HR), which
              a checklist tick — one actor, one box — simply cannot hold. Completing
              either STEP auto-ticks its matching clearance ROWS above, so Admin, IT and
              the reporting manager are never asked to sign the same thing twice. ---- */}
      {c.approvedAt && (
        <>
          <ClearancePanel case={c} />
          <AssetPanel case={c} />
          <HandoverPanel case={c} />

          {/* ---- ⭐⭐ THE EXIT INTERVIEW (step 9) — THE CONFIDENTIAL SATELLITE.

                  The PANEL renders for admins, process coordinators and HR-confidential
                  staff (the owners of hr_verification / hr_head_approval /
                  exit_interview) — `canReadConfidential`, which mirrors the SQL gate on
                  fms_exit_interviews EXACTLY.

                  ⚠ EVERYONE ELSE GETS THE CHIP BELOW AND NOTHING ELSE — the reporting
                    manager, the employee, and the IT / Admin / Travel-Desk clearance
                    owners (who are exit staff, and read every other panel on this page).
                    An exit interview exists to say things ABOUT the manager; if the
                    manager can read it, it is a performance review with extra steps.

                  ⚠ THE CHIP READS `c.interviewDoneAt` — the FACT, on the wide-read case
                    HEADER — and NEVER `s.interviewFor(c.id)`. A non-reader gets zero rows
                    back from RLS, so deriving the chip from the satellite would render
                    "Not yet" over an interview that was held last Tuesday. "I cannot see
                    it" and "it did not happen" are different facts, and papering over the
                    first with the second is how a leak gets hidden behind a lie. ---- */}
          {s.canReadConfidential ? (
            <ExitInterviewPanel case={c} />
          ) : (
            <Card className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-[15px] font-semibold text-navy">Exit interview</h2>
                  <p className="mt-0.5 max-w-2xl text-[12.5px] text-grey-2">
                    Held by HR, and confidential to them. You can see whether it has happened; what was
                    said is not shown to anyone outside HR.
                  </p>
                </div>
                {c.interviewDoneAt ? (
                  <span className="rounded-full bg-[#E9F7EF] px-2.5 py-1 text-[11.5px] font-semibold text-ryg-green">
                    Recorded ✓
                  </span>
                ) : (
                  <span className="rounded-full bg-page px-2.5 py-1 text-[11.5px] font-semibold text-grey-2">
                    Not yet
                  </span>
                )}
              </div>
            </Card>
          )}

          {/* ---- ⭐⭐ THE SETTLEMENT (steps 10–14) — THE SECOND CONFIDENTIAL SATELLITE.

                  The PANEL renders for admins, process coordinators, finance staff (the
                  owners of leave_verification / payroll_inputs / fnf_*) — and for THE
                  EMPLOYEE THEMSELVES, but only once the F&F has been approved. That is
                  `canReadSettlement(c)`, which mirrors the SQL gate on
                  fms_exit_settlements EXACTLY, including its one time-dependent clause.

                  ⚠ EVERYONE ELSE GETS THE CHIPS BELOW AND NOTHING ELSE — above all THE
                    REPORTING MANAGER, who is on no clause of that gate at any stage. A
                    manager has no business reading a subordinate's notice recovery or
                    loan balance. Nor may the IT / Admin / Travel-Desk clearance owners,
                    who are exit staff and read every other panel on this page.

                  ⚠ THE CHIPS READ THE HEADER STAMPS (`fnfGeneratedAt` / `fnfApprovedAt` /
                    `fnfPaidAt`) — the FACTS, on the wide-read case row — and NEVER
                    `s.settlementFor(c.id)`. A non-reader gets zero rows back from RLS, so
                    deriving them from the satellite would render "Not yet" over an F&F
                    that was paid last Tuesday. "I cannot see it" and "it did not happen"
                    are different facts. ---- */}
          {s.canReadSettlement(c) ? (
            <SettlementPanel case={c} />
          ) : (
            <Card className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-[15px] font-semibold text-navy">Settlement (Full &amp; Final)</h2>
                  <p className="mt-0.5 max-w-2xl text-[12.5px] text-grey-2">
                    Handled by payroll and accounts, and confidential to them. You can see how far it has
                    got; the figures are not shown to anyone outside finance.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { label: "Prepared", at: c.fnfGeneratedAt },
                    { label: "Approved", at: c.fnfApprovedAt },
                    { label: "Paid", at: c.fnfPaidAt },
                  ].map((x) => (
                    <span
                      key={x.label}
                      className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${
                        x.at ? "bg-[#E9F7EF] text-ryg-green" : "bg-page text-grey-2"
                      }`}
                    >
                      {x.label} {x.at ? "✓" : "—"}
                    </span>
                  ))}
                </div>
              </div>
            </Card>
          )}

          {/* ---- ⭐⭐⭐ CLOSURE (steps 15–16) — THE TERMINAL PANEL, AND IT IS NOT
                  CONFIDENTIAL.

                  Rendered for EVERYONE who can read the case, unlike the two satellites
                  above it: an exit document is not a salary figure and not an interview
                  transcript. The EMPLOYEE reads it — they are their letters — and the
                  reporting manager sees that the process finished. It is READ-ONLY unless
                  `canActOn('documents' | 'archive', case)`, exactly like every other panel.

                  ⚠ The archive's blocker checklist inside is fetched from
                    `fms_exit_archive_blockers()` and NOT computed here, because one of its
                    five conditions reads `fms_exit_settlements.final_fnf_path` — which the
                    `documents`/`archive` step owner CANNOT read (they are exit staff, not
                    finance staff). A client-side checklist would swear the final F&F copy
                    was missing while it sat right there. ---- */}
          <DocumentsPanel case={c} />
        </>
      )}

      {/* ---- History ---- */}
      <Card className="p-5">
        <h2 className="text-[15px] font-semibold text-navy">History</h2>
        <ul className="mt-3 space-y-2.5">
          {s.activityFor("case", c.id).length === 0 && (
            <li className="text-[13px] text-grey-2">Nothing recorded yet.</li>
          )}
          {[...s.activityFor("case", c.id)]
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

      <Link to="/hr-exit/exits" className="inline-block text-[12.5px] font-semibold text-grey-2 hover:text-navy">
        ← All exit cases
      </Link>

      {reviewing && <ManagerReviewModal case={c} open={reviewing} onClose={() => setReviewing(false)} />}
      {verifying && <HrVerifyModal case={c} open={verifying} onClose={() => setVerifying(false)} />}
      {deciding && <HeadDecisionModal case={c} open={deciding} onClose={() => setDeciding(false)} />}
      {confirmingLwd && (
        <ConfirmLwdModal case={c} open={confirmingLwd} onClose={() => setConfirmingLwd(false)} />
      )}
      {holdMode && (
        <HoldWithdrawModal case={c} mode={holdMode} open={!!holdMode} onClose={() => setHoldMode(null)} />
      )}
      {skipping && <SkipStepModal case={c} open={skipping} onClose={() => setSkipping(false)} />}
    </div>
  );
}
