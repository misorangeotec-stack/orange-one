import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Kpi from "@/shared/components/ui/Kpi";
import Tabs from "@/shared/components/ui/Tabs";
import EmptyState from "@/shared/components/ui/EmptyState";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { FitCell, FitTh, ResetWidths } from "@/shared/components/ui/ColumnResizer";
import { FIT } from "@/shared/lib/tableLook";
import { useColumnWidths } from "@/shared/lib/useColumnWidths";
import { formatDate } from "@/shared/lib/time";
import { useImportStore } from "../../store";
import { qtyText, poStageBadge, PO_STAGE_LABEL } from "../../lib/format";
import PoStepper from "../../components/PoStepper";
import { SharePoModal, CollectPiModal, FollowupModal, GrnModal, TallyModal, QcModal, PurchaseReturnModal, GateOutwardModal, RequestCancelModal, CancelPoModal, DeclineCancelModal } from "../../components/PoModals";
import ActivityTimeline from "../../components/ActivityTimeline";
import { GrnPhotoLink, TallyDocLink, PoDocLink, PiDocLink } from "../../components/DocLinks";
import { shipmentLabel } from "../../types";

/**
 * PO Detail — header + lifecycle stepper + action bar + Items / GRNs tabs.
 *
 * Import is a pure quantity requisition: there is no rate, value, PI or payment.
 * A PO closes on goods received (GRN) + Tally-booked.
 */
/** The two tab tables' columns, for their remembered widths (PF-20). */
const ITEM_COLS = ["item", "source", "qty", "received"];
const GRN_COLS = ["poRef", "gate", "date", "items", "condition", "photo"];
const TH = "font-medium px-4 py-3";

