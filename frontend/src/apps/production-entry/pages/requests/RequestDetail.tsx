import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useSession } from "@/core/platform/session";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import { Field, SectionHeading } from "@/shared/components/ui/Readout";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import { formatDateTime } from "@/shared/lib/time";
import StepModal from "../../components/StepModal";
import StepDocLink from "../../components/StepDocLink";
import ProductionStepper from "../../components/ProductionStepper";
import ExportButtons from "../../components/ExportButtons";
import StatusPill from "../../components/StatusPill";
import CardTypePill from "../../components/CardTypePill";
import { exportIssueSlipXlsx } from "../../lib/exportIssueSlip";
import { buildIssueSlipExport, buildAisIssueSlipExport } from "../../lib/issueSlipVm";
import { printIssueSlip } from "../../lib/printIssueSlip";
import { buildRepackSlipExport, exportRepackSlipXlsx, printRepackSlip } from "../../lib/repackSlip";
import { buildBatchCardExport, exportBatchCardXlsx, printBatchCard } from "../../lib/batchCard";
import { dmy, numOrDash, packFinalQty, requestSubject } from "../../lib/format";
import { openStep, stepDoneAt, stepDoneBy, type QueueStep } from "../../lib/queues";
import { STEPS, stepAppliesTo } from "../../lib/steps";
import { STEP_CONFIG } from "../../lib/stepConfig";
import { useProductionStore } from "../../store";
import type { ProductionRequest } from "../../types";

type StageState = "done" | "current" | "pending";

/** A stage attachment to surface in the flow: the stored file + an optional
 *  sub-label (e.g. which QC test round it belongs to). */
interface StageAttachment {
  path: string;
  name: string | null;
  label?: string;
}

