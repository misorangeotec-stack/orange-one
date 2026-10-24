import Modal from "@/shared/components/ui/Modal";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { formatDate, formatDateTime } from "@/shared/lib/time";
import { monthLabel, moduleName, useMySteps, type MyStep } from "./data";

const OUTCOME: Record<MyStep["outcome"], { label: string; cls: string }> = {
  on_time: { label: "On time", cls: "bg-[#E8F6EE] text-ryg-green" },
  late: { label: "Late", cls: "bg-[#FEF5E1] text-[#A77608]" },
  missed: { label: "Missed", cls: "bg-[#FDECEC] text-ryg-red" },
};

const HOW: Record<MyStep["basis"], string> = {
  closed: "Closed this month",
  open: "Still open, overdue",
  closed_after: "Overdue at month end, closed later",
};

/**
 * "Why is my score 72%?" — every step the viewer was scored on this month, from
 * `fms_rank_steps`. Sorts and filters on every column, like every grid in the portal.
 */
export default function MyStepsModal({
  month,
  open,
  onClose,
  user = null,
  name = null,
}: {
  month: string;
  open: boolean;
  onClose: () => void;
  /** An admin previewing someone: whose steps. */
  user?: string | null;
  name?: string | null;
}) {
  const { data, isLoading, error } = useMySteps(month, open, user);
  // Numbered: two documents on one PO can share a reference, a step and a timestamp.
  const rows = (data ?? []).map((r, i) => ({ ...r, n: i }));

  const columns: QueueColumn<MyStep & { n: number }>[] = [
    {
      key: "process",
      header: "Process",
      cell: (r) => moduleName(r.module),
      sortValue: (r) => moduleName(r.module),
      filter: { kind: "select", get: (r) => moduleName(r.module) },
    },
    {
      key: "step",
      header: "Step",
      cell: (r) => <span className="font-semibold text-ink">{r.step}</span>,
      sortValue: (r) => r.step,
      filter: { kind: "select", get: (r) => r.step },
    },
    {
      key: "ref",
      header: "Reference",
      cell: (r) => (
        <span>
          {r.ref}
          {r.round > 1 && <span className="ml-1 text-grey-2">· round {r.round}</span>}
        </span>
      ),
      sortValue: (r) => r.ref,
      filter: { kind: "text", get: (r) => r.ref },
    },
    {
      key: "due",
      header: "Due",
      cell: (r) => formatDate(r.due_date),
      sortValue: (r) => r.due_date ?? "",
      filter: { kind: "date", get: (r) => r.due_date ?? "" },
    },
    {
      key: "done",
      header: "Closed",
      cell: (r) => (r.done_at ? formatDateTime(r.done_at) : <span className="text-grey-2">not closed</span>),
      sortValue: (r) => r.done_at ?? "",
      filter: { kind: "date", get: (r) => r.done_at ?? "" },
    },
    {
      key: "outcome",
      header: "Scored",
      cell: (r) => (
        <span className={`inline-flex rounded-pill px-2 py-0.5 text-[12px] font-semibold ${OUTCOME[r.outcome].cls}`}>
          {OUTCOME[r.outcome].label} · {r.outcome === "on_time" ? "1" : r.outcome === "late" ? "½" : "0"}
        </span>
      ),
      sortValue: (r) => (r.outcome === "on_time" ? 2 : r.outcome === "late" ? 1 : 0),
      filter: { kind: "select", get: (r) => OUTCOME[r.outcome].label },
      exportValue: (r) => OUTCOME[r.outcome].label,
    },
    {
      key: "late",
      header: "Days late",
      align: "right",
      cell: (r) => (r.days_late ? r.days_late : r.outcome === "on_time" ? "0" : "—"),
      sortValue: (r) => r.days_late ?? -1,
      filter: { kind: "number", get: (r) => r.days_late ?? 0 },
    },
    {
      key: "how",
      header: "Why it counts",
      cell: (r) => <span className="text-grey">{HOW[r.basis]}</span>,
      sortValue: (r) => HOW[r.basis],
      filter: { kind: "select", get: (r) => HOW[r.basis] },
    },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${name ? `${name}’s` : "Your"} steps · ${monthLabel(month)}`}
      subtitle="Every step you were scored on. On time counts 1, late ½, missed 0; your score is the points over the steps."
      size="3xl"
      mobileFull
    >
      {error ? (
        <p className="text-[14px] text-ryg-red">Could not load your steps: {(error as Error).message}</p>
      ) : (
        <QueueTable
          rows={rows}
          rowKey={(r) => String(r.n)}
          columns={columns}
          loading={isLoading}
          rowsLabel="steps"
          emptyTitle="No steps scored"
          emptyMessage="Nothing was scored for you in this month."
          initialSort={{ key: "done", dir: "desc" }}
          exportName="My_ranking_steps"
        />
      )}
    </Modal>
  );
}
