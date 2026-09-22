import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { useLdStore } from "../../store";
import { B } from "../../nav";
import { dmy, inr } from "../../lib/format";
import StatusPill, { PriorityPill } from "../../components/StatusPill";
import { railStepsFor, stepOf } from "../../lib/queues";
import { stepByKey } from "../../lib/steps";
import StepActionPanel from "../../components/StepActionPanel";
import DocField from "../../components/DocField";
import NotFound from "../system/NotFound";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-1.5">
      <span className="w-44 shrink-0 text-[12.5px] text-grey-2">{label}</span>
      <span className="text-[13.5px] text-navy">{children}</span>
    </div>
  );
}

/**
 * One training request, its rail, and whatever the reader can do about it.
 *
 * ⚠ THE RAIL IS BUILT PER REQUEST, not from the global step list. Management
 *   approval is conditional, so a request that skipped it shows seven steps and
 *   not eight with one mysteriously blank — `railStepsFor` reads the FROZEN
 *   `mgmtRequired`, never the live rule.
 */
export default function RequestDetail() {
  const { id = "" } = useParams();
  const s = useLdStore();
  const nav = useNavigate();
  const [busyErr, setBusyErr] = useState<string | null>(null);

  const r = s.requestById(id);
  if (!s.loading && !r) return <NotFound />;
  if (!r) return <div className="p-6 text-[13.5px] text-grey-2">Loading…</div>;

  const current = stepOf(r);
  const rail = railStepsFor(r);
  const trainer = (s.data?.trainers ?? []).find((t) => t.id === r.trainerId);
  const session = s.sessions.find((x) => x.requestId === r.id);
  const needSource = (s.data?.needSources ?? []).find((n) => n.id === r.needSourceId);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-bold text-navy">{r.code ?? "Draft request"}</h1>
            <StatusPill status={r.status} />
            <PriorityPill priority={r.priority} />
          </div>
          <p className="text-[14px] text-navy mt-1">{r.title}</p>
        </div>
        <Button variant="ghost" onClick={() => nav(-1)}>Back</Button>
      </div>

      {/* The rail. Each cleared step is named with who and when, so the page
          answers "where is this?" without anybody opening the activity trail. */}
      <Card className="p-5">
        <div className="flex flex-wrap gap-2">
          {rail.map((key) => {
            const def = stepByKey(key);
            const isNow = key === current;
            const done = !isNow && rail.indexOf(key) < rail.indexOf(current ?? rail[rail.length - 1]);
            return (
              <span
                key={key}
                className={
                  "rounded-full px-3 py-1 text-[12px] font-medium " +
                  (isNow
                    ? "bg-orange text-white"
                    : done
                      ? "bg-[#E8F7EE] text-ryg-green"
                      : "bg-[#F1F4F9] text-grey-2")
                }
              >
                {def?.short ?? key}
              </span>
            );
          })}
          {!r.mgmtRequired && r.mgmtRequired !== null && (
            // Say the gate was skipped. An audit that simply omits it cannot tell
            // "never needed" from "quietly bypassed".
            <span className="rounded-full bg-[#F1F4F9] px-3 py-1 text-[12px] text-grey-2">
              Management approval not required
            </span>
          )}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1.4fr,1fr]">
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold text-navy mb-2">The need</h2>
          <Row label="Raised by">{s.personName(r.requestedBy)}</Row>
          <Row label="Department">{s.departmentName(r.departmentId)}</Row>
          <Row label="Source">{needSource?.name ?? "—"}</Row>
          <Row label="Submitted">{dmy(r.submittedAt)}</Row>
          <Row label="Needed by">{dmy(r.requiredBy)}</Row>
          <Row label="Who it is for">{r.targetGroup ?? "—"}</Row>
          <Row label="The gap">{r.skillGap ?? "—"}</Row>
          <Row label="Expected outcome">{r.objective ?? "—"}</Row>

          {r.returnReason && (
            <div className="mt-3 rounded-lg bg-[#FFF7E6] px-3 py-2 text-[13px] text-navy">
              <strong>Sent back:</strong> {r.returnReason}
              <span className="text-grey-2"> · {dmy(r.returnedAt)}</span>
            </div>
          )}
          {r.rejectReason && (
            <div className="mt-3 rounded-lg bg-[#FDECEC] px-3 py-2 text-[13px] text-navy">
              <strong>Rejected:</strong> {r.rejectReason}
              <span className="text-grey-2"> · {dmy(r.rejectedAt)}</span>
            </div>
          )}
        </Card>

        <div className="space-y-5">
          {(r.proposedAt || r.validatedAt) && (
            <Card className="p-5">
              <h2 className="text-[15px] font-semibold text-navy mb-2">Proposal &amp; approval</h2>
              <Row label="Validated by">{s.personName(r.validatedBy)}</Row>
              <Row label="Proposed cost">{inr(r.proposedCost)}</Row>
              <Row label="Approved budget">{inr(r.approvedBudget)}</Row>
              {r.proposalPath && (
                <Row label="Proposal">
                  <DocField path={r.proposalPath} disabled onUpload={async () => {}} />
                </Row>
              )}
              <Row label="HR Head">
                {r.hrApprovedAt
                  ? `${s.personName(r.hrApprovedBy)} · ${dmy(r.hrApprovedAt)}`
                  : "—"}
              </Row>
              <Row label="Management">
                {r.mgmtRequired === false
                  ? "Not required"
                  : r.mgmtApprovedAt
                    ? `${s.personName(r.mgmtApprovedBy)} · ${dmy(r.mgmtApprovedAt)}`
                    : "—"}
              </Row>
            </Card>
          )}

          {trainer && (
            <Card className="p-5">
              <h2 className="text-[15px] font-semibold text-navy mb-2">Trainer</h2>
              <Row label="Name">{trainer.name}</Row>
              <Row label="Type">{trainer.trainerType === "internal" ? "Internal" : "External agency"}</Row>
              {trainer.agency && <Row label="Agency">{trainer.agency}</Row>}
              <Row label="Terms">{r.trainerTerms ?? "—"}</Row>
              {r.quotationPath && (
                <Row label="Quotation">
                  <DocField path={r.quotationPath} disabled onUpload={async () => {}} />
                </Row>
              )}
            </Card>
          )}

          {session && (
            <Card className="p-5">
              <h2 className="text-[15px] font-semibold text-navy mb-2">Session</h2>
              <Row label="Reference">{session.code ?? "—"}</Row>
              <Row label="Date">{dmy(session.sessionDate)}</Row>
              <Row label="Capacity">{session.capacity ?? "—"}</Row>
              <Link to={`${B}/calendar`} className="text-[13px] font-medium text-orange hover:underline">
                See it on the calendar
              </Link>
            </Card>
          )}
        </div>
      </div>

      {busyErr && (
        <p className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#B42318]">{busyErr}</p>
      )}

      {current && (
        <StepActionPanel request={r} step={current} onError={setBusyErr} />
      )}
    </div>
  );
}
