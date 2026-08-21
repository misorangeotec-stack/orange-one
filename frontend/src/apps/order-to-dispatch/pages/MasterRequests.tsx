import { useMemo, useState } from "react";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import Combobox from "@/shared/components/ui/Combobox";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import Tabs from "@/shared/components/ui/Tabs";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { useDispatchStore } from "../store";
import { useMasterFieldCtx } from "../lib/useMasterFieldCtx";
import RequestMasterModal from "../components/RequestMasterModal";
import MapCustomerItemModal from "../components/MapCustomerItemModal";
import {
  describePayload, emptyValuesFor, masterFields, masterTypeLabel, missingRequired,
  payloadFromValues, type MasterValues,
} from "../lib/masterFields";
import { dmy } from "../lib/format";
import {
  isDirectMaster, REQUESTABLE_DISPATCH_MASTER_TYPES,
  type DispatchMasterRequest, type DispatchMasterType,
} from "../types";

type Tab = "review" | "mine" | "all";

/**
 * One page, two audiences: owners reviewing what has been asked for, and everyone
 * following their own requests. The approve modal lets the owner CORRECT the
 * proposal before it becomes a real master row — a typo shouldn't force a reject.
 */
export default function MasterRequests() {
  const s = useDispatchStore();

  /**
   * The relational masters need this: the mapping's payload is two ids, and a
   * location's name means nothing without the company it hangs off.
   */
  const nameLookup = {
    customerName: s.customerName,
    itemName: s.itemName,
    companyName: (id: string) => s.masterName("company", id),
  };
  const ctx = useMasterFieldCtx();
  const [tab, setTab] = useState<Tab>(s.isAnyMasterManager ? "review" : "mine");
  const [raising, setRaising] = useState(false);
  /**
   * WHAT THE PERSON NEEDS — and the answer decides which modal opens, not just
   * which fields render.
   *
   * The list holds two kinds now (see REQUESTABLE_DISPATCH_MASTER_TYPES): the
   * customer↔item mapping is created DIRECTLY, everything else is a request an
   * owner reviews. The choice therefore has to live out here, above both
   * modals, and be handed to whichever one is showing — otherwise changing your
   * mind re-mounts a different form and the field appears to move.
   */
  const [raiseType, setRaiseType] = useState<DispatchMasterType>(
    REQUESTABLE_DISPATCH_MASTER_TYPES[0].value,
  );
  const [acting, setActing] = useState<{ req: DispatchMasterRequest; approve: boolean } | null>(null);
  const [values, setValues] = useState<MasterValues>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => {
    if (tab === "review") return s.resolvableRequests;
    if (tab === "mine") return s.myMasterRequests;
    return s.masterRequests;
  }, [tab, s]);

  const openAct = (req: DispatchMasterRequest, approve: boolean) => {
    const base = emptyValuesFor(req.masterType);
    for (const k of Object.keys(base)) {
      const v = req.proposedPayload[k];
      base[k] = v === null || v === undefined ? "" : String(v);
    }
    setValues(base);
    setNote("");
    setError(null);
    setActing({ req, approve });
  };

  const confirm = async () => {
    if (!acting) return;
    if (acting.approve) {
      const miss = missingRequired(acting.req.masterType, values, ctx);
      if (miss) { setError(miss); return; }
    } else if (!note.trim()) {
      setError("Give a reason so the requester knows what to change.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await s.resolveMasterRequest(
        acting.req.id,
        acting.approve,
        acting.approve ? payloadFromValues(acting.req.masterType, values) : null,
        note.trim() || null,
      );
      setActing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not resolve the request.");
    } finally {
      setBusy(false);
    }
  };

  const columns: QueueColumn<DispatchMasterRequest>[] = [
    {
      key: "type",
      header: "Type",
      cell: (r) => <span className="text-navy font-medium">{masterTypeLabel(r.masterType)}</span>,
      sortValue: (r) => masterTypeLabel(r.masterType),
      filter: { kind: "select", get: (r) => masterTypeLabel(r.masterType) },
    },
    {
      key: "proposed",
      header: "Proposed",
      cell: (r) => <span className="text-navy">{describePayload(r.masterType, r.proposedPayload, nameLookup)}</span>,
      sortValue: (r) => describePayload(r.masterType, r.proposedPayload, nameLookup),
      filter: { kind: "text", get: (r) => describePayload(r.masterType, r.proposedPayload, nameLookup) },
    },
    {
      key: "by",
      header: "Requested by",
      cell: (r) => <span className="text-grey">{s.personName(r.requestedBy)}</span>,
      sortValue: (r) => s.personName(r.requestedBy),
      filter: { kind: "select", get: (r) => s.personName(r.requestedBy) },
    },
    {
      key: "on",
      header: "On",
      cell: (r) => <span className="text-grey whitespace-nowrap">{dmy(r.createdAt)}</span>,
      sortValue: (r) => r.createdAt,
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => (
        <span
          className={`inline-block text-[11px] font-semibold rounded-full px-2 py-0.5 ${
            r.status === "pending" ? "bg-[#FFF7E6] text-yellow"
            : r.status === "approved" ? "bg-[#E8F7EE] text-ryg-green"
            : "bg-[#FDECEC] text-ryg-red"
          }`}
        >
          {r.status}
        </span>
      ),
      sortValue: (r) => r.status,
      filter: { kind: "select", get: (r) => r.status },
    },
    {
      key: "note",
      header: "Review note",
      cell: (r) => <span className="text-grey-2">{r.reviewNote || "—"}</span>,
    },
  ];

  const actFields = acting ? masterFields(acting.req.masterType, ctx).filter((f) => f.key !== "sortOrder") : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-navy">Master Requests</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">
            Missing an entry mid-task? Start it here. A customer-item mapping you make yourself;
            anything else goes to that master's owner.
          </p>
        </div>
        {/* A write either way — a mapping straight into the master, or a pending
            row someone has to review. Gated on canEdit for both. */}
        {s.canEdit && <Button onClick={() => setRaising(true)}>New entry</Button>}
      </div>

      <Tabs
        tabs={[
          /* While the module is still loading every count is 0, and "To review 0"
             reads as "nothing to approve". Omitting the count hides the badge
             until the real number is known — see QueueTable's `loading` note. */
          ...(s.isAnyMasterManager ? [{ key: "review", label: "To review", count: s.isLoading ? undefined : s.resolvableRequests.length }] : []),
          { key: "mine", label: "My requests", count: s.isLoading ? undefined : s.myMasterRequests.length },
          { key: "all", label: "All", count: s.isLoading ? undefined : s.masterRequests.length },
        ]}
        active={tab}
        onChange={(k) => setTab(k as Tab)}
      />

      <QueueTable<DispatchMasterRequest>
        rows={rows}
        rowKey={(r) => r.id}
        columns={columns}
        actions={(r) =>
          r.status === "pending" && s.canManage(r.masterType) ? (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => openAct(r, true)}>Approve</Button>
              <Button size="sm" variant="ghost" onClick={() => openAct(r, false)}>Reject</Button>
            </div>
          ) : null
        }
        rowsLabel="requests"
        initialSort={{ key: "on", dir: "desc" }}
        loading={s.isLoading}
        emptyTitle="Nothing here"
        emptyMessage="Requests for new master entries will appear here."
      />

      {/*
        ONE question, TWO destinations. `typePicker` is rendered by whichever
        modal is open, so the control keeps its place on screen while the form
        beneath it changes.
      */}
      {(() => {
        const picker = (
          <FieldLabel
            label="What do you need?"
            hint={
              isDirectMaster(raiseType)
                ? "You can do this one yourself — it is saved straight away."
                : "Goes to that master's owner to approve."
            }
          >
            <Combobox
              value={raiseType}
              onChange={(v) => setRaiseType(v as DispatchMasterType)}
              options={REQUESTABLE_DISPATCH_MASTER_TYPES.map((t) => ({ value: t.value, label: t.label }))}
            />
          </FieldLabel>
        );
        return isDirectMaster(raiseType) ? (
          <MapCustomerItemModal
            open={raising}
            onClose={() => setRaising(false)}
            typePicker={picker}
          />
        ) : (
          <RequestMasterModal
            open={raising}
            onClose={() => setRaising(false)}
            masterType={raiseType}
            typePicker={picker}
          />
        );
      })()}

      <Modal
        open={!!acting}
        onClose={() => setActing(null)}
        title={acting?.approve ? "Approve and add to the master" : "Reject this request"}
        subtitle={acting ? masterTypeLabel(acting.req.masterType) : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setActing(null)} disabled={busy}>Cancel</Button>
            <Button onClick={confirm} disabled={busy}>
              {busy ? "Saving…" : acting?.approve ? "Approve" : "Reject"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {acting?.approve && (
            <>
              <p className="text-[13px] text-grey-2">Correct anything before it becomes a real master entry.</p>
              <div className="grid gap-4 sm:grid-cols-2">
                {actFields.map((f) => (
                  <FieldLabel key={f.key} label={f.label} required={f.required} hint={f.hint}>
                    {f.type === "select" ? (
                      <Combobox
                        value={values[f.key] ?? ""}
                        onChange={(v) => setValues((p) => ({ ...p, [f.key]: v }))}
                        options={f.options ?? []}
                        placeholder="Select…"
                        searchable={(f.options?.length ?? 0) > 6}
                      />
                    ) : f.type === "textarea" ? (
                      <TextArea
                        value={values[f.key] ?? ""}
                        rows={2}
                        onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
                      />
                    ) : (
                      <TextInput
                        value={values[f.key] ?? ""}
                        onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
                      />
                    )}
                  </FieldLabel>
                ))}
              </div>
            </>
          )}
          <FieldLabel label={acting?.approve ? "Note (optional)" : "Reason"} required={!acting?.approve}>
            <TextArea value={note} rows={2} onChange={(e) => setNote(e.target.value)} />
          </FieldLabel>
          {error && <p className="text-[13px] font-medium text-ryg-red">{error}</p>}
        </div>
      </Modal>
    </div>
  );
}
