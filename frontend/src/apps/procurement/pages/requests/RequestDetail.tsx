import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import EmptyState from "@/shared/components/ui/EmptyState";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import { Field, SectionHeading } from "@/shared/components/ui/Readout";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { formatDate } from "@/shared/lib/time";
import { useProcurementStore } from "../../store";
import { inr, lineBadge, LINE_STATUS_LABEL } from "../../lib/format";
import QtyTotal from "../../components/QtyTotal";
import RequestStepper from "../../components/RequestStepper";
import SourcingModal from "../../components/SourcingModal";
import ApprovalModal from "../../components/ApprovalModal";
import ReassignApprovalModal from "../../components/ReassignApprovalModal";
import ActivityTimeline from "../../components/ActivityTimeline";
import CancelLinesModal from "../../components/CancelLinesModal";

/** Request Detail — header + per-line pipeline view with stage actions. */
export default function RequestDetail() {
  const { id } = useParams();
  const s = useProcurementStore();
  // Every verb here acts on the requisition from the header. Cancel is the one
  // that still reaches individual LINES, so it opens a picker rather than acting
  // on all of them — see CancelLinesModal.
  const [sourcing, setSourcing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [cancellingLines, setCancellingLines] = useState(false);
  // Cancelling the WHOLE request is a distinct verb from cancelling one line, so
  // it gets its own state — sharing the slots above would cross-wire the two.
  const [cancellingRequest, setCancellingRequest] = useState(false);
  const [reqReason, setReqReason] = useState("");
  const [reqBusy, setReqBusy] = useState(false);
  const [reqErr, setReqErr] = useState<string | null>(null);

  const request = s.requestById(id ?? null);
  if (!request) {
    return <EmptyState title="Request not found" message="It may have been removed." actionLabel="Back to Requests" actionTo="/procurement/requests" />;
  }
  const co = s.companyById(request.companyId);
  const lines = s.itemsForRequest(request.id);
  const anyInSourcing = lines.some((l) => l.status === "sourcing");
  const anyInApproval = lines.some((l) => l.status === "approval" || l.status === "on_hold");
  /** Whoever this requisition has been handed to, or null if it sits with its band. */
  const holder = s.holderOfRequest(request);
  const mixedVendors = s.requestHasMixedVendors(request.id);

  // Activity for the request + all its lines, newest first.
  const lineIds = new Set(lines.map((l) => l.id));
  const activity = s.activity
    .filter((a) => (a.entityType === "request" && a.entityId === request.id) || (a.entityType === "line" && lineIds.has(a.entityId)))
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const canEdit = s.canEditRequest(request);
  // Wider than the per-row Cancel this replaces (approved_pending_po only): the
  // RPC refuses only po / cancelled / rejected, so all four open statuses are on
  // offer. Empty when the user is not a sourcing/PO owner, which hides the button.
  const cancellable = s.canCancelLines ? s.cancellableLinesForRequest(request.id) : [];

  const doCancelRequest = async () => {
    if (!reqReason.trim()) return setReqErr("A reason is required.");
    setReqBusy(true);
    setReqErr(null);
    try {
      await s.cancelRequest(request.id, reqReason.trim());
      setCancellingRequest(false);
      setReqReason("");
    } catch (e) {
      setReqErr((e as Error).message);
    } finally {
      setReqBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <Link to="/procurement/requests" className="text-[12.5px] text-grey hover:text-navy">← Requests</Link>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[22px] font-bold text-navy">{request.requestNo}</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">
            {co ? (co.location ? `${co.name} — ${co.location}` : co.name) : "—"} · {s.categoryById(request.categoryId)?.name ?? "—"} ·
            raised by {s.profileById(request.requesterId)?.name ?? "—"} on {formatDate(request.createdAt)}
          </p>
          {/* Where the approval actually sits. This is the oversight surface for
              a handover: the Approvals QUEUE deliberately shows only what is on
              your own desk, so without this line an admin browsing requisitions
              would have no way to see that one had been passed on. */}
          {holder && (
            <p className="text-[12.5px] text-navy mt-1">
              <span className="text-grey-2">Awaiting approval from</span>{" "}
              <span className="font-semibold">{s.personName(holder)}</span>
              <span className="text-grey-2"> · reassigned</span>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* ONE sourcing button. The modal always works on every open line at
              once, so a separate "Re-source" would open the identical screen —
              only the label changes once there is nothing left to source. */}
          {(anyInSourcing || anyInApproval) && s.canSource && (
            <Button
              size="sm"
              variant={anyInSourcing ? "primary" : "ghost"}
              onClick={() => setSourcing(true)}
            >
              {anyInSourcing ? "Source" : "Re-source"}
            </Button>
          )}
          {anyInApproval && s.canApproveRequest(request) && (
            <Button size="sm" onClick={() => setApproving(true)}>Approve</Button>
          )}
          {/* Hand it on, or pull it back. Broader than Approve on purpose: a band
              member keeps this after handing over, which is how it comes back. */}
          {anyInApproval && s.canReassignRequest(request) && (
            <Button variant="outline" size="sm" onClick={() => setReassigning(true)}>
              {holder ? "Reassign / take back" : "Reassign"}
            </Button>
          )}
          {/* The requester's own affordance — only before any buyer sources. */}
          {canEdit && (
            <Link to={`/procurement/requests/${request.id}/edit`}>
              <Button variant="outline" size="sm">Edit request</Button>
            </Link>
          )}
          {/* Line-level cancel: the sourcing/PO owners', and available from
              sourcing onwards — which is exactly where "Cancel request" below
              stops. The two are not alternatives; between them they cover the
              whole life of a requisition. */}
          {cancellable.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="!text-ryg-red hover:!border-ryg-red"
              onClick={() => setCancellingLines(true)}
            >
              {cancellable.length === 1 ? "Cancel line" : "Cancel lines"}
            </Button>
          )}
          {canEdit && (
            <Button
              size="sm"
              className="!bg-[#d4493f] !shadow-none hover:!bg-[#bf3d34]"
              onClick={() => { setReqReason(""); setReqErr(null); setCancellingRequest(true); }}
            >
              Cancel request
            </Button>
          )}
        </div>
      </div>

      {request.status === "cancelled" && (
        <Card className="px-4 py-3 border-ryg-red/40 bg-ryg-red/5">
          <p className="text-[13px] font-semibold text-navy">This request was cancelled</p>
          <p className="text-[12.5px] text-grey mt-0.5">
            {request.cancelReason || "No reason recorded."}
            {request.cancelledBy && <> — {s.profileById(request.cancelledBy)?.name ?? "someone"}</>}
            {request.cancelledAt && <>, {formatDate(request.cancelledAt)}</>}
          </p>
        </Card>
      )}

      {mixedVendors && (
        <p className="rounded-xl bg-ryg-red/10 px-3.5 py-2.5 text-[12.5px] text-ryg-red">
          This requisition's items were sourced to different vendors under the old per-item flow, so it can't be sourced as
          one requisition. Contact an admin to re-source these items individually.
        </p>
      )}

      {/* Progress rail — the full lifecycle from this requisition through to Tally,
          sitting on the least-advanced line. Kept above the details, per the
          "progress block is always first" convention. */}
      <Card className="px-4 py-4"><RequestStepper request={request} /></Card>

      {request.note && (
        // Was inverted: the word "Note:" was navy and bold while the note itself sat in
        // grey — the label outshouting its own data.
        <Card className="px-4 py-3">
          <Field label="Note" value={request.note} />
        </Card>
      )}

      <Card className="overflow-hidden">
        <ScrollableTable>
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="text-left text-grey-2 border-b border-line">
                <th className="font-medium px-4 py-3">Item</th>
                <th className="font-medium px-4 py-3">Qty</th>
                <th className="font-medium px-4 py-3">Status</th>
                <th className="font-medium px-4 py-3">Vendor</th>
                <th className="font-medium px-4 py-3">Rate</th>
                <th className="font-medium px-4 py-3">Lead</th>
                <th className="font-medium px-4 py-3">Line Value</th>
                <th className="font-medium px-4 py-3">PO</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const poItem = s.poItemForLine(l.id);
                const po = poItem ? s.poById(poItem.poId) : undefined;
                return (
                  <tr key={l.id} className="border-b border-line/70 last:border-0 hover:bg-page/60 align-middle">
                    <td className="px-4 py-3 font-medium text-navy">{s.itemLabel(l.itemId)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{l.quantity} {l.unit}</td>
                    <td className="px-4 py-3">
                      {/* The reject/cancel reason used to hang off a duplicate label in
                          the Actions column; it belongs on the status itself. */}
                      <span className={lineBadge(l.status)} title={l.rejectReason ?? l.cancelReason ?? undefined}>
                        {LINE_STATUS_LABEL[l.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{s.vendorById(l.finalVendorId)?.name ?? "—"}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{inr(l.finalRate)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{l.leadTimeDays === null ? "—" : `${l.leadTimeDays}d`}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{inr(l.lineValue)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {po ? <Link to={`/procurement/pos/${po.id}`} className="text-orange hover:underline font-medium">{po.poNo}</Link> : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {lines.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-line bg-orange-soft/50 align-middle">
                  <td className="px-4 py-3 text-right text-[11.5px] font-semibold uppercase tracking-wide text-grey-2">Total</td>
                  <td className="px-4 py-3 font-bold text-navy whitespace-nowrap">
                    <QtyTotal entries={lines.map((l) => ({ qty: l.quantity, unit: l.unit }))} />
                  </td>
                  <td colSpan={4} />
                  <td className="px-4 py-3 font-bold text-navy whitespace-nowrap">
                    {inr(lines.reduce((sum, l) => sum + (l.lineValue ?? 0), 0))}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </ScrollableTable>
      </Card>

      <div>
        <SectionHeading className="mb-3">Activity</SectionHeading>
        <ActivityTimeline rows={activity} />
      </div>

      <SourcingModal request={sourcing ? request : null} open={sourcing} onClose={() => setSourcing(false)} />
      <ApprovalModal request={approving ? request : null} open={approving} onClose={() => setApproving(false)} />
      <ReassignApprovalModal
        request={reassigning ? request : null}
        open={reassigning}
        onClose={() => setReassigning(false)}
      />

      <CancelLinesModal
        request={request}
        lines={cancellable}
        open={cancellingLines}
        onClose={() => setCancellingLines(false)}
      />

      <Modal
        open={cancellingRequest}
        onClose={() => setCancellingRequest(false)}
        title="Cancel request?"
        subtitle={request.requestNo}
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setCancellingRequest(false)} disabled={reqBusy}>Back</Button>
            <Button
              size="sm"
              className="!bg-[#d4493f] !shadow-none hover:!bg-[#bf3d34]"
              onClick={doCancelRequest}
              disabled={reqBusy}
            >
              {reqBusy ? "Cancelling…" : "Cancel request"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-[13.5px] text-grey leading-relaxed">
            This cancels {request.requestNo} and all {lines.length} of its line{lines.length === 1 ? "" : "s"}. The
            request stays on record, marked cancelled. This can't be undone.
          </p>
          <FieldLabel label="Reason" required>
            <TextArea rows={3} value={reqReason} onChange={(e) => setReqReason(e.target.value)} placeholder="Why is this request being cancelled?" />
          </FieldLabel>
          {reqErr && <p className="text-[12.5px] text-ryg-red">{reqErr}</p>}
        </div>
      </Modal>
    </div>
  );
}
