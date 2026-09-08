import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import Tabs from "@/shared/components/ui/Tabs";
import Button from "@/shared/components/ui/Button";
import DueCell from "@/shared/components/ui/DueCell";
import StepModal from "./StepModal";
import StatusPill from "./StatusPill";
import { useComplaintStore } from "../store";
import { requestHref } from "../lib/routes";
import { stepByKey, type StepKey } from "../lib/steps";
import { COMPLAINT_TYPE_TONE, STATUS_LABEL, dmy, formatDateTime } from "../lib/format";
import { COMPLAINT_TYPE_LABEL, type ComplaintRequest } from "../types";

/**
 * One step's queue: what is PENDING here, and what this step has already done.
 *
 * ONE component serves all seven steps — the only thing that varies is the step
 * key, so a per-step copy would be seven places to fix a column.
 *
 * ⚠ PENDING IS `myQueue`, NOT every row at this step. `myQueue` runs `canActOn`,
 *   which is the same rule the server enforces — so a person only ever sees work
 *   they can actually do, and the button they see always works.
 *
 * ⚠ FLAT. No `groupBy`: banding would make the group the primary sort and hide
 *   the most overdue row mid-page.
 */
export default function StepQueue({ step }: { step: StepKey }) {
  const s = useComplaintStore();
  const [tab, setTab] = useState("pending");
  const [acting, setActing] = useState<ComplaintRequest | null>(null);

  const def = stepByKey(step);

  const pending = useMemo(
    () =>
      s
        .myQueue(step)
        .map((e) => s.requestById(e.requestId))
        .filter((r): r is ComplaintRequest => !!r),
    [s, step],
  );

  const completed = useMemo(() => s.completedFor(step), [s, step]);

  /** The columns both tabs share — a queue and its history describe the same thing. */
  const base: QueueColumn<ComplaintRequest>[] = [
    {
      key: "complaintNo",
      header: "Complaint",
      cell: (r) => (
        <Link to={requestHref(r.id)} className="font-semibold text-orange hover:underline">
          {r.complaintNo}
        </Link>
      ),
      sortValue: (r) => r.complaintNo,
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "type",
      header: "Type",
      cell: (r) => (
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap ${COMPLAINT_TYPE_TONE[r.complaintType]}`}
        >
          {COMPLAINT_TYPE_LABEL[r.complaintType]}
        </span>
      ),
      sortValue: (r) => COMPLAINT_TYPE_LABEL[r.complaintType],
      filter: { kind: "select", get: (r) => COMPLAINT_TYPE_LABEL[r.complaintType] },
    },
    {
      key: "party",
      header: "Customer / Vendor",
      cell: (r) => r.partyName ?? "—",
      sortValue: (r) => r.partyName ?? "",
      filter: { kind: "select", get: (r) => r.partyName ?? "—" },
    },
    {
      key: "item",
      header: "Item",
      cell: (r) => r.itemName ?? "—",
      sortValue: (r) => r.itemName ?? "",
      filter: { kind: "select", get: (r) => r.itemName ?? "—" },
    },
    {
      key: "lot",
      header: "LOT No.",
      cell: (r) => r.lotNo ?? "—",
      sortValue: (r) => r.lotNo ?? "",
      filter: { kind: "select", get: (r) => r.lotNo ?? "—" },
      tdClassName: "whitespace-nowrap",
    },
  ];

  const pendingColumns: QueueColumn<ComplaintRequest>[] = [
    ...base,
    {
      key: "due",
      header: "Due",
      cell: (r) => <DueCell dueIso={s.dueIsoFor(r, step)} />,
      sortValue: (r) => s.dueIsoFor(r, step) ?? "9999-12-31",
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => <StatusPill status={r.status} />,
      sortValue: (r) => STATUS_LABEL[r.status],
      filter: { kind: "select", get: (r) => STATUS_LABEL[r.status] },
    },
  ];

  const completedColumns: QueueColumn<ComplaintRequest>[] = [
    ...base,
    {
      key: "status",
      header: "Now at",
      cell: (r) => <StatusPill status={r.status} />,
      sortValue: (r) => STATUS_LABEL[r.status],
      filter: { kind: "select", get: (r) => STATUS_LABEL[r.status] },
    },
  ];

  return (
    <div className="space-y-5">
      <h1 className="text-[22px] font-bold text-navy">{def?.title ?? step}</h1>

      <Tabs
        tabs={[
          { key: "pending", label: `Pending (${pending.length})` },
          { key: "done", label: `Completed (${completed.length})` },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "pending" ? (
        <QueueTable<ComplaintRequest>
          rows={pending}
          rowKey={(r) => r.id}
          columns={pendingColumns}
          rowsLabel="complaints"
          initialSort={{ key: "due", dir: "asc" }}
          exportName={`complaint-${step}`}
          exportTitle={def?.title ?? step}
          emptyTitle="Nothing waiting on you here"
          emptyMessage="Complaints needing this step, that you can act on, will appear here."
          loading={s.loading}
          readOnly={!s.canEdit}
          actions={(r) => (
            <Button size="sm" onClick={() => setActing(r)}>
              {def?.short ?? "Record"}
            </Button>
          )}
        />
      ) : (
        <QueueTable<ComplaintRequest>
          rows={completed.map((e) => e.row)}
          rowKey={(r) => r.id}
          columns={completedColumns}
          rowsLabel="complaints"
          exportName={`complaint-${step}-done`}
          exportTitle={`${def?.title ?? step} — completed`}
          emptyTitle="Nothing completed yet"
          emptyMessage="What you record at this step will appear here."
          loading={s.loading}
          readOnly={!s.canEdit}
          actions={(r) => {
            const entry = completed.find((e) => e.row.id === r.id);
            // A locked entry says WHY rather than simply refusing — the server is
            // the gate, this is the explanation.
            if (entry?.lockReason) {
              return <span className="text-[11.5px] text-grey-2" title={entry.lockReason}>Locked</span>;
            }
            // No inline correction in this chain: each step is recorded once and
            // the next bucket sees it. A mistake is fixed by the bucket that owns
            // the step, not by re-opening a completed one.
            return <span className="text-[11.5px] text-grey-2">Done</span>;
          }}
        />
      )}

      {tab === "done" && completed.length > 0 && (
        <p className="text-[11.5px] text-grey-2">
          Last recorded {formatDateTime(completed[completed.length - 1].atIso)} ·{" "}
          {dmy(completed[completed.length - 1].atIso)}
        </p>
      )}

      {acting && (
        <StepModal step={step} request={acting} onClose={() => setActing(null)} />
      )}
    </div>
  );
}
