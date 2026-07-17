import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import Tabs from "@/shared/components/ui/Tabs";
import Combobox from "@/shared/components/ui/Combobox";
import EmptyState from "@/shared/components/ui/EmptyState";
import Pagination from "@/shared/components/ui/Pagination";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { usePagination } from "@/shared/lib/usePagination";
import { formatDate } from "@/shared/lib/time";
import RequestMasterModal from "../components/RequestMasterModal";
import { useSuppliesStore } from "../store";
import { REQUESTABLE_SUPPLY_MASTER_TYPES, type SupplyMasterRequest } from "../types";
import {
  describePayload,
  masterFields,
  masterTypeLabel,
  masterTypePlural,
  missingRequired,
  type MasterFieldContext,
  type MasterValues,
} from "../lib/masterFields";

/** Master Requests — ONE PAGE, TWO AUDIENCES, open to everyone. */
export default function MasterRequests() {
  const s = useSuppliesStore();
  const ctx: MasterFieldContext = useMemo(() => ({ categories: s.categories }), [s.categories]);
  const canReview = s.isAnyMasterManager;

  const [tab, setTab] = useState(canReview ? "review" : "mine");
  const [raising, setRaising] = useState(false);
  const [approving, setApproving] = useState<SupplyMasterRequest | null>(null);
  const [rejecting, setRejecting] = useState<SupplyMasterRequest | null>(null);
  const [values, setValues] = useState<MasterValues>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const nameOf = (id: string | null) => (id ? (s.profileById(id)?.name ?? "—") : "—");
  const categoryName = (id: string) => s.categoryById(id)?.name ?? "—";

  const rows = useMemo(() => {
    const list = tab === "review" ? s.resolvableRequests : tab === "mine" ? s.myMasterRequests : s.masterRequests;
    return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [tab, s.resolvableRequests, s.myMasterRequests, s.masterRequests]);

  const pg = usePagination(rows, { resetKey: tab });

  const unassigned = REQUESTABLE_SUPPLY_MASTER_TYPES.filter((m) => s.isMasterUnassigned(m.value));

  const openApprove = (r: SupplyMasterRequest) => {
    const proposed = r.proposedPayload as Record<string, unknown>;
    const seeded: MasterValues = {};
    for (const f of masterFields(r.masterType, ctx)) {
      const v = proposed[f.key];
      seeded[f.key] = typeof v === "string" ? v : v == null ? "" : String(v);
      if (!seeded[f.key] && f.type === "select") seeded[f.key] = f.options?.[0]?.value ?? "";
    }
    setValues(seeded);
    setErr(null);
    setApproving(r);
  };

  const doApprove = async () => {
    if (!approving) return;
    const missing = missingRequired(approving.masterType, values, ctx);
    if (missing) {
      setErr(missing);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await s.resolveMasterRequest(approving.id, true, values, null);
      setApproving(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doReject = async () => {
    if (!rejecting) return;
    if (!note.trim()) {
      setErr("A reason is required to reject.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await s.resolveMasterRequest(rejecting.id, false, null, note.trim());
      setRejecting(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const statusBadge = (st: SupplyMasterRequest["status"]) => {
    const map = {
      pending: "text-orange bg-orange-soft",
      approved: "text-ryg-green bg-[#E9F8EF]",
      rejected: "text-ryg-red bg-[#FDECEC]",
    } as const;
    return (
      <span className={`inline-flex items-center text-[11px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${map[st]}`}>
        {st}
      </span>
    );
  };

  const tabs = canReview
    ? [
        { key: "review", label: "To review", count: s.resolvableRequests.length },
        { key: "mine", label: "My requests", count: s.myMasterRequests.length },
        { key: "all", label: "All", count: s.masterRequests.length },
      ]
    : [{ key: "mine", label: "My requests", count: s.myMasterRequests.length }];

  const approveFields = approving ? masterFields(approving.masterType, ctx) : [];

  const emptyMessage =
    tab === "review"
      ? "Nothing waiting on you. New-master requests for the masters you own will appear here."
      : tab === "mine"
        ? "You haven't requested any new master entries. Missing something from a dropdown? Request it here or straight from the form."
        : "New-master requests will appear here for review.";

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-navy">Master Requests</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">
            {canReview
              ? "New-item and new-service requests raised from the supply forms. Approve to add them to the master — adjusting first if needed — or reject with a reason."
              : "Entries you've asked to add. Once the master's owner approves one, it's selectable on the forms."}
          </p>
        </div>
        <Button size="sm" onClick={() => setRaising(true)}>
          Request new entry
        </Button>
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
                              <button onClick={() => openApprove(r)} className="text-[12.5px] font-semibold text-ryg-green hover:underline mr-3">
                                Approve
                              </button>
                              <button onClick={() => { setNote(""); setErr(null); setRejecting(r); }} className="text-[12.5px] font-semibold text-ryg-red hover:underline">
                                Reject
                              </button>
                            </>
                          ) : (
                            <span className="text-grey-2 text-[12.5px]">{r.status === "pending" ? "Awaiting review" : "—"}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-medium text-navy whitespace-nowrap">{masterTypeLabel(r.masterType)}</td>
                        <td className="px-4 py-3">{describePayload(r.masterType, r.proposedPayload, categoryName)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{nameOf(r.requestedBy)}</td>
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

      <RequestMasterModal open={raising} onClose={() => setRaising(false)} masterType={null} onRequested={() => setTab("mine")} />

      <Modal
        open={approving !== null}
        onClose={() => setApproving(null)}
        title={`Approve ${approving ? masterTypeLabel(approving.masterType) : ""}`}
        subtitle="Review and adjust the details, then add it to the master."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setApproving(null)} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={doApprove} disabled={busy}>{busy ? "Adding…" : "Approve & add"}</Button>
          </>
        }
      >
        <div className="space-y-3.5">
          {approveFields.map((f) => (
            <FieldLabel key={f.key} label={f.label} required={f.required}>
              {f.type === "select" ? (
                <Combobox value={values[f.key] ?? ""} onChange={(v) => setValues((p) => ({ ...p, [f.key]: v }))} options={f.options ?? []} placeholder={f.placeholder ?? "Select…"} autoAdvance />
              ) : (
                <TextInput value={values[f.key] ?? ""} placeholder={f.placeholder} onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))} />
              )}
              {f.hint && <span className="mt-1 block text-[11px] leading-snug text-grey">{f.hint}</span>}
            </FieldLabel>
          ))}
          {approving && <p className="text-[12px] text-grey-2">Requested by {nameOf(approving.requestedBy)} on {formatDate(approving.createdAt)}.</p>}
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
