import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import Tabs from "@/shared/components/ui/Tabs";
import Button from "@/shared/components/ui/Button";
import DueCell from "@/shared/components/ui/DueCell";
import StepModal from "../../components/StepModal";
import CreditNoteModal from "../../components/CreditNoteModal";
import { useComplaintStore } from "../../store";
import { requestHref } from "../../lib/routes";
import { MANAGEMENT_STEPS, type StepKey } from "../../lib/steps";
import { RM_ORIGIN_TONE, dmy, formatDateTime, rmOriginLabelOf } from "../../lib/format";
import { formatCnAmount } from "../../types/creditNote";
import {
  cnRow,
  complaintRow,
  rowCompanyId,
  rowItem,
  rowLot,
  rowNo,
  rowParty,
  rowStatusLabel,
  rowStatusTone,
  rowTypeLabel,
  rowTypeTone,
  type AnyRow,
} from "../../lib/anyRow";

/**
 * MANAGEMENT APPROVAL — the ONE place management look, and the one record of
 * what they did. The user asked for it: Finished Good, Raw Material, Other
 * Supplier and Customer Compensation all land in Pending, and once management
 * act they move to Completed here — compensations included, so one Excel
 * export holds every management decision.
 *
 * Complaint rows are the three steps management own — `approval` (FG
 * commercial call), `rm_management` (RM import / other supplier) and
 * `management_review` (the final sign-off); compensations are `cn_approval`.
 * Setup staffs them all with ONE row (StepOwnersSection).
 */
const STAGE_LABEL: Partial<Record<StepKey, string>> = {
  approval: "Commercial approval (FG)",
  rm_management: "RM / supplier complaint",
  management_review: "Final review",
  cn_approval: "Compensation approval",
};

const ACTION_LABEL: Partial<Record<StepKey, string>> = {
  approval: "Approve",
  rm_management: "Review",
  management_review: "Close",
  cn_approval: "Approve",
};

/** Every row here is at (or was at) one management step. */
const stepOf = (x: AnyRow): StepKey => (x.kind === "cn" ? "cn_approval" : (x.step ?? "approval"));
const stageOf = (x: AnyRow) => STAGE_LABEL[stepOf(x)] ?? stepOf(x);

