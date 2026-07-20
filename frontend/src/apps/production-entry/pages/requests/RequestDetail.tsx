import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useSession } from "@/core/platform/session";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import { Field, SectionHeading } from "@/shared/components/ui/Readout";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import { formatDate, formatDateTime } from "@/shared/lib/time";
import StepModal from "../../components/StepModal";
import StatusPill from "../../components/StatusPill";
import { dmy, numOrDash, requestSubject } from "../../lib/format";
import { openStep, stepDoneAt, stepDoneBy, type QueueStep } from "../../lib/queues";
import { STEPS } from "../../lib/steps";
import { STEP_CONFIG } from "../../lib/stepConfig";
import { useProductionStore } from "../../store";
import type { ProductionRequest } from "../../types";

type StageState = "done" | "current" | "pending";

function Stage({ title, when, by, detail, state }: { title: string; when: string | null; by: string | null; detail: string | null; state: StageState }) {
  const tone = state === "done" ? "text-ryg-green" : state === "current" ? "text-orange" : "text-grey-2";
  const dot = state === "done" ? "bg-ryg-green" : state === "current" ? "bg-orange" : "bg-line";
  const label = state === "done" ? "Done" : state === "current" ? "In progress" : "Pending";
  return (
    <div className="flex gap-3">
      <div className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13.5px] font-semibold text-navy">{title}</span>
          <span className={`text-[11px] font-semibold uppercase tracking-wide ${tone}`}>{label}</span>
        </div>
        {when && <div className="text-[12.5px] text-grey-2">{formatDate(when)}{by ? ` · ${by}` : ""}</div>}
        {detail && <div className="text-[12.5px] text-grey mt-0.5">{detail}</div>}
      </div>
    </div>
  );
}

/** Short per-step detail line for the progress panel — the captured value(s). */
function stepDetail(step: QueueStep, r: ProductionRequest): string | null {
  switch (step) {
    case "material_handover": return [r.mhStatus, r.mhQty != null ? `Qty ${r.mhQty}` : null, r.rmBookNo ? `RM Book ${r.rmBookNo}` : null].filter(Boolean).join(" · ") || null;
    case "transfer_slip": return [r.tsStatus, r.transferSlipNo ? `Slip ${r.transferSlipNo}` : null, r.batchCardNo ? `Batch ${r.batchCardNo}` : null].filter(Boolean).join(" · ") || null;
    case "production_entry": return [r.peStatus, r.actualQty != null ? `Actual ${r.actualQty}` : null, r.scrapQty != null ? `Scrap ${r.scrapQty}` : null, r.lotNo ? `LOT ${r.lotNo}` : null].filter(Boolean).join(" · ") || null;
    case "quality_check": return [r.qcStatus, r.qcRemarks].filter(Boolean).join(" · ") || null;
    case "mc_testing": return [r.mcStatus, r.mcRemarks].filter(Boolean).join(" · ") || null;
    case "pm_handover": return [r.pmhStatus, r.pmhQty != null ? `Qty ${r.pmhQty}` : null, r.pmhBatchNo ? `Batch ${r.pmhBatchNo}` : null].filter(Boolean).join(" · ") || null;
    case "pm_transfer": return [r.pmtStatus, r.pmtQty != null ? `Qty ${r.pmtQty}` : null].filter(Boolean).join(" · ") || null;
    case "packing_entry": return [r.pkStatus, r.packedQty != null ? `Packed ${r.packedQty}` : null, r.looseInkQty != null ? `Loose ${r.looseInkQty}` : null].filter(Boolean).join(" · ") || null;
    case "fg_transfer": return [r.fgStatus, r.finalQty != null ? `Final ${r.finalQty}` : null].filter(Boolean).join(" · ") || null;
  }
}