function Stage({
  title,
  when,
  by,
  detail,
  state,
  attachments,
}: {
  title: string;
  when: string | null;
  by: string | null;
  detail: string | null;
  state: StageState;
  attachments?: StageAttachment[];
}) {
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
        {when && <div className="text-[12.5px] text-grey-2">{formatDateTime(when)}{by ? ` · ${by}` : ""}</div>}
        {detail && <div className="text-[12.5px] text-grey mt-0.5">{detail}</div>}
        {attachments && attachments.length > 0 && (
          <div className="mt-1.5 flex flex-col gap-1">
            {attachments.map((a, i) => (
              <div key={i} className="flex items-center gap-1.5">
                {a.label && <span className="text-[11.5px] text-grey-2 whitespace-nowrap">{a.label}:</span>}
                <StepDocLink path={a.path} name={a.name} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Every document uploaded at a given stage, for the progress flow. Log Book,
 *  Quality Check (one per test round), M/C Testing and FG Transfer each capture a
 *  file; other steps capture none. */
function stageAttachments(step: QueueStep, r: ProductionRequest): StageAttachment[] {
  switch (step) {
    case "transfer_slip":
      return r.tsAttachmentPath ? [{ path: r.tsAttachmentPath, name: r.tsAttachmentName }] : [];
    case "quality_check": {
      const perRound = r.qcRounds
        .filter((rd) => rd.attachmentPath)
        .map((rd) => ({ path: rd.attachmentPath as string, name: rd.attachmentName, label: `Test ${rd.round}` }));
      // Legacy cards recorded a single request-level QC file with no rounds.
      if (perRound.length === 0 && r.qcAttachmentPath) return [{ path: r.qcAttachmentPath, name: r.qcAttachmentName }];
      return perRound;
    }
    case "mc_testing":
      return r.mcAttachmentPath ? [{ path: r.mcAttachmentPath, name: r.mcAttachmentName }] : [];
    case "fg_transfer":
      return r.fgAttachmentPath ? [{ path: r.fgAttachmentPath, name: r.fgAttachmentName }] : [];
    default:
      return [];
  }
}

/** Short per-step detail line for the progress panel — the captured value(s). */
function stepDetail(step: QueueStep, r: ProductionRequest): string | null {
  switch (step) {
    case "material_handover": return [r.mhStatus, r.mhQty != null ? `Qty ${r.mhQty}` : null, r.rmBookNo ? `RM Book ${r.rmBookNo}` : null].filter(Boolean).join(" · ") || null;
    case "rm_transfer": return r.rmtTallyEntry ? `Tally ${r.rmtTallyEntry}` : null;
    case "transfer_slip": {
      const n = r.tsBomLines.length;
      return [
        n ? `${n} item${n === 1 ? "" : "s"} logged` : null,
        r.peExpectedQty != null ? `Expected ${r.peExpectedQty}` : null,
        r.scrapQty != null ? `Scrap ${r.scrapQty}` : null,
        r.actualQty != null ? `Output ${r.actualQty}` : null,
        r.peLabQty != null ? `Lab ${r.peLabQty}` : null,
        r.tsPackedQty != null ? `Packed ${r.tsPackedQty}` : null,
        r.tsLooseQty != null ? `Loose ${r.tsLooseQty}` : null,
        r.tsAttachmentName ? "attachment" : null,
      ].filter(Boolean).join(" · ") || null;
    }
    case "production_entry": return r.peTallyEntry ? `Tally ${r.peTallyEntry}` : null;
    case "quality_check": {
      const n = r.qcRounds.length;
      const res = r.qcStatus ? r.qcStatus[0].toUpperCase() + r.qcStatus.slice(1) : null;
      return [n ? `Test ${n}` : null, res, r.qcRetestDue ? `retest by ${dmy(r.qcRetestDue)}` : null].filter(Boolean).join(" · ") || null;
    }
    case "additional_issue_slip": {
      const last = r.aisRounds[r.aisRounds.length - 1];
      return [last?.aisQty != null ? `Extra ${last.aisQty}` : null, r.aisRounds.length ? `${r.aisRounds.length} slip${r.aisRounds.length === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ") || null;
    }
    case "mc_testing": return [r.mcStatus ? r.mcStatus[0].toUpperCase() + r.mcStatus.slice(1) : null, r.mcRemarks].filter(Boolean).join(" · ") || null;
    case "pm_transfer": return r.pmtAt ? `Transferred${r.pmhBomLines.length ? ` · ${r.pmhBomLines.length} packaging item${r.pmhBomLines.length === 1 ? "" : "s"}` : ""}` : null;
    case "packing_entry": {
      const net = r.actualQty != null ? Math.round((r.actualQty - (r.peLabQty ?? 0)) * 1000) / 1000 : null;
      return [r.pkAt ? "Logged" : null, net != null ? `Net ${net}` : null, r.pmhBomLines.length ? `${r.pmhBomLines.length} packaging item${r.pmhBomLines.length === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ") || null;
    }
    case "ready_to_dispatch": return r.rtdAt ? "Marked ready to dispatch" : null;
    case "fg_transfer": return [r.fgAttachmentName ? "Tally file uploaded" : null, r.closedAt ? "closed" : null].filter(Boolean).join(" · ") || null;
    default: return null;
  }
}

/** Steps handled by a dedicated multi-select page, not the per-card StepModal. */
const BULK_STEP_SLUG: Partial<Record<QueueStep, string>> = {
  ready_to_dispatch: "ready-to-dispatch",
  fg_transfer: "fg-transfer",
};

export default function RequestDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
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
  // A view-only grant removes every action here while the job card stays readable.
  const canHold = s.canEdit && isCoordinatorish && (s.isOpenRequest(r) || r.status === "on_hold");
  const canCancel =
    s.canEdit && (r.raisedBy === session.user.id || isCoordinatorish) && (s.isOpenRequest(r) || r.status === "on_hold");

  const cur = openStep(r);
  const canActNow = cur ? s.canActOn(cur, r) : false;

  const runReason = async (fn: (r: ProductionRequest, reason: string) => Promise<void>, close: () => void) => {
    if (!reason.trim()) { setErr("A reason is required."); return; }
    setBusy(true); setErr(null);
    try { await fn(r, reason.trim()); setReason(""); close(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  // A repackaging card runs only the four tail steps — listing the seven it
  // bypasses as "pending" would read as work still owed.
  const queueSteps = STEPS.filter((st) => !st.noQueue && stepAppliesTo(r.cardType, st.key));
  const stateFor = (step: QueueStep): StageState => (stepDoneAt(step, r) ? "done" : cur === step ? "current" : "pending");

  const activity = s.activityFor("request", r.id);

  // FG quantity + any Additional Issue Slip top-ups (QC rejects add extra FG qty).
  const fgUnitName = s.unitById(s.fgItemById(r.fgItemId)?.unitId ?? null)?.name ?? null;
  const aisAdditional = r.aisRounds.reduce((a, rd) => a + (rd.aisQty ?? 0), 0);
  const totalFgQty = (r.fgQty ?? 0) + aisAdditional;
  const fgQtyLabel = (q: number | null) => (q == null ? "—" : `${Math.round(q * 1000) / 1000}${fgUnitName ? ` ${fgUnitName}` : ""}`);

  // Lookups the issue-slip + batch-card view-model builders need.
  const issueSlipLookups = {
    fgItemName: (id: string | null) => s.fgItemById(id)?.name ?? "",
    rawMaterialName: (id: string | null) => s.rawMaterialById(id)?.name ?? "",
    packagingItemName: (id: string | null) => s.packagingItemById(id)?.name ?? "",
  };

  const repackSlipLookups = {
    fgItemName: (id: string | null) => s.fgItemById(id)?.name ?? "",
    packagingItemName: (id: string | null) => s.packagingItemById(id)?.name ?? "",
    unitName: (id: string | null) => s.unitById(id)?.name ?? "",
    fgUnitName: (fgItemId: string | null) => s.unitById(s.fgItemById(fgItemId)?.unitId ?? null)?.name ?? "",
  };

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-[22px] font-bold text-navy">{r.reqNo}</h1>
            <StatusPill status={r.status} />
            <CardTypePill cardType={r.cardType} />
          </div>
          <p className="text-[13.5px] text-grey-2 mt-1">Lot/Batch Card {requestSubject(r)} · raised by {r.requesterName}</p>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          {cur && canActNow && (
            BULK_STEP_SLUG[cur]
              ? <Button size="sm" onClick={() => navigate(`/production-entry/queues/${BULK_STEP_SLUG[cur]}`)}>{STEP_CONFIG[cur].actionLabel}</Button>
              : <Button size="sm" onClick={() => setModalStep(cur)}>{STEP_CONFIG[cur].actionLabel}</Button>
          )}
          {s.canEditRequest(r) && (
            <Link to={`/production-entry/requests/${r.id}/edit`}>
              <Button size="sm" variant="ghost">Edit</Button>
            </Link>
          )}
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

      <Card className="p-4">
        <ProductionStepper request={r} />
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <SectionHeading>{r.cardType === "repackaging" ? "Repackaging Slip" : "Batch Card"}</SectionHeading>
          {/* A repackaging card has no raw material, so it gets its own slip —
              same form idiom, packaging list where the RM table would be. */}
          {r.cardType === "repackaging" ? (
            <ExportButtons
              label="repackaging slip"
              onDownloadExcel={() => exportRepackSlipXlsx(buildRepackSlipExport(r, repackSlipLookups))}
              onPrint={() => printRepackSlip(buildRepackSlipExport(r, repackSlipLookups))}
            />
          ) : (
            <ExportButtons
              label="issue slip"
              onDownloadExcel={() => exportIssueSlipXlsx(buildIssueSlipExport(r, issueSlipLookups))}
              onPrint={() => printIssueSlip(buildIssueSlipExport(r, issueSlipLookups))}
            />
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-3">
          <Field
            label="FG Item"
            value={(() => {
              const fg = s.fgItemById(r.fgItemId);
              if (!fg) return "—";
              const u = s.unitById(fg.unitId)?.name;
              return u ? `${fg.name} · ${u}` : fg.name;
            })()}
          />
          <Field label="Lot/Batch Card Number" value={r.jobcardNo} />
          <Field
            label={aisAdditional > 0 ? "Original FG Quantity" : "FG Quantity"}
            value={fgQtyLabel(r.fgQty)}
          />
          {aisAdditional > 0 && (
            <Field
              label="Total FG Quantity"
              value={`${fgQtyLabel(totalFgQty)} (incl. +${Math.round(aisAdditional * 1000) / 1000} additional)`}
            />
          )}
          {/* Two dates, two meanings: the job date is what the job belongs to
              (and what the slip prints); "Raised" is when it was actually keyed
              in. A back-dated card is the whole reason they are shown apart. */}
          <Field label="Job Date" value={dmy(r.issueDate ?? r.submittedAt)} />
          <Field label="Requester" value={r.requesterName} />
          <Field label="Raised" value={formatDateTime(r.submittedAt)} />
          {r.issueRemarks && <Field label="Remarks" value={r.issueRemarks} className="col-span-2 sm:col-span-3" />}
        </div>

        {/* A repackaging card consumes no raw material at all — it shows the
            packaging it was raised with instead. The production block below must
            stay behind this branch WHOLE: its `bomLines.length > 0` fallback
            renders the legacy single-RM triple, which on a repackaging card would
            print a row of dashes. */}
        {r.cardType === "repackaging" ? (
          <div className="mt-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-grey-2 mb-2">Packaging Material</div>
            <div className="rounded-xl border border-line overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-grey-2 border-b border-line bg-page/60">
                    <th className="font-medium px-3 py-2 min-w-[200px]">Packaging Item</th>
                    <th className="font-medium px-3 py-2 text-right w-24">Qty</th>
                    <th className="font-medium px-3 py-2 text-right w-24">Extra</th>
                    <th className="font-medium px-3 py-2 text-right w-24">Total</th>
                    <th className="font-medium px-3 py-2 w-24">Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {r.pmhBomLines.length === 0 ? (
                    <tr><td colSpan={5} className="px-3 py-3 text-grey-2">No packaging items were recorded.</td></tr>
                  ) : (
                    r.pmhBomLines.map((l, i) => (
                      <tr key={i} className="border-b border-line/70 last:border-0">
                        <td className="px-3 py-2 text-navy">{s.packagingItemById(l.packagingItemId)?.name ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-grey">{numOrDash(l.qty)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-grey-2">{numOrDash(l.extra)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-navy">{numOrDash(packFinalQty(l))}</td>
                        <td className="px-3 py-2 text-grey">{s.unitById(l.unitId)?.name ?? "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {/* One line, not two: the rail no longer lists the bypassed stages,
                so there is nothing to cross-reference — just say why there is no
                raw material and why packed = FG. */}
            <p className="text-[12px] text-grey-2 mt-2">
              Repacked, not produced — no raw material and no wastage, so the packed quantity is the FG quantity.
            </p>
          </div>
        ) : (
        /* Raw materials — the BOM. New cards carry a line list; legacy cards
            (raised before multi-RM intake) fall back to the single-RM triple. */
        <div className="mt-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-grey-2 mb-2">Raw Materials</div>
          {r.bomLines.length > 0 ? (
            <div className="rounded-xl border border-line overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-grey-2 border-b border-line bg-page/60">
                    <th className="font-medium px-3 py-2">Raw Material</th>
                    <th className="font-medium px-3 py-2 text-right w-28">Qty</th>
                    <th className="font-medium px-3 py-2 w-32">Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {r.bomLines.map((l, i) => (
                    <tr key={i} className="border-b border-line/70 last:border-0">
                      <td className="px-3 py-2 text-navy">{s.rawMaterialById(l.rawMaterialId)?.name ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-grey">{numOrDash(l.requiredQty)}</td>
                      <td className="px-3 py-2 text-grey">{s.unitById(l.unitId)?.name ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
                {(() => {
                  // Totals grouped by unit — raw materials mix units (e.g. LTR vs
                  // KGS), so a single grand total would be meaningless. One footer
                  // row per unit, in first-appearance order.
                  const totals: { unit: string; qty: number }[] = [];
                  for (const l of r.bomLines) {
                    if (l.requiredQty == null) continue;
                    const unit = s.unitById(l.unitId)?.name ?? "—";
                    const row = totals.find((t) => t.unit === unit);
                    if (row) row.qty += l.requiredQty;
                    else totals.push({ unit, qty: l.requiredQty });
                  }
                  if (totals.length === 0) return null;
                  const grand = totals.reduce((sum, t) => sum + t.qty, 0);
                  return (
                    <tfoot>
                      {totals.map((t, i) => (
                        <tr key={i} className="border-t border-line bg-page/60 font-semibold text-navy">
                          <td className="px-3 py-2 text-right">{i === 0 ? "Total" : ""}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{numOrDash(Math.round(t.qty * 1000) / 1000)}</td>
                          <td className="px-3 py-2">{t.unit}</td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-line bg-page font-bold text-navy">
                        <td className="px-3 py-2 text-right">Grand total</td>
                        <td className="px-3 py-2 text-right tabular-nums">{numOrDash(Math.round(grand * 1000) / 1000)}</td>
                        <td className="px-3 py-2 text-grey-2 font-normal text-[11px]">{totals.length > 1 ? "all units combined" : totals[0].unit}</td>
                      </tr>
                    </tfoot>
                  );
                })()}
              </table>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <Field label="Raw Material" value={s.rawMaterialById(r.rawMaterialId)?.name ?? "—"} />
              <Field label="Required Qty" value={numOrDash(r.requiredQty)} />
              <Field label="Unit" value={s.unitById(r.unitId)?.name ?? "—"} />
            </div>
          )}
        </div>
        )}
        {/* Additional Issue Slips — QC-reject top-ups. Each carries its own extra
            FG quantity and extra raw material, tagged so they're clearly separate
            from the original issue slip above. */}
        {r.aisRounds.length > 0 && (
          <div className="mt-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-grey-2 mb-2">
              Additional Issue Slips <span className="text-orange normal-case tracking-normal font-medium">· QC top-ups</span>
            </div>
            <div className="space-y-3">
              {r.aisRounds.map((rd, i) => (
                <div key={i} className="rounded-xl border border-orange/40 overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-orange-soft px-3 py-2 border-b border-orange/30">
                    <span className="text-[12.5px] font-semibold text-navy">Additional Slip {rd.round}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-[12.5px] text-navy">
                        Additional FG Qty: <span className="font-bold tabular-nums text-orange">+{numOrDash(rd.aisQty)}</span>
                        {fgUnitName ? ` ${fgUnitName}` : ""}
                      </span>
                      <button
                        type="button"
                        onClick={() => printIssueSlip(buildAisIssueSlipExport(r, rd, issueSlipLookups))}
                        className="text-[12px] font-semibold text-orange hover:underline"
                      >
                        Print
                      </button>
                    </div>
                  </div>
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-left text-grey-2 border-b border-line bg-page/60">
                        <th className="font-medium px-3 py-2">Additional Raw Material</th>
                        <th className="font-medium px-3 py-2 text-right w-28">Qty</th>
                        <th className="font-medium px-3 py-2 w-32">Unit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rd.aisBomLines.map((l, j) => (
                        <tr key={j} className="border-b border-line/70 last:border-0">
                          <td className="px-3 py-2 text-navy">{s.rawMaterialById(l.rawMaterialId)?.name ?? "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-grey">{numOrDash(l.qty)}</td>
                          <td className="px-3 py-2 text-grey">{s.unitById(l.unitId)?.name ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="px-3 py-1.5 text-[11.5px] text-grey-2 bg-page/40 border-t border-line">
                    {[
                      rd.issuedAt ? `Issued ${formatDateTime(rd.issuedAt)}` : null,
                      rd.mhDone ? "handed over" : "awaiting handover",
                      rd.rmtDone ? "transferred to production" : rd.mhDone ? "awaiting RM transfer" : null,
                    ].filter(Boolean).join(" · ")}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {r.status === "on_hold" && r.holdReason && (
          <div className="mt-4 rounded-xl bg-page px-3.5 py-2.5 text-[12.5px] text-grey">On hold: {r.holdReason}</div>
        )}
        {r.status === "cancelled" && r.cancelReason && (
          <div className="mt-4 rounded-xl bg-page px-3.5 py-2.5 text-[12.5px] text-grey">Cancelled: {r.cancelReason}</div>
        )}
      </Card>

      {/* Batch Card report — available once the Log Book Entry is done (tsAt set).
          Reprises the BOM with actual transfer/use/variance + output metrics. */}
      {stepDoneAt("transfer_slip", r) && (
        <Card className="p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <SectionHeading>Batch Card Report</SectionHeading>
            <ExportButtons
              label="batch card"
              onDownloadExcel={() => exportBatchCardXlsx(buildBatchCardExport(r, issueSlipLookups))}
              onPrint={() => printBatchCard(buildBatchCardExport(r, issueSlipLookups))}
            />
          </div>
          <p className="text-[12.5px] text-grey-2 mt-1">
            Actual transfer, use, variance and output — captured through the log book entry.
          </p>
        </Card>
      )}

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
              attachments={stageAttachments(step, r)}
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
