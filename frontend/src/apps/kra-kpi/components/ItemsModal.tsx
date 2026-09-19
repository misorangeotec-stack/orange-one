import { useMemo } from "react";
import Modal from "@/shared/components/ui/Modal";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { cn } from "@/shared/lib/cn";
import { formatDate, formatDateTime } from "@/shared/lib/time";
import type { ReportItem } from "../data/report";
import { OUTCOME_TONE, outcomeLabel } from "../lib/outcome";
import type { GridRow } from "../lib/rows";

/** What a click on a count asks to see. */
export interface Drill {
  title: string;
  subtitle?: string;
  items: ReportItem[];
  /** One grid row's work: the title already names its module and task, so those columns go. */
  scoped?: boolean;
}

interface ItemRow extends ReportItem {
  key: string;
  moduleName: string;
  label: string;
}

const DASH = "—";

/**
 * The pieces of work behind one count — "why is this −9.87?".
 *
 * A grid under the house rules like every other: every column sorts, every column has a
 * searchable filter that cascades, and a filter that matches nothing leaves the table
 * standing with a Clear filters row (QueueTable does all three).
 */
export default function ItemsModal({ drill, rows, onClose }: { drill: Drill | null; rows: GridRow[]; onClose: () => void }) {
  const byKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);
  const items = useMemo<ItemRow[]>(
    () =>
      (drill?.items ?? []).map((i, n) => {
        const g = byKey.get(`${i.source}|${i.module}|${i.row_key}`);
        return {
          ...i,
          key: `${n}|${i.per}|${i.module}|${i.item_id ?? i.row_key}|${i.due_date}`,
          moduleName: g?.moduleName ?? i.module,
          label: g?.label ?? i.row_key,
        };
      }),
    [drill, byKey],
  );

  const all: QueueColumn<ItemRow>[] = [
    {
      key: "module",
      header: "Module",
      cell: (r) => <span className="text-grey">{r.moduleName}</span>,
      tdClassName: "whitespace-nowrap",
      sortValue: (r) => r.moduleName,
      filter: { kind: "select", get: (r) => r.moduleName },
    },
    {
      key: "task",
      header: "Task / System",
      // One line, like the dispatch register: a long name is cut, the whole of it on hover.
      // The header's edge drags to widen it; the width is kept.
      cell: (r) => (
        <span title={r.label} className="block truncate font-medium text-navy">
          {r.label}
        </span>
      ),
      resize: { width: 320, min: 160, max: 900 },
      tdClassName: "whitespace-nowrap",
      sortValue: (r) => r.label,
      filter: { kind: "select", get: (r) => r.label },
    },
    {
      key: "ref",
      header: "Reference",
      // A task's reference is its own title, already in Task / System — so only FMS steps
      // (an order, a PO, a candidate) show one.
      cell: (r) =>
        r.source === "task" ? (
          <span className="text-grey-2">—</span>
        ) : (
          <span className="whitespace-nowrap">
            {r.ref}
            {r.round_no > 1 && <span className="ml-1 text-[11px] text-grey-2">round {r.round_no}</span>}
          </span>
        ),
      tdClassName: "whitespace-nowrap",
      sortValue: (r) => r.ref,
      filter: { kind: "select", get: (r) => r.ref },
      exportValue: (r) => r.ref,
    },
    {
      key: "due",
      header: "Due",
      cell: (r) => <span className="tabular-nums whitespace-nowrap">{formatDate(r.due_date)}</span>,
      sortValue: (r) => r.due_date,
      filter: { kind: "select", get: (r) => formatDate(r.due_date) },
    },
    {
      key: "done",
      header: "Done",
      cell: (r) => <span className="tabular-nums whitespace-nowrap">{r.done_at ? formatDateTime(r.done_at) : DASH}</span>,
      sortValue: (r) => r.done_at ?? "",
      filter: { kind: "select", get: (r) => (r.done_date_ist ? formatDate(r.done_date_ist) : DASH) },
    },
    {
      key: "outcome",
      header: "Outcome",
      cell: (r) => (
        <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap", OUTCOME_TONE[r.outcome])}>
          {outcomeLabel(r)}
        </span>
      ),
      sortValue: (r) => outcomeLabel(r),
      filter: { kind: "select", get: (r) => outcomeLabel(r) },
    },
    {
      key: "late",
      header: "Days late",
      align: "right",
      cell: (r) => <span className="tabular-nums">{r.days_late && r.days_late > 0 ? r.days_late : DASH}</span>,
      sortValue: (r) => r.days_late ?? -1,
      filter: { kind: "select", get: (r) => (r.days_late && r.days_late > 0 ? String(r.days_late) : DASH) },
    },
  ];

  const columns = drill?.scoped ? all.filter((c) => c.key !== "module" && c.key !== "task") : all;

  return (
    <Modal open={!!drill} onClose={onClose} title={drill?.title ?? ""} subtitle={drill?.subtitle} size="2xl" mobileFull>
      <QueueTable
        rows={items}
        rowKey={(r) => r.key}
        columns={columns}
        rowsLabel="items"
        emptyTitle="Nothing here"
        emptyMessage="No work behind this count."
        initialSort={{ key: "due", dir: "asc" }}
        resizeKey="kra-kpi.items"
      />
    </Modal>
  );
}
