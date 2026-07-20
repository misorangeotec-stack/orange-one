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
import SourcingModal from "../../components/SourcingModal";
import ApprovalModal from "../../components/ApprovalModal";
import ActivityTimeline from "../../components/ActivityTimeline";
import type { RequestItem } from "../../types";

/** Request Detail — header + per-line pipeline view with stage actions. */
export default function RequestDetail() {
  const { id } = useParams();
  const s = useProcurementStore();
  // Sourcing and approval act on the WHOLE requisition now; only Cancel is still
  // genuinely per line (cancel_line is unchanged).
  const [sourcing, setSourcing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [cancelling, setCancelling] = useState<RequestItem | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
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
  const mixedVendors = s.requestHasMixedVendors(request.id);

  // Activity for the request + all its lines, newest first.
  const lineIds = new Set(lines.map((l) => l.id));
  const activity = s.activity
    .filter((a) => (a.entityType === "request" && a.entityId === request.id) || (a.entityType === "line" && lineIds.has(a.entityId)))
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const canEdit = s.canEditRequest(request);

  const doCancel = async () => {
    if (!cancelling) return;
    if (!reason.trim()) return setErr("A reason is required.");
    setBusy(true);
    setErr(null);
    try {
      await s.cancelLine(cancelling.id, reason.trim());
      setCancelling(null);
      setReason("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

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
          {/* The requester's own affordances — only before any buyer sources. */}
          {canEdit && (
            <>
              <Link to={`/procurement/requests/${request.id}/edit`}>
                <Button variant="outline" size="sm">Edit request</Button>
              </Link>
              <Button
                size="sm"
                className="!bg-[#d4493f] !shadow-none hover:!bg-[#bf3d34]"
                onClick={() => { setReqReason(""); setReqErr(null); setCancellingRequest(true); }}
              >
                Cancel request
              </Button>
            </>
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
          </table>
        </ScrollableTable>
      </Card>

      <div>
        <SectionHeading className="mb-3">Activity</SectionHeading>
        <ActivityTimeline rows={activity} />
      </div>

      <SourcingModal request={sourcing ? request : null} open={sourcing} onClose={() => setSourcing(false)} />
      <ApprovalModal request={approving ? request : null} open={approving} onClose={() => setApproving(false)} />

      <Modal
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        title="Cancel line"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setCancelling(null)} disabled={busy}>Back</Button>
            <Button size="sm" onClick={doCancel} disabled={busy}>{busy ? "Cancelling…" : "Cancel line"}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <FieldLabel label="Reason" required>
            <TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this line being cancelled?" />
          </FieldLabel>
          {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
        </div>
      </Modal>

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
