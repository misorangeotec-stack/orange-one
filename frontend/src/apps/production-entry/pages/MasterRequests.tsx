import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import Tabs from "@/shared/components/ui/Tabs";
import EmptyState from "@/shared/components/ui/EmptyState";
import Pagination from "@/shared/components/ui/Pagination";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { usePagination } from "@/shared/lib/usePagination";
import { formatDate } from "@/shared/lib/time";
import RequestMasterModal from "../components/RequestMasterModal";
import { useProductionStore } from "../store";
import { PRODUCTION_MASTER_TYPES, type ProductionMasterRequest } from "../types";
import { describePayload, masterTypeLabel, masterTypePlural } from "../lib/masterFields";

/**
 * Master Requests — one page, two audiences. A master's owner (and any admin) gets
 * the review queue: approve (adjusting the name first if needed) or reject with a
 * reason. Everyone else gets "My requests". Anyone can raise a new one.
 */
export default function MasterRequests() {
  const s = useProductionStore();
  const canReview = s.isAnyMasterManager;

  const [tab, setTab] = useState(canReview ? "review" : "mine");
  const [raising, setRaising] = useState(false);
  const [approving, setApproving] = useState<ProductionMasterRequest | null>(null);
  const [rejecting, setRejecting] = useState<ProductionMasterRequest | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const rows = useMemo(() => {
    const list = tab === "review" ? s.resolvableRequests : tab === "mine" ? s.myMasterRequests : s.masterRequests;
    return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [tab, s.resolvableRequests, s.myMasterRequests, s.masterRequests]);

  const pg = usePagination(rows, { resetKey: tab });
  const unassigned = PRODUCTION_MASTER_TYPES.filter((m) => s.isMasterUnassigned(m.value));

  const openApprove = (r: ProductionMasterRequest) => {
    setName(String(r.proposedPayload.name ?? ""));
    setErr(null);
    setApproving(r);
  };

  const doApprove = async () => {
    if (!approving) return;
    if (!name.trim()) { setErr("A name is required."); return; }
    setBusy(true); setErr(null);
    try { await s.resolveMasterRequest(approving.id, true, { name: name.trim() }, null); setApproving(null); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const doReject = async () => {
    if (!rejecting) return;
    if (!note.trim()) { setErr("A reason is required to reject."); return; }
    setBusy(true); setErr(null);
    try { await s.resolveMasterRequest(rejecting.id, false, null, note.trim()); setRejecting(null); setNote(""); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const statusBadge = (st: ProductionMasterRequest["status"]) => {
    const map = { pending: "text-orange bg-orange-soft", approved: "text-ryg-green bg-[#E9F8EF]", rejected: "text-ryg-red bg-[#FDECEC]" } as const;
    return <span className={`inline-flex items-center text-[11px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${map[st]}`}>{st}</span>;
  };

  const tabs = canReview
    ? [
        { key: "review", label: "To review", count: s.resolvableRequests.length },
        { key: "mine", label: "My requests", count: s.myMasterRequests.length },
        { key: "all", label: "All", count: s.masterRequests.length },
      ]
    : [{ key: "mine", label: "My requests", count: s.myMasterRequests.length }];

  const emptyMessage =
    tab === "review" ? "Nothing waiting on you. New-master requests for the masters you own will appear here."
    : tab === "mine" ? "You haven't requested any new master entries. Missing something from a dropdown? Request it here."
    : "New-master requests will appear here for review.";

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-navy">Master Requests</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">
            {canReview
              ? "New-master-entry requests raised from across the floor. Approve to add them to the master — or reject with a reason."
              : "Entries you've asked to add to the production masters. Once the owner approves one, it's selectable on the issue slip."}
          </p>
        </div>
        <Button size="sm" onClick={() => setRaising(true)}>Request new entry</Button>
      </div>

      {canReview && unassigned.length > 0 && (
        <div className="rounded-xl border border-orange/30 bg-orange-soft/40 px-4 py-3 text-[12.5px] text-navy">
          <span className="font-semibold">{unassigned.map((m) => m.plural).join(", ")}</span>{" "}
          {unassigned.length === 1 ? "has" : "have"} no assigned owner — those requests fall back to the admins. Assign one in{" "}
          <span className="font-semibold">Setup → Master Owners</span>.
        </div>
      )}

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState title="No requests" message={emptyMessage} />
        ) : (
          <>
            <ScrollableTable>
              <table className="w-full text-[13.5px]">
                <thead>
                  <tr className="text-left text-grey-2 border-b border-line">
                    <th className="font-medium px-4 py-3 w-px whitespace-nowrap">Actions</th>
                    <th className="font-medium px-4 py-3">Type</th>
                    <th className="font-medium px-4 py-3">Proposed</th>
                    <th className="font-medium px-4 py-3">Requested by</th>
                    <th className="font-medium px-4 py-3">Date</th>
                    <th className="font-medium px-4 py-3">Status</th>
                    <th className="font-medium px-4 py-3">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {pg.pageItems.map((r) => {
                    const canResolve = r.status === "pending" && s.canManage(r.masterType);
                    return (
                      <tr key={r.id} className="border-b border-line/70 last:border-0 hover:bg-page/60">
                        <td className="px-4 py-3 whitespace-nowrap">
                          {canResolve ? (
                            <>
                              <button onClick={() => openApprove(r)} className="text-[12.5px] font-semibold text-ryg-green hover:underline mr-3">Approve</button>
                              <button onClick={() => { setNote(""); setErr(null); setRejecting(r); }} className="text-[12.5px] font-semibold text-ryg-red hover:underline">Reject</button>
                            </>
                          ) : (
                            <span className="text-grey-2 text-[12.5px]">{r.status === "pending" ? "Awaiting review" : "—"}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-medium text-navy whitespace-nowrap">{masterTypeLabel(r.masterType)}</td>
                        <td className="px-4 py-3">{describePayload(r.masterType, r.proposedPayload)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{s.profileById(r.requestedBy ?? "")?.name ?? "—"}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{formatDate(r.createdAt)}</td>
                        <td className="px-4 py-3">{statusBadge(r.status)}</td>
                        <td className="px-4 py-3">
                          {r.status === "approved" ? (
                            <span className="text-ryg-green">Added to {masterTypePlural(r.masterType)}</span>
                          ) : r.reviewNote ? (
                            <span className="text-grey">{r.reviewNote}</span>
                          ) : (
                            <span className="text-grey-2">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollableTable>
            <Pagination state={pg} rowsLabel="requests" />
          </>
        )}
      </Card>

      <RequestMasterModal open={raising} onClose={() => setRaising(false)} onRequested={() => setTab("mine")} />

      <Modal
        open={approving !== null}
        onClose={() => setApproving(null)}
        title={`Approve ${approving ? masterTypeLabel(approving.masterType) : ""}`}
        subtitle="Review the name, then add it to the master."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setApproving(null)} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={doApprove} disabled={busy}>{busy ? "Adding…" : "Approve & add"}</Button>
          </>
        }
      >
        <div className="space-y-3.5">
          <FieldLabel label="Name" required>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} />
          </FieldLabel>
          {approving && <p className="text-[12px] text-grey-2">Requested by {s.profileById(approving.requestedBy ?? "")?.name ?? "—"} on {formatDate(approving.createdAt)}.</p>}
          {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
        </div>
      </Modal>

      <Modal
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        title={`Reject ${rejecting ? masterTypeLabel(rejecting.masterType) : ""}`}
        subtitle="The requester is notified, and sees the reason on their request."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setRejecting(null)} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={doReject} disabled={busy}>{busy ? "Rejecting…" : "Reject"}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <FieldLabel label="Reason" required>
            <TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why is this being rejected?" />
          </FieldLabel>
          {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
        </div>
      </Modal>
    </div>
  );
}
