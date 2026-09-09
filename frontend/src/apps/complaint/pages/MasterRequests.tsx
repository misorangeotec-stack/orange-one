import { useMemo, useState } from "react";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import ChoiceButtons from "@/shared/components/ui/ChoiceButtons";
import { useComplaintStore } from "../store";
import { formatDateTime } from "../lib/format";
import {
  CAUSE_GROUPS,
  CAUSE_GROUP_LABEL,
  COMPLAINT_MASTER_TYPES,
  type ComplaintMasterRequest,
} from "../types";

/**
 * Requests to add a value to one of this module's two masters.
 *
 * ⚠ THE REVIEWER MAY CORRECT THE PAYLOAD BEFORE APPROVING — that is the whole
 *   point of showing the fields rather than a yes/no. A typo or a missing band
 *   gets fixed at the moment somebody who knows is already looking at it, rather
 *   than being approved wrong and edited later on the Masters page.
 *
 * These also appear on the Process Coordinator's desk (pc_master_requests), so a
 * complaint's master request is never trapped inside this module.
 */
export default function MasterRequests() {
  const s = useComplaintStore();
  const [open, setOpen] = useState<ComplaintMasterRequest | null>(null);
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const rows = useMemo(
    () => [...s.masterRequests].sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending")),
    [s.masterRequests],
  );

  const typeLabel = (t: string) =>
    COMPLAINT_MASTER_TYPES.find((m) => m.value === t)?.label ?? t;

  const start = (r: ComplaintMasterRequest) => {
    setOpen(r);
    setName(String(r.proposedPayload.name ?? ""));
    setGroup(String(r.proposedPayload.cause_group ?? ""));
    setNote("");
    setErr("");
  };

  const resolve = async (approve: boolean) => {
    if (!open) return;
    setBusy(true);
    setErr("");
    try {
      await s.resolveMasterRequest(
        open.id,
        approve,
        // ⚠ THESE KEYS ARE THE WIRE CONTRACT read verbatim by
        //   fms_complaint_resolve_master_request. A key added here that the RPC
        //   does not read is silently dropped on approval.
        { name: name.trim(), ...(open.masterType === "root_cause" ? { cause_group: group } : {}) },
        note.trim() || null,
      );
      setOpen(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const columns: QueueColumn<ComplaintMasterRequest>[] = [
    {
      key: "master",
      header: "Master",
      cell: (r) => typeLabel(r.masterType),
      sortValue: (r) => typeLabel(r.masterType),
      filter: { kind: "select", get: (r) => typeLabel(r.masterType) },
    },
    {
      key: "name",
      header: "Proposed value",
      cell: (r) => String(r.proposedPayload.name ?? "—"),
      sortValue: (r) => String(r.proposedPayload.name ?? ""),
    },
    {
      key: "by",
      header: "Requested by",
      cell: (r) => s.personName(r.requestedBy),
      sortValue: (r) => s.personName(r.requestedBy),
      filter: { kind: "select", get: (r) => s.personName(r.requestedBy) },
    },
    {
      key: "when",
      header: "Requested",
      cell: (r) => formatDateTime(r.createdAt),
      sortValue: (r) => r.createdAt,
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => (
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-[11.5px] font-medium ${
            r.status === "pending"
              ? "bg-orange/10 text-orange"
              : r.status === "approved"
                ? "bg-emerald-50 text-emerald-700"
                : "bg-red-50 text-red-700"
          }`}
        >
          {r.status}
        </span>
      ),
      sortValue: (r) => r.status,
      filter: { kind: "select", get: (r) => r.status },
    },
  ];

  return (
    <div className="space-y-5">
      <h1 className="text-[22px] font-bold text-navy">Master Requests</h1>

      <QueueTable<ComplaintMasterRequest>
        rows={rows}
        rowKey={(r) => r.id}
        columns={columns}
        rowsLabel="requests"
        initialSort={{ key: "when", dir: "desc" }}
        exportName="complaint-master-requests"
        exportTitle="Complaint master requests"
        emptyTitle="No master requests"
        emptyMessage="When someone asks for a nature or root cause that is not in the list, it appears here."
        loading={s.loading}
        readOnly={!s.canEdit}
        actions={(r) =>
          r.status === "pending" ? (
            <Button size="sm" onClick={() => start(r)}>Review</Button>
          ) : (
            <span className="text-[11.5px] text-grey-2">{s.personName(r.reviewedBy)}</span>
          )
        }
      />

      <Modal
        open={!!open}
        onClose={() => setOpen(null)}
        title={open ? `Review — ${typeLabel(open.masterType)}` : ""}
        subtitle="Correct the value if it needs it, then approve or reject."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void resolve(false)} disabled={busy}>
              Reject
            </Button>
            <Button size="sm" onClick={() => void resolve(true)} disabled={busy || !name.trim()}>
              {busy ? "Saving…" : "Approve"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FieldLabel strong label="Value" required>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} />
          </FieldLabel>
          {open?.masterType === "root_cause" && (
            <FieldLabel strong label="Group" hint="what the Dashboard Paretos on">
              <ChoiceButtons
                ariaLabel="Cause group"
                options={CAUSE_GROUPS.map((g) => ({ value: g, label: CAUSE_GROUP_LABEL[g] }))}
                value={group}
                onChange={setGroup}
              />
            </FieldLabel>
          )}
          <FieldLabel strong label="Note to the requester">
            <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </FieldLabel>
          {err && <p className="text-[12.5px] text-red-600">{err}</p>}
        </div>
      </Modal>
    </div>
  );
}
