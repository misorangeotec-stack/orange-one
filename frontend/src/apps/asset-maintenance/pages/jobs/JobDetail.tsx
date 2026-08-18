import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import { Field, SectionHeading } from "@/shared/components/ui/Readout";
import { formatDateTime } from "@/shared/lib/time";
import { useAssetStore } from "../../store";
import StatusPill from "../../components/StatusPill";
import StepModal from "../../components/StepModal";
import JobStepper from "../../components/JobStepper";
import DocLink from "../../components/DocLink";
import { openStep, isOverdue, type QueueStep } from "../../lib/queues";
import { dmy, duePhrase, inr, SOURCE_LABEL } from "../../lib/format";

/**
 * One service job. The progress rail is FIRST — the standing rule across every FMS.
 */
export default function JobDetail() {
  const { id = "" } = useParams();
  const s = useAssetStore();
  const job = s.jobById(id);

  const [acting, setActing] = useState<QueueStep | null>(null);
  const [exitOpen, setExitOpen] = useState<null | "hold" | "cancel" | "skip">(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activity = useMemo(() => (job ? s.activityFor("job", job.id) : []), [job, s]);

  if (s.isLoading) return <p className="text-[13.5px] text-grey-2">Loading…</p>;
  if (!job) return <p className="text-[13.5px] text-grey-2">That service job no longer exists.</p>;

  const asset = s.assetById(job.assetId);
  const step = openStep(job);
  const overdue = isOverdue(job, s.todayIso);

  const runExit = async () => {
    if (!exitOpen) return;
    setBusy(true); setError(null);
    try {
      if (exitOpen === "hold") await s.holdJob(job.id, reason);
      if (exitOpen === "cancel") await s.cancelJob(job.id, reason);
      if (exitOpen === "skip") await s.skipJob(job.id, reason);
      setExitOpen(null); setReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-bold text-navy">{job.jobNo}</h1>
            <StatusPill status={job.status} />
            {overdue && (
              <span className="rounded-full bg-[#FDECEC] px-2.5 py-0.5 text-[11.5px] font-semibold text-ryg-red">
                {duePhrase(job.dueDate, s.todayIso)}
              </span>
            )}
          </div>
          <p className="mt-1 text-[13.5px] text-grey-2">
            {s.scheduleTypeName(job.scheduleTypeId)} ·{" "}
            <Link to={`/asset-maintenance/assets/${job.assetId}`} className="hover:text-orange">
              {s.assetLabel(job.assetId)}
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {step && s.canActOn(step, job) && (
            <Button size="sm" onClick={() => setActing(step)}>
              {step === "schedule" ? "Schedule" : step === "service_done" ? "Record service" : "Verify & close"}
            </Button>
          )}
          {s.canEdit && s.isProcessCoordinator && job.status === "on_hold" && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={async () => {
              setBusy(true);
              try { await s.resumeJob(job.id); } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
              finally { setBusy(false); }
            }}>Resume</Button>
          )}
          {s.canEdit && s.isProcessCoordinator && !!step && (
            <>
              <Button variant="ghost" size="sm" onClick={() => setExitOpen("hold")}>Hold</Button>
              <Button variant="ghost" size="sm" onClick={() => setExitOpen("skip")}>Skip</Button>
              <Button variant="ghost" size="sm" onClick={() => setExitOpen("cancel")}>Cancel</Button>
            </>
          )}
        </div>
      </div>

      {error && <p className="text-[13px] font-medium text-ryg-red">{error}</p>}

      {/* Progress block ALWAYS first. */}
      <Card className="p-5">
        <JobStepper job={job} />
      </Card>

      {job.holdReason && (
        <p className="rounded-lg bg-[#FEF6E0] px-3 py-2 text-[12.5px] text-[#946200]">
          On hold — {job.holdReason}
        </p>
      )}
      {job.cancelReason && (
        <p className="rounded-lg bg-[#FDECEC] px-3 py-2 text-[12.5px] text-ryg-red">
          Cancelled — {job.cancelReason}. The asset's schedule is unchanged.
        </p>
      )}
      {job.skippedReason && (
        <p className="rounded-lg bg-[#EEF1F6] px-3 py-2 text-[12.5px] text-grey">
          Skipped — {job.skippedReason}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="space-y-4 p-5 lg:col-span-2">
          <SectionHeading>What happened</SectionHeading>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Scheduled on" value={dmy(job.scActualDate)} />
            <Field label="Planned for" value={dmy(job.scPlannedDate)} />
            <Field label="Booked with" value={s.vendorName(job.scVendorId)} />

            <Field label="Carried out on" value={dmy(job.sdActualDate)} />
            <Field label="Done by" value={s.vendorName(job.sdVendorId)} />
            <Field label="Cost" value={inr(job.sdCost)} />
            <Field label="Cost head" value={s.masterName("cost_head", job.sdCostHeadId)} />
            <Field label="Bill no." value={job.sdBillNo ?? "—"} />
            <Field label="Meter reading" value={job.sdMeterReading === null ? "—" : String(job.sdMeterReading)} />

            <Field label="Verified on" value={dmy(job.vcActualDate)} />
            <Field
              label="Outcome"
              value={job.vcOutcome === "satisfactory" ? "Satisfactory"
                : job.vcOutcome === "rework_needed" ? "Rework needed" : "—"}
            />
            {job.vcNewDueDate && <Field label="New expiry recorded" value={dmy(job.vcNewDueDate)} />}
            {job.vcNewRefNo && <Field label="New reference" value={job.vcNewRefNo} />}
            {job.vcNewAmount !== null && <Field label="New premium / fee" value={inr(job.vcNewAmount)} />}

            {job.scRemarks && <Field label="Scheduling remarks" value={job.scRemarks} className="sm:col-span-3" />}
            {job.sdRemarks && <Field label="What was done" value={job.sdRemarks} className="sm:col-span-3" />}
            {job.vcRemarks && <Field label="Verification remarks" value={job.vcRemarks} className="sm:col-span-3" />}
          </div>

          {job.sdBillPath && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-grey">Service bill</div>
              <div className="mt-1"><DocLink path={job.sdBillPath} name={job.sdBillName} /></div>
            </div>
          )}
        </Card>

        <Card className="space-y-4 p-5">
          <SectionHeading>The job</SectionHeading>
          <div className="grid gap-4">
            <Field label="Asset" value={asset ? `${asset.assetNo} ${asset.name}` : "—"} />
            <Field label="Serial / reg. no." value={asset?.serialNo ?? "—"} />
            <Field label="Custodian" value={s.personName(asset?.custodianUserId ?? null)} />
            <Field label="Location" value={s.masterName("location", asset?.locationId ?? null)} />
            <Field label="Service due" value={dmy(job.dueDate)} />
            <Field label="Raised" value={`${SOURCE_LABEL[job.raisedSource]} · ${formatDateTime(job.createdAt)}`} />
            {job.closedAt && <Field label="Closed" value={formatDateTime(job.closedAt)} />}
          </div>
        </Card>
      </div>

      {activity.length > 0 && (
        <Card className="p-5">
          <SectionHeading>Activity</SectionHeading>
          <ul className="mt-3 space-y-2 text-[13px]">
            {activity.map((a) => (
              <li key={a.id} className="flex gap-2">
                <span className="w-36 shrink-0 text-grey-2">{formatDateTime(a.createdAt)}</span>
                <span className="text-navy">{a.note ?? a.type}</span>
                <span className="text-grey-2">
                  {/* A reminder is announced by pg_cron, which has no session user. */}
                  · {a.actorId ? s.personName(a.actorId) : "Asset Maintenance"}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {acting && (
        <StepModal stepKey={acting} open onClose={() => setActing(null)} job={job} />
      )}

      <Modal
        open={!!exitOpen}
        onClose={() => setExitOpen(null)}
        title={exitOpen === "hold" ? "Put this job on hold" : exitOpen === "skip" ? "Skip this service" : "Cancel this job"}
        subtitle={job.jobNo}
        footer={
          <>
            <Button variant="ghost" onClick={() => setExitOpen(null)} disabled={busy}>Back</Button>
            <Button onClick={runExit} disabled={busy || !reason.trim()}>
              {busy ? "Saving…" : "Confirm"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-[13px] text-grey">
            {exitOpen === "skip"
              ? "Use skip when this cycle genuinely is not happening — the asset was idle, or the service was waived. The track itself carries on."
              : "The asset's schedule is not changed by this. Only Verify & Close moves a next due date."}
          </p>
          <FieldLabel label="Why" required>
            <TextArea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </FieldLabel>
        </div>
      </Modal>
    </div>
  );
}
