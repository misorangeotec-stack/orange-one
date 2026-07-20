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
import { inr, fxMoney, lineBadge, LINE_STATUS_LABEL } from "../../lib/format";
import SourcingModal from "../../components/SourcingModal";
import ApprovalModal from "../../components/ApprovalModal";
import ActivityTimeline from "../../components/ActivityTimeline";
import type { RequestItem } from "../../types";

/** Request Detail — header + per-line pipeline view with stage actions. */
export default function RequestDetail() {
  const { id } = useParams();
  const s = useImportStore();
  const [sourcing, setSourcing] = useState<RequestItem | null>(null);
  const [approving, setApproving] = useState(false);
  const [cancelling, setCancelling] = useState<RequestItem | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Cancelling the WHOLE request is a different verb from cancelling one line,
  // so it gets its own four state slots — sharing reason/busy/err with the line
  // modal above would cross-wire the two dialogs.
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

  return (
    <div className="space-y-5">
      <Link to="/import/requests" className="text-[12.5px] text-grey hover:text-navy">← Requests</Link>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[22px] font-bold text-navy">{request.requestNo}</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">
            {co ? (co.location ? `${co.name} — ${co.location}` : co.name) : "—"} · {categoryLabel} ·
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
            <>
              <Link to={`/import/requests/${request.id}/edit`}>
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
                <th className="font-medium px-4 py-3 w-px whitespace-nowrap">Actions</th>
                <th className="font-medium px-4 py-3">Category</th>
                <th className="font-medium px-4 py-3">Item</th>
                <th className="font-medium px-4 py-3">Qty</th>
                <th className="font-medium px-4 py-3">Status</th>
                <th className="font-medium px-4 py-3">Vendor</th>
                <th className="font-medium px-4 py-3">Rate</th>
                <th className="font-medium px-4 py-3">Value ({request.currency ?? "FCY"})</th>
                <th className="font-medium px-4 py-3">Value (INR)</th>
                <th className="font-medium px-4 py-3">PO</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const poItem = s.poItemForLine(l.id);
                const po = poItem ? s.poById(poItem.poId) : undefined;
                return (
                  <tr key={l.id} className="border-b border-line/70 last:border-0 hover:bg-page/60 align-middle">
                    <td className="px-4 py-3 whitespace-nowrap">
                      {(l.status === "sourcing") && s.canSource && (
                        <button onClick={() => setSourcing(l)} className="text-[12.5px] font-semibold text-orange hover:underline">Source</button>
                      )}
                      {/* Approval is decided for the whole requisition from the
                          header button above; the per-line action here is only
                          the sourcer's Re-source. */}
                      {(l.status === "approval" || l.status === "on_hold") && s.canSource && (
                        <button onClick={() => setSourcing(l)} className="text-[12.5px] font-semibold text-grey hover:text-navy">Re-source</button>
                      )}
                      {l.status === "approved_pending_po" && (s.canGeneratePo || s.canSource) && (
                        <button onClick={() => { setReason(""); setErr(null); setCancelling(l); }} className="text-[12.5px] font-semibold text-ryg-red hover:underline">Cancel</button>
                      )}
                      {l.status === "rejected" && <span className="text-[12px] text-grey-2" title={l.rejectReason ?? ""}>Rejected</span>}
                      {l.status === "cancelled" && <span className="text-[12px] text-grey-2" title={l.cancelReason ?? ""}>Cancelled</span>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-grey">{lineCategory(l)}</td>
                    <td className="px-4 py-3 font-medium text-navy">{s.itemLabel(l.itemId)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{l.quantity} {l.unit}</td>
                    <td className="px-4 py-3"><span className={lineBadge(l.status)}>{LINE_STATUS_LABEL[l.status]}</span></td>
                    <td className="px-4 py-3 whitespace-nowrap">{s.vendorById(l.finalVendorId)?.name ?? "—"}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{fxMoney(l.finalRate, l.currency)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{fxMoney(l.lineValueFx, l.currency)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{inr(l.lineValue)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {po ? <Link to={`/import/pos/${po.id}`} className="text-orange hover:underline font-medium">{po.poNo}</Link> : "—"}
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

      <SourcingModal line={sourcing} open={sourcing !== null} onClose={() => setSourcing(null)} />
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
