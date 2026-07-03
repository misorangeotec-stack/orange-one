import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import EmptyState from "@/shared/components/ui/EmptyState";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
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
  const [sourcing, setSourcing] = useState<RequestItem | null>(null);
  const [approving, setApproving] = useState<RequestItem | null>(null);
  const [cancelling, setCancelling] = useState<RequestItem | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const request = s.requestById(id ?? null);
  if (!request) {
    return <EmptyState title="Request not found" message="It may have been removed." actionLabel="Back to Requests" actionTo="/procurement/requests" />;
  }
  const co = s.companyById(request.companyId);
  const lines = s.itemsForRequest(request.id);

  // Activity for the request + all its lines, newest first.
  const lineIds = new Set(lines.map((l) => l.id));
  const activity = s.activity
    .filter((a) => (a.entityType === "request" && a.entityId === request.id) || (a.entityType === "line" && lineIds.has(a.entityId)))
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

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
      <Link to="/procurement/requests" className="text-[12.5px] text-grey hover:text-navy">← Requests</Link>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[22px] font-bold text-navy">{request.requestNo}</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">
            {co ? (co.location ? `${co.name} — ${co.location}` : co.name) : "—"} · {s.categoryById(request.categoryId)?.name ?? "—"} ·
            raised by {s.profileById(request.requesterId)?.name ?? "—"} on {formatDate(request.createdAt)}
          </p>
        </div>
      </div>

      {request.note && (
        <Card className="px-4 py-3 text-[13px] text-grey">
          <span className="font-medium text-navy">Note:</span> {request.note}
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
                <th className="font-medium px-4 py-3">Line Value</th>
                <th className="font-medium px-4 py-3">PO</th>
                <th className="font-medium px-4 py-3 text-right">Actions</th>
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
                    <td className="px-4 py-3"><span className={lineBadge(l.status)}>{LINE_STATUS_LABEL[l.status]}</span></td>
                    <td className="px-4 py-3 whitespace-nowrap">{s.vendorById(l.finalVendorId)?.name ?? "—"}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{inr(l.finalRate)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{inr(l.lineValue)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {po ? <Link to={`/procurement/pos/${po.id}`} className="text-orange hover:underline font-medium">{po.poNo}</Link> : "—"}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {(l.status === "sourcing") && s.canSource && (
                        <button onClick={() => setSourcing(l)} className="text-[12.5px] font-semibold text-orange hover:underline">Source</button>
                      )}
                      {(l.status === "approval" || l.status === "on_hold") && (
                        <>
                          {s.canApproveLine(l) && (
                            <button onClick={() => setApproving(l)} className="text-[12.5px] font-semibold text-orange hover:underline mr-3">Approve</button>
                          )}
                          {s.canSource && (
                            <button onClick={() => setSourcing(l)} className="text-[12.5px] font-semibold text-grey hover:text-navy">Re-source</button>
                          )}
                        </>
                      )}
                      {l.status === "approved_pending_po" && (s.canGeneratePo || s.canSource) && (
                        <button onClick={() => { setReason(""); setErr(null); setCancelling(l); }} className="text-[12.5px] font-semibold text-ryg-red hover:underline">Cancel</button>
                      )}
                      {l.status === "rejected" && <span className="text-[12px] text-grey-2" title={l.rejectReason ?? ""}>Rejected</span>}
                      {l.status === "cancelled" && <span className="text-[12px] text-grey-2" title={l.cancelReason ?? ""}>Cancelled</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollableTable>
      </Card>

      <div>
        <h2 className="text-[15px] font-semibold text-navy mb-2">Activity</h2>
        <ActivityTimeline rows={activity} />
      </div>

      <SourcingModal line={sourcing} open={sourcing !== null} onClose={() => setSourcing(null)} />
      <ApprovalModal line={approving} open={approving !== null} onClose={() => setApproving(null)} />

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
    </div>
  );
}