export default function RequestDetail() {
  const { id } = useParams();
  const s = useProductionStore();
  const session = useSession();
  const r = id ? s.requestById(id) : undefined;

  const [modalStep, setModalStep] = useState<QueueStep | null>(null);
  const [holdOpen, setHoldOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!r) {
    return (
      <Card className="max-w-lg mx-auto mt-10 p-8 text-center">
        <h1 className="text-[18px] font-bold text-navy">Job card not found</h1>
        <p className="text-[13.5px] text-grey-2 mt-2">It may not exist, or you may not have access to it.</p>
        <Link to="/production-entry/requests" className="mt-4 inline-block text-[13px] font-semibold text-orange hover:underline">Back to all job cards</Link>
      </Card>
    );
  }

  const name = (uid: string | null) => (uid ? s.personName(uid) : "—");
  const isCoordinatorish = s.isAdmin || s.isProcessCoordinator;
  const canHold = isCoordinatorish && (s.isOpenRequest(r) || r.status === "on_hold");
  const canCancel = (r.raisedBy === session.user.id || isCoordinatorish) && (s.isOpenRequest(r) || r.status === "on_hold");

  const cur = openStep(r);
  const canActNow = cur ? s.canActOn(cur, r) : false;

  const runReason = async (fn: (r: ProductionRequest, reason: string) => Promise<void>, close: () => void) => {
    if (!reason.trim()) { setErr("A reason is required."); return; }
    setBusy(true); setErr(null);
    try { await fn(r, reason.trim()); setReason(""); close(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const queueSteps = STEPS.filter((st) => !st.noQueue);
  const stateFor = (step: QueueStep): StageState => (stepDoneAt(step, r) ? "done" : cur === step ? "current" : "pending");

  const activity = s.activityFor("request", r.id);

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-[22px] font-bold text-navy">{r.reqNo}</h1>
            <StatusPill status={r.status} />
          </div>
          <p className="text-[13.5px] text-grey-2 mt-1">Job Card {requestSubject(r)} · raised by {r.requesterName}</p>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          {cur && canActNow && <Button size="sm" onClick={() => setModalStep(cur)}>{STEP_CONFIG[cur].actionLabel}</Button>}
          {canHold && (
            <Button size="sm" variant="ghost" onClick={() => (r.status === "on_hold" ? void s.holdRequest(r, false, "") : setHoldOpen(true))}>
              {r.status === "on_hold" ? "Resume" : "Hold"}
            </Button>
          )}
          {canCancel && (
            <Button size="sm" variant="ghost" onClick={() => setCancelOpen(true)} className="!text-ryg-red">Cancel</Button>
          )}
        </div>
      </div>

      <Card className="p-5">
        <SectionHeading>Issue Slip</SectionHeading>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-3">
          <Field label="Job Card No." value={r.jobcardNo} />
          <Field label="Category" value={s.categoryById(r.categoryId)?.name ?? "—"} />
          <Field label="Raw Material" value={s.rawMaterialById(r.rawMaterialId)?.name ?? "—"} />
          <Field label="Required Qty" value={numOrDash(r.requiredQty)} />
          <Field label="Unit" value={s.unitById(r.unitId)?.name ?? "—"} />
          <Field label="FG Item" value={s.fgItemById(r.fgItemId)?.name ?? "—"} />
          <Field label="Requester" value={r.requesterName} />
          <Field label="Raised" value={formatDate(r.submittedAt)} />
          {r.issueRemarks && <Field label="Remarks" value={r.issueRemarks} className="col-span-2 sm:col-span-3" />}
        </div>
        {r.status === "on_hold" && r.holdReason && (
          <div className="mt-4 rounded-xl bg-page px-3.5 py-2.5 text-[12.5px] text-grey">On hold: {r.holdReason}</div>
        )}
        {r.status === "cancelled" && r.cancelReason && (
          <div className="mt-4 rounded-xl bg-page px-3.5 py-2.5 text-[12.5px] text-grey">Cancelled: {r.cancelReason}</div>
        )}
      </Card>

      <Card className="p-5 space-y-4">
        <h2 className="text-[15px] font-bold text-navy">Progress</h2>
        {queueSteps.map((st) => {
          const step = st.key as QueueStep;
          const at = stepDoneAt(step, r);
          const cfg = STEP_CONFIG[step];
          const capturedDate = cfg.fields.find((f) => f.kind === "date")?.get(r) || null;
          return (
            <Stage
              key={step}
              title={st.title}
              when={at}
              by={name(stepDoneBy(step, r))}
              detail={[capturedDate ? `On ${dmy(capturedDate)}` : null, stepDetail(step, r)].filter(Boolean).join(" — ") || null}
              state={stateFor(step)}
            />
          );
        })}
      </Card>

      {activity.length > 0 && (
        <Card className="p-5">
          <h2 className="text-[15px] font-bold text-navy">Activity</h2>
          <ul className="mt-3 space-y-2.5">
            {activity.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((a) => (
              <li key={a.id} className="flex gap-3 text-[12.5px]">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-line" />
                <div className="min-w-0">
                  <div className="text-navy">{a.note ?? a.type}</div>
                  <div className="text-grey-2">{formatDateTime(a.createdAt)}{a.actorId ? ` · ${name(a.actorId)}` : ""}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {modalStep && <StepModal stepKey={modalStep} open onClose={() => setModalStep(null)} request={r} />}

      <Modal
        open={holdOpen}
        onClose={() => setHoldOpen(false)}
        title={`Hold ${r.reqNo}`}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setHoldOpen(false)} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={() => runReason((req, rs) => s.holdRequest(req, true, rs), () => setHoldOpen(false))} disabled={busy}>{busy ? "Saving…" : "Hold"}</Button>
          </>
        }
      >
        <FieldLabel label="Reason" required>
          <TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this being held?" />
        </FieldLabel>
        {err && <p className="text-[12.5px] text-ryg-red mt-2">{err}</p>}
      </Modal>

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={`Cancel ${r.reqNo}`}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setCancelOpen(false)} disabled={busy}>Keep it</Button>
            <Button size="sm" onClick={() => runReason((req, rs) => s.cancelRequest(req, rs), () => setCancelOpen(false))} disabled={busy} className="!bg-ryg-red">{busy ? "Cancelling…" : "Cancel job card"}</Button>
          </>
        }
      >
        <FieldLabel label="Reason" required>
          <TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this being cancelled?" />
        </FieldLabel>
        {err && <p className="text-[12.5px] text-ryg-red mt-2">{err}</p>}
      </Modal>
    </div>
  );
}
