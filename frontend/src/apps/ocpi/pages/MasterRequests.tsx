import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { fetchOrgPeople } from "@/core/platform/orgPeople";
import { useOcpiStore } from "../store";
import RequestMasterModal from "../components/RequestMasterModal";
import { resolveMasterRequest } from "../data/ocpiMasterWrites";
import { masterTypeLabel } from "../lib/masterFields";
import { dmy } from "../lib/format";
import type { OcpiMasterRequest } from "../types";

const STATUS_LABEL: Record<OcpiMasterRequest["status"], string> = {
  pending: "Waiting",
  approved: "Approved",
  rejected: "Rejected",
};

/**
 * Master requests — "this is missing from the list", and what happened to it.
 *
 * ⚠ RESOLVED REQUESTS STAY ON THE SCREEN. A list that empties itself on approval
 *   answers "what do I owe" and nothing else; the question people actually come
 *   back with is "I asked for that head type last month — did anyone do
 *   anything?". Status is a filterable column, so the queue view is one click
 *   away and the history is never thrown out.
 *
 * ⚠ THE APPROVER CAN EDIT THE NAME BEFORE APPROVING. A salesperson typing a head
 *   model from memory gets the manufacturer's spelling wrong often enough that
 *   bouncing it back would just produce a second, equally wrong request. The RPC
 *   accepts a corrected payload for exactly this.
 */
export default function MasterRequests() {
  const s = useOcpiStore();
  const [raising, setRaising] = useState(false);
  const [acting, setActing] = useState<OcpiMasterRequest | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<null | "approve" | "reject">(null);
  const [error, setError] = useState<string | null>(null);

  const { data: people } = useQuery({
    queryKey: ["orgPeople"],
    queryFn: fetchOrgPeople,
    staleTime: 5 * 60 * 1000,
  });
  const personName = (id: string | null) =>
    id ? people?.find((p) => p.id === id)?.name ?? "Someone" : "";

  const nameOf = (r: OcpiMasterRequest) => String(r.proposedPayload?.name ?? "");

  function open(r: OcpiMasterRequest) {
    setActing(r);
    setName(nameOf(r));
    setNote("");
    setError(null);
  }

  async function decide(approve: boolean) {
    if (!acting) return;
    setBusy(approve ? "approve" : "reject");
    setError(null);
    try {
      await resolveMasterRequest(
        acting.id,
        approve,
        approve ? { name: name.trim() } : undefined,
        note.trim() || undefined,
      );
      await s.refresh();
      setActing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const columns = useMemo<QueueColumn<OcpiMasterRequest>[]>(
    () => [
      {
        key: "name",
        header: "Asked for",
        cell: (r) => <span className="font-semibold text-navy">{nameOf(r)}</span>,
        sortValue: (r) => nameOf(r),
        filter: { kind: "text", get: (r) => nameOf(r) },
      },
      {
        key: "type",
        header: "List",
        cell: (r) => masterTypeLabel(r.masterType),
        filter: { kind: "select", get: (r) => masterTypeLabel(r.masterType) },
      },
      {
        key: "status",
        header: "Status",
        cell: (r) => (
          <span
            className={
              r.status === "pending"
                ? "font-medium text-orange"
                : r.status === "approved"
                  ? "text-ryg-green"
                  : "text-ryg-red"
            }
          >
            {STATUS_LABEL[r.status]}
          </span>
        ),
        sortValue: (r) => STATUS_LABEL[r.status],
        filter: { kind: "select", get: (r) => STATUS_LABEL[r.status] },
      },
      {
        key: "by",
        header: "Asked by",
        cell: (r) => personName(r.requestedBy),
        filter: { kind: "select", get: (r) => personName(r.requestedBy) },
      },
      {
        key: "when",
        header: "Asked",
        cell: (r) => dmy(r.createdAt),
        sortValue: (r) => r.createdAt,
        filter: { kind: "date", get: (r) => r.createdAt.slice(0, 10) },
      },
      {
        key: "note",
        header: "Reviewer's note",
        cell: (r) => r.reviewNote ?? "—",
        filter: { kind: "text", get: (r) => r.reviewNote ?? "" },
      },
    ],
    [people],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-navy">Master requests</h1>
          <p className="mt-0.5 text-[13.5px] text-grey-2">
            Entries people have asked to be added to a list. Approving one creates it for
            everybody.
          </p>
        </div>
        {s.canEdit && <Button onClick={() => setRaising(true)}>Ask for an entry</Button>}
      </div>

      <QueueTable
        rows={s.masterRequests}
        rowKey={(r) => r.id}
        columns={columns}
        loading={s.isLoading}
        rowsLabel="requests"
        emptyTitle="Nothing has been asked for"
        emptyMessage="When somebody hits a model or an ink type that is not on the list, their request lands here."
        initialSort={{ key: "when", dir: "desc" }}
        exportName="ocpi-master-requests"
        exportTitle="OCPI master requests"
        actions={(r) =>
          r.status === "pending" && s.canManageMaster(r.masterType) ? (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => open(r)}>
                Review
              </Button>
            </div>
          ) : null
        }
      />

      <RequestMasterModal
        open={raising}
        onClose={() => setRaising(false)}
        masterType={null}
      />

      <Modal
        open={!!acting}
        onClose={() => { if (!busy) setActing(null); }}
        title={acting ? `Add "${nameOf(acting)}" to ${masterTypeLabel(acting.masterType).toLowerCase()}s?` : ""}
        subtitle={acting ? `Asked by ${personName(acting.requestedBy)} on ${dmy(acting.createdAt)}` : undefined}
      >
        <div className="space-y-3">
          <FieldLabel
            label="Name"
            hint="correct it here if the spelling is wrong — no need to send it back"
          >
            <TextInput value={name} onChange={(e) => setName(e.target.value)} disabled={!!busy} />
          </FieldLabel>

          <FieldLabel label="Note" hint="required when rejecting">
            <TextArea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Already covered by the 600 DPI entry"
              disabled={!!busy}
            />
          </FieldLabel>

          {acting?.masterType === "machine" && (
            <p className="rounded-xl border border-line bg-page/60 p-3 text-[12.5px] text-grey">
              Approving adds the model to the quotation dropdown straight away. Its detailed
              sheet&rsquo;s template starts empty, so deals on this machine issue the summary sheet
              alone until somebody builds it under Machines. Nothing is blocked in the meantime.
            </p>
          )}

          {error && <p className="text-[13px] text-ryg-red">{error}</p>}

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void decide(true)} disabled={!!busy || !name.trim()}>
              {busy === "approve" ? "Adding…" : "Approve and add"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => void decide(false)}
              disabled={!!busy || !note.trim()}
            >
              {busy === "reject" ? "Rejecting…" : "Reject"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
