import { useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import EmptyState from "@/shared/components/ui/EmptyState";
import { Field } from "@/shared/components/ui/Readout";
import { formatDateDMY } from "@/shared/lib/date";
import ExitStepper from "../../components/ExitStepper";
import StatusPill from "../../components/StatusPill";
import { HoldWithdrawModal } from "../../components/ExitModals";
import SettlementPanel from "../../components/settlement/SettlementPanel";
import { useExitStore } from "../../store";
import { exitDocUrl } from "../../data/exitWrites";
import { CASE_TYPE_LABEL, noticeLabel } from "../../lib/format";

/**
 * The employee's own exit — the other ungated screen.
 *
 * Read-only, plus one action: **withdraw**.
 *
 * ⭐ **AND ONE THING THEY ARE ENTITLED TO: THEIR OWN SETTLEMENT, ONCE IT IS APPROVED.**
 *   `store.canReadSettlement(c)` mirrors the SQL gate exactly, including its one
 *   time-dependent clause — the leaver reads their own F&F only after `fnfApprovedAt` is
 *   stamped. Before that they get the status chips and nothing more: they are entitled to
 *   the statement, not to watch the numbers being keyed. The panel renders read-only for
 *   them (they can act on no step, so every block is a readout), and it is where they open
 *   their copy of the final F&F from `share/`.
 *
 * The exit interview is NOT here at any stage, and never will be: they are not on its
 * read gate. Only the FACT that a step happened is on this page, from the case header.
 *
 * There is at most one OPEN case per person — the database guarantees it with a
 * partial unique index on the employee code.
 */
/** A 10-minute signed URL, opened in a new tab. Nothing in this bucket is ever public. */
async function openDoc(path: string) {
  const url = await exitDocUrl(path);
  if (url) window.open(url, "_blank", "noreferrer");
}

export default function MyExit() {
  const s = useExitStore();
  const [withdrawing, setWithdrawing] = useState(false);

  const c = s.myCase;
  if (s.isLoading) return <p className="text-[13.5px] text-grey-2">Loading…</p>;

  if (!c) {
    return (
      <EmptyState
        title="You have no exit on record"
        message="If you are resigning, raise it here. It goes to your reporting manager first — their answer is a recommendation, not a veto."
        actionLabel="Resign / Raise an exit"
        actionTo="/hr-exit/exits/new"
      />
    );
  }

  const dept = s.departments.find((d) => d.id === c.departmentId)?.name ?? "—";
  const managers = [
    ...c.reportingManagerIds.map((uid) => s.profileById(uid)?.name ?? "Unknown"),
    ...(c.reportingManagerNote ? [c.reportingManagerNote] : []),
  ];
  const reason = s.reasons.find((r) => r.id === c.reasonId)?.name ?? null;
  const days = s.daysToLwd(c);
  const docs = s.documentsFor(c.id);

  // The employee may always retract — right up until the F&F has actually been paid.
  const canWithdraw =
    !c.fnfPaidAt && !c.archivedAt && !["withdrawn", "rejected", "archived"].includes(c.status);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-[22px] font-bold text-navy">My resignation</h1>
            <StatusPill status={c.status} />
          </div>
          <p className="mt-1 text-[13.5px] text-grey-2">
            {c.exitNo} · {CASE_TYPE_LABEL[c.caseType]} · raised {formatDateDMY(c.submittedAt)}
          </p>
        </div>
        {canWithdraw && (
          <Button size="sm" variant="ghost" onClick={() => setWithdrawing(true)}>
            I've changed my mind — withdraw
          </Button>
        )}
      </div>

      <Card className="p-5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-grey">
          {c.lwd ? "Your last working day" : "Proposed last working day"}
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
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-semibold text-navy">Where it has got to</h2>
        <ExitStepper case={c} skips={s.skipsFor(c.id)} />

        {c.status === "rejected" && c.rejectReason && (
          <div className="rounded-xl border border-ryg-red/30 bg-[#FDECEC]/50 px-4 py-3">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-ryg-red">Rejected</div>
            <p className="mt-1 text-[13px] text-navy">{c.rejectReason}</p>
          </div>
        )}
        {c.status === "on_hold" && c.holdReason && (
          <div className="rounded-xl border border-line bg-page px-4 py-3">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-grey">On hold</div>
            <p className="mt-1 text-[13px] text-navy">{c.holdReason}</p>
          </div>
        )}
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-semibold text-navy">What you told us</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Employee code" value={c.employeeCode} />
          <Field label="Department" value={dept} />
          <Field label="Designation" value={c.designation} />
          <Field label="Date of joining" value={formatDateDMY(c.dateOfJoining)} />
          <Field label="Reporting manager" value={managers.join(", ")} />
          <Field label="Notice period" value={noticeLabel(c.noticePeriodDays, c.noticeWaived)} />
          <Field label="Reason" value={reason} />
        </div>
        {c.reasonNote && <Field label="Notes" value={c.reasonNote} />}
      </Card>

      {/* ---- ⭐⭐ YOUR DOCUMENTS — the whole reason the `share/` prefix exists.
              `cases/<id>/share/…` is the ONE prefix in the bucket the exiting employee may
              read (M2's storage policy joins fms_exit_cases on employee_user_id). The
              relieving letter, the experience letter, the F&F statement and the copy they
              signed all live there. Everything else in the bucket — the exit-interview
              notes, the F&F working, every other person's case — is invisible to them, and
              a signed URL for it 403s.

              `documentsFor` is safe to read here, unlike `settlementFor` / `interviewFor`:
              fms_exit_documents follows the WIDE gate, so an EMPTY LIST really does mean
              "nothing has been issued yet". ---- */}
      {docs.length > 0 && (
        <Card className="space-y-4 p-5">
          <div>
            <h2 className="text-[15px] font-semibold text-navy">Your documents</h2>
            <p className="mt-0.5 text-[12.5px] text-grey-2">
              Yours to keep. Download them now — you will want them for your next employer's background
              check, and they are easier to find here than in an email from two years ago.
            </p>
          </div>
          <ul className="space-y-2">
            {docs.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white px-3.5 py-2.5"
              >
                <div>
                  <div className="text-[13.5px] font-medium text-navy">{d.name}</div>
                  <div className="text-[12px] text-grey-2">
                    {d.issuedOn ? `Issued ${formatDateDMY(d.issuedOn)}` : "Not issued yet"}
                    {d.handedOverOn && ` · you signed for it on ${formatDateDMY(d.handedOverOn)}`}
                  </div>
                </div>
                {d.filePath ? (
                  <button
                    type="button"
                    onClick={() => void openDoc(d.filePath!)}
                    className="text-[12.5px] font-semibold text-orange hover:underline"
                  >
                    {d.fileName ?? "Open"} →
                  </button>
                ) : (
                  <span className="text-[12.5px] text-grey-2">—</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ---- ⭐ YOUR SETTLEMENT — and your own copy of the final F&F, from `share/`.
              `canReadSettlement(c)` mirrors the SQL gate exactly, including its one
              time-dependent clause: the leaver reads their own F&F ONLY once it has been
              APPROVED. Before that they get the status chips on the stepper and nothing
              more — they are entitled to the statement, not to watch the numbers being
              keyed. The panel renders entirely read-only for them: they can act on no step,
              so every block is a readout. ---- */}
      {s.canReadSettlement(c) && <SettlementPanel case={c} />}

      <Link to="/hr-exit" className="inline-block text-[12.5px] font-semibold text-grey-2 hover:text-navy">
        ← Back
      </Link>

      {withdrawing && (
        <HoldWithdrawModal case={c} mode="withdraw" open={withdrawing} onClose={() => setWithdrawing(false)} />
      )}
    </div>
  );
}