export default function PoDetail() {
  const { id } = useParams();
  const s = useImportStore();
  const [tab, setTab] = useState("items");
  /**
   * PF-20: both tab tables are one line per row and their columns drag. Above the guard below,
   * like every hook. Text is cut with "…" and shown whole on hover; quantities, dates and the
   * photo button are never cut. The widths are shared by every PO (the key folds the id).
   */
  const itemsFit = useColumnWidths("tb", ITEM_COLS);
  const grnsFit = useColumnWidths("tb", GRN_COLS);
  const tabFit = tab === "items" ? ([itemsFit, ITEM_COLS] as const) : tab === "grns" ? ([grnsFit, GRN_COLS] as const) : null;
  const [modal, setModal] = useState<"share" | "pi" | "followup" | "grn" | "tally" | "qc" | "return" | "gateout" | "reqcancel" | "cancel" | "declinecancel" | null>(null);

  const po = s.poById(id ?? null);
  if (!po) {
    return <EmptyState title="PO not found" message="It may have been removed." actionLabel="Back to POs" actionTo="/import/pos" />;
  }
  const co = s.companyById(po.companyId);
  const items = s.poItemsForPo(po.id);
  const pis = s.pisForPo(po.id);
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
            {po.shipmentType ? <> · <span className="font-medium text-navy">{shipmentLabel(po.shipmentType)}</span></> : null}
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
          {s.canCollectPi && po.currentStage === "collect_pi" && <Button size="sm" variant="ghost" onClick={() => setModal("pi")}>Collect PI</Button>}
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
        {/* PF-20: "Reset widths" for the table on screen, on its own row and only once one of its
            columns has been dragged — beside the tabs it would cut their underline short. */}
        {tabFit && tabFit[0].anyCustom(tabFit[1]) && (
          <div className="flex justify-end px-4 pt-2">
            <ResetWidths fit={tabFit[0]} cols={tabFit[1]} />
          </div>
        )}

        {tab === "items" && (
          <ScrollableTable>
            <table className="w-full text-[13.5px]">
              <thead><tr className="text-left text-grey-2 border-b border-line"><FitTh fit={itemsFit} col="item" className={TH}>Item</FitTh><FitTh fit={itemsFit} col="source" className={TH}>Source Request</FitTh><FitTh fit={itemsFit} col="qty" className={TH}>Qty</FitTh><FitTh fit={itemsFit} col="received" className={TH}>Received</FitTh></tr></thead>
              <tbody {...itemsFit.tbodyProps}>
                {items.map((pi) => {
                  const line = s.lineById(pi.requestItemId);
                  const req = line ? s.requestById(line.requestId) : undefined;
                  return (
                    <tr key={pi.id} className="border-b border-line/70 last:border-0 hover:bg-page/60">
                      <td className="px-4 py-3 font-medium text-navy"><FitCell fit={itemsFit} col="item" cap={FIT.CUT}>{line ? s.itemLabel(line.itemId) : "—"}</FitCell></td>
                      <td className="px-4 py-3 whitespace-nowrap"><FitCell fit={itemsFit} col="source" cap={FIT.CUT}>{req ? <Link to={`/import/requests/${req.id}`} className="text-orange hover:underline">{req.requestNo}</Link> : "—"}</FitCell></td>
                      <td className="px-4 py-3"><FitCell fit={itemsFit} col="qty" cap={null}>{pi.qty}{line?.unit ? ` ${line.unit}` : ""}</FitCell></td>
                      <td className="px-4 py-3"><FitCell fit={itemsFit} col="received" cap={null}>{pi.receivedQty}{pi.receivedQty >= pi.qty ? " ✓" : ""}</FitCell></td>
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
                <thead><tr className="text-left text-grey-2 border-b border-line"><FitTh fit={grnsFit} col="poRef" className={TH}>PO Ref</FitTh><FitTh fit={grnsFit} col="gate" className={TH}>Gate Reg No.</FitTh><FitTh fit={grnsFit} col="date" className={TH}>Date</FitTh><FitTh fit={grnsFit} col="items" className={TH}>Items</FitTh><FitTh fit={grnsFit} col="condition" className={TH}>Condition</FitTh><FitTh fit={grnsFit} col="photo" resize={false} className={TH}>Photo</FitTh></tr></thead>
                <tbody {...grnsFit.tbodyProps}>
                  {grns.map((g) => {
                    const gi = s.grnItemsForGrn(g.id);
                    return (
                      <tr key={g.id} className="border-b border-line/70 last:border-0 hover:bg-page/60">
                        <td className="px-4 py-3 font-medium text-navy whitespace-nowrap"><FitCell fit={grnsFit} col="poRef" cap={FIT.CUT}>{g.poRef || po.tallyPoNo || po.poNo}</FitCell></td>
                        <td className="px-4 py-3"><FitCell fit={grnsFit} col="gate" cap={FIT.CUT}>{g.gateRegisterNo || "—"}</FitCell></td>
                        <td className="px-4 py-3 whitespace-nowrap"><FitCell fit={grnsFit} col="date" cap={null}>{formatDate(g.createdAt)}</FitCell></td>
                        <td className="px-4 py-3"><FitCell fit={grnsFit} col="items" cap={FIT.CUT}>{gi.map((x) => { const l = s.lineById(s.poItemsForPo(po.id).find((p) => p.id === x.poItemId)?.requestItemId ?? null); return l ? `${s.itemLabel(l.itemId)} ×${x.receivedQty}` : `×${x.receivedQty}`; }).join(", ")}</FitCell></td>
                        <td className="px-4 py-3 whitespace-nowrap"><FitCell fit={grnsFit} col="condition" cap={null}>{g.condition.replace("_", " ")}</FitCell></td>
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

      {/* The vendor's PI — the Collect PI step's output. Same shape as the Tally
          card below, so the two references read alike. */}
      {pis.length > 0 && (
        <Card className="px-4 py-3 text-[13px] text-grey space-y-1.5">
          {pis.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                <span className="text-grey">Vendor PI:</span>{" "}
                <span className="font-semibold text-navy">{p.vendorPiNo}</span>
              </span>
              {p.remarks && <span className="text-grey-2">· {p.remarks}</span>}
              {p.documentPath && <PiDocLink pi={p} />}
            </div>
          ))}
        </Card>
      )}

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
      <CollectPiModal po={po} open={modal === "pi"} onClose={() => setModal(null)} />
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
