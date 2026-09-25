import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import Tabs from "@/shared/components/ui/Tabs";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import Combobox from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { formatDate } from "@/shared/lib/time";
import RequestMasterModal from "../components/RequestMasterModal";
import { useProcurementStore } from "../store";
import { MASTER_TYPES, type MasterRequest } from "../types";
import {
  describePayload,
  masterFields,
  masterTypeLabel,
  masterTypePlural,
  missingRequired,
  type MasterValues,
} from "../lib/masterFields";
import { useMasterFieldCtx } from "../lib/useMasterFieldCtx";

/**
 * Master Requests — one page, two audiences.
 *
 * A master's manager (and any admin) gets the review queue: approve, adjusting
 * the proposed values first if needed, or reject with a reason. Everyone else
 * gets "My requests" — the entries they've asked for and where each one stands.
 * Anyone can raise a new one from here for any master.
 */
export default function MasterRequests() {
  const s = useProcurementStore();
  const canReview = s.isAnyManager;

  const [tab, setTab] = useState(canReview ? "review" : "mine");
  const [raising, setRaising] = useState(false);
  const [approving, setApproving] = useState<MasterRequest | null>(null);
  const [rejecting, setRejecting] = useState<MasterRequest | null>(null);
  const [values, setValues] = useState<MasterValues>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Shared so vendor_item_price's Vendor/Item dropdowns can never render empty.
  const ctx = useMasterFieldCtx();

  const describe = (r: MasterRequest) =>
    describePayload(r.masterType, r.proposedPayload as Record<string, unknown>, {
      categoryName: (id) => s.categoryById(id)?.name,
      itemGroupName: (id) => s.itemGroupById(id)?.name,
      vendorName: (id) => s.vendorById(id)?.name,
      itemName: (id) => s.itemById(id)?.name,
    });

  const rows = useMemo(() => {
    const list =
      tab === "review" ? s.resolvableRequests : tab === "mine" ? s.myMasterRequests : s.masterRequests;
    return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [tab, s.resolvableRequests, s.myMasterRequests, s.masterRequests]);


  /** Masters nobody owns — their requests land with the admins until someone is assigned. */
  const unassigned = MASTER_TYPES.filter((m) => s.isMasterUnassigned(m.value));

  const openApprove = (r: MasterRequest) => {
    setValues({ ...(r.proposedPayload as MasterValues) });
    setErr(null);
    setApproving(r);
  };
  const openReject = (r: MasterRequest) => {
    setNote("");
    setErr(null);
    setRejecting(r);
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

  const statusBadge = (st: MasterRequest["status"]) => {
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

  const personName = (id: string | null | undefined) => (id ? s.profileById(id)?.name ?? "—" : "—");
  const outcomeText = (r: MasterRequest) =>
    r.status === "approved" ? `Added to ${masterTypePlural(r.masterType)}` : r.reviewNote || "—";

  const columns: QueueColumn<MasterRequest>[] = [
    {
      key: "type",
      header: "Type",
      cell: (r) => <span className="font-medium text-navy">{masterTypeLabel(r.masterType)}</span>,
      sortValue: (r) => masterTypeLabel(r.masterType),
      filter: { kind: "select", get: (r) => masterTypeLabel(r.masterType) },
    },
    {
      key: "proposed",
      header: "Proposed",
      cell: (r) => describe(r),
      sortValue: (r) => describe(r),
      // Free text, a different value on every row — a search box, not a list that
      // would only restate the table.
      filter: { kind: "text", get: (r) => describe(r) },
    },
    {
      key: "requestedBy",
      header: "Requested by",
      cell: (r) => personName(r.requestedBy),
      sortValue: (r) => personName(r.requestedBy),
      filter: { kind: "select", get: (r) => personName(r.requestedBy) },
    },
    {
      key: "date",
      header: "Date",
      cell: (r) => formatDate(r.createdAt),
      sortValue: (r) => r.createdAt,
      filter: { kind: "date", get: (r) => r.createdAt.slice(0, 10) },
      exportValue: (r) => formatDate(r.createdAt),
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => statusBadge(r.status),
      sortValue: (r) => r.status,
      filter: { kind: "select", get: (r) => r.status },
      // A pill: never cut, no handle.
      resize: false,
    },
    {
      key: "reviewedBy",
      header: "Reviewed by",
      cell: (r) => (r.reviewedBy ? personName(r.reviewedBy) : <span className="text-grey-2">—</span>),
      sortValue: (r) => (r.reviewedBy ? personName(r.reviewedBy) : ""),
      filter: { kind: "select", get: (r) => (r.reviewedBy ? personName(r.reviewedBy) : "—") },
    },
    {
      key: "outcome",
      header: "Outcome",
      cell: (r) =>
        r.status === "approved" ? (
          <span className="text-ryg-green">Added to {masterTypePlural(r.masterType)}</span>
        ) : r.reviewNote ? (
          <span className="text-grey">{r.reviewNote}</span>
        ) : (
          <span className="text-grey-2">—</span>
        ),
      sortValue: (r) => outcomeText(r),
      filter: { kind: "text", get: (r) => outcomeText(r) },
    },
  ];

  const approveFields = approving ? masterFields(approving.masterType, ctx) : [];

  const emptyMessage =
    tab === "review"
      ? "Nothing waiting on you. New-master requests for the masters you own will appear here."
      : tab === "mine"
        ? "You haven't requested any new master entries. Missing something from a dropdown? Request it — here or straight from the form."
        : "New-master requests will appear here for review.";

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-navy">Master Requests</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">
            {canReview
              ? "New-master-entry requests raised from across the workflow. Approve to add them to the master — adjusting the details first if you need to — or reject with a reason."
              : "Entries you've asked to add to the purchase masters. Once the master's owner approves one, it's selectable on the forms."}
          </p>
        </div>
        {/* Asking for a new master IS a write — it creates a pending row someone
            then has to review. Ungated until now, in every FMS. */}
        {s.canEdit && (
          <Button size="sm" onClick={() => setRaising(true)}>
            Request new entry
          </Button>
        )}
      </div>

      {canReview && unassigned.length > 0 && (
        <div className="rounded-xl border border-orange/30 bg-orange-soft/40 px-4 py-3 text-[12.5px] text-navy">
          <span className="font-semibold">{unassigned.map((m) => m.plural).join(", ")}</span>{" "}
          {unassigned.length === 1 ? "has" : "have"} no assigned owner — those requests fall back to the admins. Assign
          one in <span className="font-semibold">Setup → Master Owners</span>.
        </div>
      )}

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {/* A QueueTable since PF-20 (it was a hand-built table with no sort or filter): every
          column sorts and filters, rows are one line. Keyed by tab so a filter set on one
          list does not silently narrow the next. Every control it had is still here —
          Approve / Reject per row, "Awaiting review", the empty message, 25 a page. */}
      <Card className="p-4">
        <QueueTable
          key={tab}
          rows={rows}
          rowKey={(r) => r.id}
          columns={columns}
          rowsLabel="requests"
          emptyTitle="No requests"
          emptyMessage={emptyMessage}
          actions={(r) =>
            r.status === "pending" && s.canManage(r.masterType) ? (
              <>
                <button onClick={() => openApprove(r)} className="text-[12.5px] font-semibold text-ryg-green hover:underline mr-3">
                  Approve
                </button>
                <button onClick={() => openReject(r)} className="text-[12.5px] font-semibold text-ryg-red hover:underline">
                  Reject
                </button>
              </>
            ) : (
              <span className="text-grey-2 text-[12.5px]">{r.status === "pending" ? "Awaiting review" : "—"}</span>
            )
          }
        />
      </Card>

      {/* Raise a request for any master, from one place. */}
      <RequestMasterModal
        open={raising}
        onClose={() => setRaising(false)}
        masterType={null}
        onRequested={() => setTab("mine")}
      />

      {/* Approve — edit before adding */}
      <Modal
        open={approving !== null}
        onClose={() => setApproving(null)}
        title={`Approve ${approving ? masterTypeLabel(approving.masterType) : ""}`}
        subtitle="Review and adjust the details, then add it to the master."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setApproving(null)} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={doApprove} disabled={busy}>
              {busy ? "Adding…" : "Approve & add"}
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          {approveFields.map((f) => (
            <FieldLabel key={f.key} label={f.label} required={f.required}>
              {f.type === "select" ? (
                <Combobox
                  value={values[f.key] ?? ""}
                  onChange={(v) => setValues((p) => ({ ...p, [f.key]: v }))}
                  options={f.options ?? []}
                  placeholder={f.placeholder ?? "Select…"}
                  autoAdvance
                />
              ) : f.type === "textarea" ? (
                <TextArea
                  rows={3}
                  value={values[f.key] ?? ""}
                  placeholder={f.placeholder}
                  onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
                />
              ) : (
                <TextInput
                  value={values[f.key] ?? ""}
                  placeholder={f.placeholder}
                  onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
                />
              )}
            </FieldLabel>
          ))}
          {approving && (
            <p className="text-[12px] text-grey-2">
              Requested by {s.profileById(approving.requestedBy)?.name ?? "—"} on {formatDate(approving.createdAt)}.
            </p>
          )}
          {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
        </div>
      </Modal>

      {/* Reject — reason required */}
      <Modal
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        title={`Reject ${rejecting ? masterTypeLabel(rejecting.masterType) : ""}`}
        subtitle="The requester is notified, and sees the reason on their request."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setRejecting(null)} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={doReject} disabled={busy}>
              {busy ? "Rejecting…" : "Reject"}
            </Button>
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