export default function ApprovalQueue() {
  const s = useComplaintStore();
  const [tab, setTab] = useState("pending");
  const [acting, setActing] = useState<AnyRow | null>(null);

  // Pending follows the complaint rule (`myQueue` = can act); Completed is
  // also open to view-only readers, as the complaint history is.
  const actsOnCn = s.canActOnCn("cn_approval");
  const seesCn = actsOnCn || s.isModuleViewer;

  const pending = useMemo<AnyRow[]>(() => {
    const complaints = MANAGEMENT_STEPS.flatMap((st) =>
      s
        .myQueue(st)
        .map((e) => s.requestById(e.requestId))
        .filter((r): r is NonNullable<typeof r> => !!r)
        .map((r) => complaintRow(r, st)),
    );
    const cns = actsOnCn ? s.creditNotes.filter((c) => c.status === "awaiting_cn_approval").map(cnRow) : [];
    return [...complaints, ...cns];
  }, [s, actsOnCn]);

  /** Completed rows, each with WHEN management acted — for the sort and the footer. */
  const completed = useMemo(() => {
    const complaints = MANAGEMENT_STEPS.flatMap((st) =>
      s.completedFor(st).map((e) => ({ row: complaintRow(e.row, st), atIso: e.atIso, lockReason: e.lockReason ?? null })),
    );
    const cns = seesCn
      ? s.creditNotes.filter((c) => c.aprAt).map((c) => ({ row: cnRow(c), atIso: c.aprAt as string, lockReason: null }))
      : [];
    return [...complaints, ...cns].sort((a, b) => b.atIso.localeCompare(a.atIso));
  }, [s, seesCn]);
  const doneAt = useMemo(() => new Map(completed.map((e) => [e.row.key, e.atIso])), [completed]);
  const lockOf = useMemo(() => new Map(completed.map((e) => [e.row.key, e.lockReason])), [completed]);
  const originOf = (x: AnyRow) => (x.kind === "complaint" ? rmOriginLabelOf(x.r.rmOrigin) : "—");

  const dueOf = (x: AnyRow) => (x.kind === "complaint" ? s.dueIsoFor(x.r, stepOf(x)) : null);

  const base: QueueColumn<AnyRow>[] = [
    {
      key: "no",
      header: "No.",
      cell: (x) =>
        x.kind === "cn" ? (
          <button type="button" onClick={() => setActing(x)} className="font-semibold text-orange hover:underline">
            {x.c.cnNo}
          </button>
        ) : (
          <Link to={requestHref(x.r.id)} className="font-semibold text-orange hover:underline">
            {x.r.complaintNo}
          </Link>
        ),
      sortValue: rowNo,
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "stage",
      header: "Stage",
      cell: (x) => <span className="whitespace-nowrap">{stageOf(x)}</span>,
      sortValue: stageOf,
      filter: { kind: "select", get: stageOf },
    },
    {
      key: "type",
      header: "Type",
      cell: (x) => (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap ${rowTypeTone(x)}`}>
          {rowTypeLabel(x)}
        </span>
      ),
      sortValue: rowTypeLabel,
      filter: { kind: "select", get: rowTypeLabel },
    },
    {
      // Domestic / Import — raw material only; it says whose desk an RM row was.
      key: "rmOrigin",
      header: "Domestic / Import",
      cell: (x) =>
        x.kind === "complaint" && x.r.rmOrigin ? (
          <span className={`inline-flex rounded-full px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap ${RM_ORIGIN_TONE[x.r.rmOrigin]}`}>
            {originOf(x)}
          </span>
        ) : (
          "—"
        ),
      sortValue: originOf,
      filter: { kind: "select", get: originOf },
    },
    {
      key: "company",
      header: "Company",
      cell: (x) => s.companyName(rowCompanyId(x)),
      sortValue: (x) => s.companyName(rowCompanyId(x)),
      filter: { kind: "select", get: (x) => s.companyName(rowCompanyId(x)) },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "party",
      header: "Customer / Vendor",
      cell: rowParty,
      sortValue: rowParty,
      filter: { kind: "select", get: rowParty },
    },
    {
      key: "item",
      header: "Item / Product",
      cell: rowItem,
      sortValue: rowItem,
      filter: { kind: "select", get: rowItem },
    },
    {
      key: "lot",
      header: "LOT No.",
      cell: rowLot,
      sortValue: rowLot,
      filter: { kind: "select", get: rowLot },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "amount",
      header: "Amount",
      cell: (x) => (x.kind === "cn" ? formatCnAmount(x.c.amount) : "—"),
      sortValue: (x) => (x.kind === "cn" ? (x.c.amount ?? 0) : -1),
      tdClassName: "whitespace-nowrap text-right",
    },
  ];

  const statusCol = (header: string): QueueColumn<AnyRow> => ({
    key: "status",
    header,
    cell: (x) => (
      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap ${rowStatusTone(x)}`}>
        {rowStatusLabel(x)}
      </span>
    ),
    sortValue: rowStatusLabel,
    filter: { kind: "select", get: rowStatusLabel },
  });

  const pendingColumns: QueueColumn<AnyRow>[] = [
    ...base,
    {
      key: "due",
      header: "Due",
      cell: (x) => <DueCell dueIso={dueOf(x)} />,
      sortValue: (x) => dueOf(x) ?? "9999-12-31",
      filter: { kind: "date", get: (x) => dueOf(x) ?? "" },
      tdClassName: "whitespace-nowrap",
    },
    statusCol("Status"),
  ];

  const completedColumns: QueueColumn<AnyRow>[] = [
    ...base,
    {
      key: "decision",
      header: "Decision",
      cell: (x) => (x.kind === "cn" ? (x.c.aprDecision === "reject" ? "Rejected" : "Approved") : "Done"),
      sortValue: (x) => (x.kind === "cn" ? (x.c.aprDecision ?? "") : "done"),
      filter: {
        kind: "select",
        get: (x) => (x.kind === "cn" ? (x.c.aprDecision === "reject" ? "Rejected" : "Approved") : "Done"),
      },
    },
    {
      key: "on",
      header: "On",
      cell: (x) => dmy(doneAt.get(x.key) ?? null),
      sortValue: (x) => doneAt.get(x.key) ?? "",
      tdClassName: "whitespace-nowrap",
    },
    statusCol("Now at"),
  ];

  return (
    <div className="space-y-5">
      <h1 className="text-[22px] font-bold text-navy">Management Approval</h1>

      <Tabs
        tabs={[
          { key: "pending", label: `Pending (${pending.length})` },
          { key: "done", label: `Completed (${completed.length})` },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "pending" ? (
        <QueueTable<AnyRow>
          rows={pending}
          rowKey={(x) => x.key}
          columns={pendingColumns}
          rowsLabel="items"
          initialSort={{ key: "due", dir: "asc" }}
          exportName="management-approval"
          exportTitle="Management Approval"
          emptyTitle="Nothing waiting on you here"
          emptyMessage="Complaints and compensations waiting for management will appear here."
          loading={s.loading}
          readOnly={!s.canEdit}
          actions={(x) => (
            <Button size="sm" onClick={() => setActing(x)}>
              {ACTION_LABEL[stepOf(x)] ?? "Open"}
            </Button>
          )}
        />
      ) : (
        <QueueTable<AnyRow>
          rows={completed.map((e) => e.row)}
          rowKey={(x) => x.key}
          columns={completedColumns}
          rowsLabel="items"
          initialSort={{ key: "on", dir: "desc" }}
          exportName="management-approval-done"
          exportTitle="Management Approval — completed"
          emptyTitle="Nothing completed yet"
          emptyMessage="What management approve, review or close will appear here."
          loading={s.loading}
          readOnly={!s.canEdit}
          actions={(x) =>
            x.kind === "cn" ? (
              <Button size="sm" variant="ghost" onClick={() => setActing(x)}>
                View
              </Button>
            ) : lockOf.get(x.key) ? (
              // A locked entry says WHY — the server is the gate, this is the explanation.
              <span className="text-[11.5px] text-grey-2" title={lockOf.get(x.key) ?? ""}>Locked</span>
            ) : (
              <span className="text-[11.5px] text-grey-2">Done</span>
            )
          }
        />
      )}

      {tab === "done" && completed.length > 0 && (
        <p className="text-[11.5px] text-grey-2">
          Last recorded {formatDateTime(completed[0].atIso)} · {dmy(completed[0].atIso)}
        </p>
      )}

      {acting?.kind === "complaint" && (
        <StepModal step={stepOf(acting)} request={acting.r} onClose={() => setActing(null)} />
      )}
      {acting?.kind === "cn" && (
        <CreditNoteModal cn={s.creditNoteById(acting.c.id) ?? acting.c} onClose={() => setActing(null)} />
      )}
    </div>
  );
}
