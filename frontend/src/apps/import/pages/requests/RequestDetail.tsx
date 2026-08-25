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
import { useImportStore } from "../../store";
import { lineBadge, LINE_STATUS_LABEL } from "../../lib/format";
import ApprovalModal from "../../components/ApprovalModal";
import CancelLinesModal from "../../components/CancelLinesModal";
import RequestStepper from "../../components/RequestStepper";
import QtyTotal from "../../components/QtyTotal";
import ActivityTimeline from "../../components/ActivityTimeline";
import { shipmentLabel } from "../../types";
import type { RequestItem } from "../../types";

/** Request Detail — header + per-line pipeline view with stage actions. */
export default function RequestDetail() {
  const { id } = useParams();
  const s = useImportStore();
  const [approving, setApproving] = useState(false);
  const [cancellingLines, setCancellingLines] = useState(false);
  // Cancelling the WHOLE request is a different verb from cancelling lines, so it
  // gets its own state slots — sharing them would cross-wire the two dialogs.
  const [cancellingRequest, setCancellingRequest] = useState(false);
  const [reqReason, setReqReason] = useState("");
  const [reqBusy, setReqBusy] = useState(false);
  const [reqErr, setReqErr] = useState<string | null>(null);

  const request = s.requestById(id ?? null);
  if (!request) {
    return <EmptyState title="Request not found" message="It may have been removed." actionLabel="Back to Requests" actionTo="/import/requests" />;
  }
  const co = s.companyById(request.companyId);
  const lines = s.itemsForRequest(request.id);

  // A request may span categories, so the header lists every distinct one its
  // lines carry. Lines predating per-line category fall back to the header's.
  const lineCategory = (l: RequestItem) => s.categoryById(l.categoryId ?? request.categoryId)?.name ?? "—";
  const categoryLabel = [...new Set(lines.map(lineCategory))].filter((n) => n !== "—").join(", ")
    || (s.categoryById(request.categoryId)?.name ?? "—");

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
  const anyInApproval = lines.some((l) => l.status === "approval" || l.status === "on_hold");

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
      <Link to="/import/requests" className="text-[12.5px] text-grey hover:text-navy">← Requests</Link>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[22px] font-bold text-navy">{request.requestNo}</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">
            {co ? (co.location ? `${co.name} — ${co.location}` : co.name) : "—"} · {categoryLabel} ·{" "}
            {s.vendorLabel(request.vendorId)}
            {request.shipmentType && <> · <span className="font-medium text-navy">{shipmentLabel(request.shipmentType)}</span></>} ·
            raised by {s.profileById(request.requesterId)?.name ?? "—"} on {formatDate(request.createdAt)}
            {request.editedAt && <> · edited {formatDate(request.editedAt)}</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* ONE approve button for the whole requisition — the band is picked on
              its total, so it is approved or rejected together. The modal shows
              every item under decision. */}
          {anyInApproval && s.canApproveRequest(request) && (
            <Button size="sm" onClick={() => setApproving(true)}>Approve</Button>
          )}
          {/* The requester's own affordances — only the raiser (or an admin) and
              only while nothing has been decided. The RPCs re-check server-side. */}
          {canEdit && (
            <Link to={`/import/requests/${request.id}/edit`}>
              <Button variant="outline" size="sm">Edit request</Button>
            </Link>
          )}
          {/* Line-level cancel: the PO owners' (Import has no sourcing owner),
              and available from approval onwards — which is exactly where
              "Cancel request" below stops. The two are not alternatives; between
              them they cover the whole life of a requisition. */}
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
                <th className="font-medium px-4 py-3">Category</th>
                <th className="font-medium px-4 py-3">Item</th>
                <th className="font-medium px-4 py-3">Qty</th>
                <th className="font-medium px-4 py-3">Status</th>
                <th className="font-medium px-4 py-3">Vendor</th>
                <th className="font-medium px-4 py-3">PO</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const poItem = s.poItemForLine(l.id);
                const po = poItem ? s.poById(poItem.poId) : undefined;
                return (
                  <tr key={l.id} className="border-b border-line/70 last:border-0 hover:bg-page/60 align-middle">
                    <td className="px-4 py-3 whitespace-nowrap text-grey">{lineCategory(l)}</td>
                    <td className="px-4 py-3 font-medium text-navy">{s.itemLabel(l.itemId)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{l.quantity} {l.unit}</td>
                    <td className="px-4 py-3"><span className={lineBadge(l.status)} title={l.rejectReason ?? l.cancelReason ?? undefined}>{LINE_STATUS_LABEL[l.status]}</span></td>
                    <td className="px-4 py-3 whitespace-nowrap">{s.vendorById(l.finalVendorId)?.name ?? "—"}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {po ? <Link to={`/import/pos/${po.id}`} className="text-orange hover:underline font-medium">{po.poNo}</Link> : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {lines.length > 0 && (
              <tfoot>
                {/* Qty total aligns under the Qty column. */}
                <tr className="border-t-2 border-line bg-orange-soft/50">
                  <td colSpan={2} className="px-4 py-3 text-right text-[11.5px] font-semibold uppercase tracking-wide text-grey-2">Total</td>
                  <td className="px-4 py-3 whitespace-nowrap font-bold text-navy">
                    <QtyTotal entries={lines.map((l) => ({ qty: l.quantity, unit: l.unit }))} />
                  </td>
                  <td colSpan={3} />
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

      {/* No SourcingModal here. It took a LINE, and the per-line Source /
          Re-source button that fed it died with the Actions column in d6c9f65 —
          its `sourcing` state sat here for five weeks, only ever set to null.
          Not rebuilt on purpose: Import lines are born at 'approval', Import
          approval carries no rate or value, and no 'sourcing' step owner is
          configured, so the stage feeds nothing this app routes on. The live
          Source path is the Sourcing Queue. Retire-or-rebuild is WORKLIST PU-1. */}
      <ApprovalModal request={approving ? request : null} open={approving} onClose={() => setApproving(false)} />

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
