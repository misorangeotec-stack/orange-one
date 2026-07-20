import type { ReactNode } from "react";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import StageRowAction from "@/shared/components/ui/StageRowAction";
import { formatDate, formatDateTime } from "@/shared/lib/time";
import { useHrStore } from "../store";
import { stepByKey } from "../lib/steps";
import type { StageEntry, CompletedRow } from "../lib/queues";

/**
 * The Completed tab's table — "what I did at this step", shared by the five HR
 * Recruitment queue screens. Actions FIRST (the standing FMS rule), then the
 * subject (which each screen renders in its own words — an MRF link, a candidate,
 * a hire), the step, when, by whom, and whether it has since been corrected.
 *
 * HR Recruitment has four entities, so `subject` is a render-prop rather than a
 * fixed column, and `canEdit` is read off the entry (precomputed per entity in the
 * store) rather than asked of a single `canActOn` the way HR Exit can.
 *
 * `formatDateTime` for the actor stamps, `formatDate` for the plain outcome date:
 * these are timestamptz, and slicing the raw UTC string would render an 02:00 IST
 * entry as the previous day — the wrong thing to tell someone checking their work.
 */
export default function CompletedTable({
  rows,
  subjectHeader,
  subject,
  subjectText,
  exportName,
  emptyMessage,
  onEdit,
  onView,
}: {
  rows: StageEntry<CompletedRow>[];
  /** Column header for the entity column (e.g. "Requisition", "Candidate", "Hire"). */
  subjectHeader: string;
  /** The entity cell — a link, a name, whatever the screen wants. */
  subject: (e: StageEntry<CompletedRow>) => ReactNode;
  /** Plain text of the subject, for sort / filter / export. */
  subjectText: (e: StageEntry<CompletedRow>) => string;
  exportName: string;
  emptyMessage: string;
  /** Open this entry's edit surface (a modal, or the detail page). */
  onEdit: (e: StageEntry<CompletedRow>) => void;
  /** Open this entry read-only. */
  onView: (e: StageEntry<CompletedRow>) => void;
}) {
  const s = useHrStore();
  const deptName = (id: string | null) =>
    id ? (s.departments.find((d) => d.id === id)?.name ?? "—") : "—";

  const columns: QueueColumn<StageEntry<CompletedRow>>[] = [
    {
      key: "subject",
      header: subjectHeader,
      cell: (e) => subject(e),
      sortValue: (e) => subjectText(e),
      filter: { kind: "text", get: (e) => subjectText(e) },
      exportValue: (e) => subjectText(e),
    },
    {
      key: "step",
      header: "Step",
      cell: (e) => <span className="text-grey">{stepByKey(e.stepKey)?.short ?? e.stepKey}</span>,
      filter: { kind: "select", get: (e) => stepByKey(e.stepKey)?.short ?? e.stepKey },
    },
    {
      key: "doneAt",
      header: "Done on",
      cell: (e) => <span className="text-grey">{formatDate(e.atIso)}</span>,
      sortValue: (e) => e.atIso,
      exportValue: (e) => formatDate(e.atIso),
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "by",
      header: "By",
      cell: (e) =>
        e.actorId ? (
          <span className="text-navy">{s.personName(e.actorId)}</span>
        ) : (
          <span className="text-grey-2" title="Recorded before the app captured who did this step.">
            Not recorded
          </span>
        ),
      sortValue: (e) => s.personName(e.actorId),
      filter: { kind: "select", get: (e) => (e.actorId ? s.personName(e.actorId) : "Not recorded") },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "edited",
      header: "Edited",
      cell: (e) =>
        e.editedAtIso ? (
          <span className="text-[12px] text-grey-2" title={`Last edited by ${s.personName(e.editedById)}`}>
            {formatDateTime(e.editedAtIso)}
          </span>
        ) : (
          <span className="text-grey-2">—</span>
        ),
      sortValue: (e) => e.editedAtIso ?? "",
      tdClassName: "whitespace-nowrap",
    },
  ];

  return (
    <QueueTable<StageEntry<CompletedRow>>
      rows={rows}
      rowKey={(e) => e.id}
      columns={columns}
      groupBy={{ idOf: (e) => e.departmentId, nameOf: deptName, allLabel: "All departments", label: "Department" }}
      rowsLabel="entries"
      emptyTitle="Nothing here yet"
      emptyMessage={emptyMessage}
      initialSort={{ key: "doneAt", dir: "desc" }}
      exportName={exportName}
      actions={(e) => (
        <StageRowAction
          lockReason={e.lockReason}
          canEdit={e.canEdit}
          permissionReason="Only an owner of this step can edit this entry."
          onEdit={() => onEdit(e)}
          onView={() => onView(e)}
        />
      )}
    />
  );
}
