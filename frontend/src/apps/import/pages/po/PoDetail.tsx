import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Kpi from "@/shared/components/ui/Kpi";
import Tabs from "@/shared/components/ui/Tabs";
import EmptyState from "@/shared/components/ui/EmptyState";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { formatDate } from "@/shared/lib/time";
import { useImportStore } from "../../store";
import { qtyText, poStageBadge, PO_STAGE_LABEL } from "../../lib/format";
import PoStepper from "../../components/PoStepper";
import { SharePoModal, FollowupModal, GrnModal, TallyModal, QcModal, PurchaseReturnModal, GateOutwardModal, RequestCancelModal, CancelPoModal, DeclineCancelModal } from "../../components/PoModals";
import ActivityTimeline from "../../components/ActivityTimeline";
import { GrnPhotoLink, TallyDocLink, PoDocLink } from "../../components/DocLinks";

/**
 * PO Detail — header + lifecycle stepper + action bar + Items / GRNs tabs.
 *
 * Import is a pure quantity requisition: there is no rate, value, PI or payment.
 * A PO closes on goods received (GRN) + Tally-booked.
 */
export default function PoDetail() {
  const { id } = useParams();
  const s = useImportStore();
  const [tab, setTab] = useState("items");
  const [modal, setModal] = useState<"share" | "followup" | "grn" | "tally" | "qc" | "return" | "gateout" | "reqcancel" | "cancel" | "declinecancel" | null>(null);

  const po = s.poById(id ?? null);
  if (!po) {
    return <EmptyState title="PO not found" message="It may have been removed." actionLabel="Back to POs" actionTo="/import/pos" />;
  }
  const co = s.companyById(po.companyId);
  const items = s.poItemsForPo(po.id);
  const grns = s.grnsForPo(po.id);
  const tally = s.tallyForPo(po.id);
  const open = po.currentStage !== "closed" && po.currentStage !== "cancelled";
  const cancelRequest = s.pendingCancelRequestForPo(po.id);
  const isCancelled = po.currentStage === "cancelled";
  // The current user is an approver for THIS PO iff its pending request is in the
  // approver worklist (that list is already scoped to admins + the PO's approvers).
  const iAmPoApprover = !!cancelRequest && s.pendingPoCancelRequests.some((r) => r.id === cancelRequest.id);
  // Goods fully received → GRN step done (hide "Record GRN"). Every receipt booked
  // → Tally step done (hide "Book in Tally"); a partial GRN still needs its own
  // invoice, so the button stays while any receipt is unbooked.
  const allReceived = items.length > 0 && items.every((it) => it.receivedQty >= it.qty);
  const unbookedGrns = s.unbookedGrnsForPo(po.id);
  const tallyBooked = unbookedGrns.length === 0;

  // The QC branch. Each button appears only while its own step actually owes
  // work, so the bar keeps offering exactly one logical next step.
  const qcPending = s.uninspectedGrnsForPo(po.id).length > 0;
  const pendingReturn = s.qcInspections.find((q) => q.poId === po.id && q.result === "rejected" && !q.returnTallyRef);
  const pendingGate = s.qcInspections.find(
    (q) => q.poId === po.id && q.result === "rejected" && !!q.returnTallyRef && !q.gateRegisterNo,
  );

  // Activity for the PO, newest first.
  const activity = s.activity
    .filter((a) => a.entityType === "po" && a.entityId === po.id)
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const tabs = [
    { key: "items", label: "Items", count: items.length },
    { key: "grns", label: "GRNs", count: grns.length },
    { key: "activity", label: "Activity", count: activity.length },
  ];

  return (
    <div className="space-y-5">
      <Link to="/import/pos" className="text-[12.5px] text-grey hover:text-navy">← Purchase Orders</Link>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[22px] font-bold text-navy">{po.poNo}</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">
            {s.vendorById(po.vendorId)?.name ?? "—"} · {co ? (co.location ? `${co.name} — ${co.location}` : co.name) : "—"} · {formatDate(po.createdAt)}
            {po.tallyPoNo ? <> · Tally PO: <span className="font-medium text-navy">{po.tallyPoNo}</span></> : null}
            {po.dispatchDate ? <> · Dispatch: <span className="font-medium text-navy">{formatDate(po.dispatchDate)}</span></> : null}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {po.documentPath && <PoDocLink po={po} />}
          <span className={poStageBadge(po.currentStage)}>{PO_STAGE_LABEL[po.currentStage] ?? po.currentStage}</span>
        </div>
      </div>

      {/* Cancelled banner — rendered outside the (open-only) action bar. */}
      {isCancelled && (
        <Card className="px-4 py-3 border-ryg-red/30 bg-[#FDECEC]">
          <p className="text-[13px] text-ryg-red">
            <span className="font-semibold">PO cancelled</span>
            {po.cancelledBy ? <> by {s.profileById(po.cancelledBy)?.name ?? "—"}</> : null}
            {po.cancelledAt ? <> on {formatDate(po.cancelledAt)}</> : null}
            {po.cancelReason ? <> — {po.cancelReason}</> : null}
          </p>
        </Card>
      )}

      {/* Pending vendor-cancellation request — approver acts, others wait. */}
      {open && cancelRequest && (
        <Card className="px-4 py-3 border-orange/30 bg-orange-soft">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="text-[13px] text-navy">
              <span className="font-semibold text-orange">Vendor cancellation requested</span>
              {cancelRequest.requestedBy ? <> by {s.profileById(cancelRequest.requestedBy)?.name ?? "—"}</> : null}
              {" "}— {cancelRequest.reason}
              {cancelRequest.vendorRef ? <span className="text-grey-2"> · ref: {cancelRequest.vendorRef}</span> : null}
            </p>
            {iAmPoApprover ? (
              <div className="flex items-center gap-2 shrink-0">
                {s.canCancelPo(po) && <Button size="sm" variant="ghost" className="!text-ryg-red hover:!border-ryg-red" onClick={() => setModal("cancel")}>Cancel PO</Button>}
                <Button size="sm" variant="ghost" onClick={() => setModal("declinecancel")}>Decline</Button>
              </div>
            ) : (
              <span className="text-[12.5px] text-grey-2 shrink-0">Awaiting the approver's decision</span>
            )}
          </div>
        </Card>
      )}

      <Card className="px-4 py-4"><PoStepper po={po} /></Card>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi
          label="Items"
          value={String(items.length)}
          hint={qtyText(items.map((it) => ({ qty: it.qty, unit: s.lineById(it.requestItemId)?.unit })))}
          size="sm"
        />
        <Kpi
          label="Received"
          value={qtyText(items.map((it) => ({ qty: it.receivedQty, unit: s.lineById(it.requestItemId)?.unit })))}
          hint={allReceived ? "all received" : "pending"}
          size="sm"
        />
      </div>

      {/* Action bar */}
      {open && (
        <div className="flex flex-wrap gap-2">
          {/* Forward-progress buttons show ONLY at the PO's current stage; the
              cancellation actions below stay available at every stage. */}
          {s.canSharePo && po.currentStage === "share_po" && <Button size="sm" variant="ghost" onClick={() => setModal("share")}>Share PO</Button>}
          {s.canFollowup && po.currentStage === "follow_up" && <Button size="sm" variant="ghost" onClick={() => setModal("followup")}>Follow-up</Button>}
          {s.canInward && po.currentStage === "inward" && !allReceived && <Button size="sm" variant="ghost" onClick={() => setModal("grn")}>Record GRN</Button>}
          {s.canTally && po.currentStage === "tally" && !tallyBooked && <Button size="sm" variant="ghost" onClick={() => setModal("tally")}>Book in Tally</Button>}
          {s.canQc && qcPending && <Button size="sm" variant="ghost" onClick={() => setModal("qc")}>Record QC</Button>}
          {s.canPurchaseReturn && pendingReturn && <Button size="sm" variant="ghost" onClick={() => setModal("return")}>Book purchase return</Button>}
          {s.canGateOutward && pendingGate && <Button size="sm" variant="ghost" onClick={() => setModal("gateout")}>Gate out</Button>}
          {s.canRequestPoCancel(po) && <Button size="sm" variant="ghost" className="!text-ryg-red hover:!border-ryg-red" onClick={() => setModal("reqcancel")}>Request cancellation</Button>}
          {s.canCancelPo(po) && !cancelRequest && <Button size="sm" variant="ghost" className="!text-ryg-red hover:!border-ryg-red" onClick={() => setModal("cancel")}>Cancel PO</Button>}
        </div>
      )}

      {/* A PO closes on all-received before its Tally entry, so a closed PO can
          still owe Tally (unbooked GRN). The action bar above is open-only, so
          surface just the Tally action here — book_tally accepts a closed PO. */}
      {!open && po.currentStage === "closed" && !tallyBooked && s.canTally && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => setModal("tally")}>Book in Tally</Button>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="px-4 pt-3"><Tabs tabs={tabs} active={tab} onChange={setTab} /></div>

        {tab === "items" && (
          <ScrollableTable>
            <table className="w-full text-[13.5px]">
              <thead><tr className="text-left text-grey-2 border-b border-line"><th className="font-medium px-4 py-3">Item</th><th className="font-medium px-4 py-3">Source Request</th><th className="font-medium px-4 py-3">Qty</th><th className="font-medium px-4 py-3">Received</th></tr></thead>
              <tbody>
                {items.map((pi) => {
                  const line = s.lineById(pi.requestItemId);
                  const req = line ? s.requestById(line.requestId) : undefined;
                  return (
                    <tr key={pi.id} className="border-b border-line/70 last:border-0 hover:bg-page/60">
                      <td className="px-4 py-3 font-medium text-navy">{line ? s.itemLabel(line.itemId) : "—"}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{req ? <Link to={`/import/requests/${req.id}`} className="text-orange hover:underline">{req.requestNo}</Link> : "—"}</td>
                      <td className="px-4 py-3">{pi.qty}{line?.unit ? ` ${line.unit}` : ""}</td>
                      <td className="px-4 py-3">{pi.receivedQty}{pi.receivedQty >= pi.qty ? " ✓" : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollableTable>
        )}

        {tab === "grns" && (
          grns.length === 0 ? <EmptyState title="No receipts yet" message="Record a GRN from the action bar." /> : (
            <ScrollableTable>
              <table className="w-full text-[13.5px]">
                <thead><tr className="text-left text-grey-2 border-b border-line"><th className="font-medium px-4 py-3">PO Ref</th><th className="font-medium px-4 py-3">Gate Reg No.</th><th className="font-medium px-4 py-3">Date</th><th className="font-medium px-4 py-3">Items</th><th className="font-medium px-4 py-3">Condition</th><th className="font-medium px-4 py-3">Photo</th></tr></thead>
                <tbody>
                  {grns.map((g) => {
                    const gi = s.grnItemsForGrn(g.id);
                    return (
                      <tr key={g.id} className="border-b border-line/70 last:border-0 hover:bg-page/60">
                        <td className="px-4 py-3 font-medium text-navy whitespace-nowrap">{g.poRef || po.tallyPoNo || po.poNo}</td>
                        <td className="px-4 py-3">{g.gateRegisterNo || "—"}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{formatDate(g.createdAt)}</td>
                        <td className="px-4 py-3">{gi.map((x) => { const l = s.lineById(s.poItemsForPo(po.id).find((p) => p.id === x.poItemId)?.requestItemId ?? null); return l ? `${s.itemLabel(l.itemId)} ×${x.receivedQty}` : `×${x.receivedQty}`; }).join(", ")}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{g.condition.replace("_", " ")}</td>
                        <td className="px-4 py-3 whitespace-nowrap"><GrnPhotoLink grn={g} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollableTable>
          )
        )}

        {tab === "activity" && <div className="px-4 py-4"><ActivityTimeline rows={activity} /></div>}
      </Card>

      {tally.length > 0 && (
        <Card className="px-4 py-3 text-[13px] text-grey space-y-1.5">
          {tally.map((t) => {
            // Each invoice is booked against one goods receipt (partial or full).
            const g = t.grnId ? grns.find((x) => x.id === t.grnId) : undefined;
            return (
              <div key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>
                  <span className="text-grey">Tally invoice:</span>{" "}
                  <span className="font-semibold text-navy">{t.tallyPiNo}</span>
                </span>
                {g && <span className="text-grey-2">· GRN {g.gateRegisterNo || formatDate(g.createdAt)}</span>}
                {t.remarks && <span className="text-grey-2">· {t.remarks}</span>}
                {t.documentPath && <TallyDocLink booking={t} />}
              </div>
            );
          })}
          {unbookedGrns.length > 0 && (
            <p className="text-[12.5px] text-orange">
              {unbookedGrns.length} goods receipt{unbookedGrns.length === 1 ? "" : "s"} still to be booked in Tally.
            </p>
          )}
        </Card>
      )}

      <SharePoModal po={po} open={modal === "share"} onClose={() => setModal(null)} />
      <GrnModal po={po} open={modal === "grn"} onClose={() => setModal(null)} />
      <TallyModal po={po} open={modal === "tally"} onClose={() => setModal(null)} />
      <QcModal po={po} open={modal === "qc"} onClose={() => setModal(null)} />
      {pendingReturn && <PurchaseReturnModal po={po} inspection={pendingReturn} open={modal === "return"} onClose={() => setModal(null)} />}
      {pendingGate && <GateOutwardModal po={po} inspection={pendingGate} open={modal === "gateout"} onClose={() => setModal(null)} />}
      <FollowupModal po={po} open={modal === "followup"} onClose={() => setModal(null)} />
      <RequestCancelModal po={po} open={modal === "reqcancel"} onClose={() => setModal(null)} />
      <CancelPoModal po={po} request={cancelRequest ?? null} open={modal === "cancel"} onClose={() => setModal(null)} />
      <DeclineCancelModal request={cancelRequest ?? null} open={modal === "declinecancel"} onClose={() => setModal(null)} />
    </div>
  );
}
