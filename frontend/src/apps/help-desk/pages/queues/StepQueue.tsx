import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import DueCell from "@/shared/components/ui/DueCell";
import { formatDateDMY } from "@/shared/lib/date";
import { useHelpStore } from "../../store";
import TicketActions from "../../components/TicketActions";
import { ConfidentialPill } from "../../components/StatusPill";
import { stepByKey, type StepKey } from "../../lib/steps";
import { B } from "../../nav";
import type { HelpQueueEntry } from "../../lib/queues";

/**
 * One step's queue: the tickets sitting at this step that are OWED BY the reader.
 *
 * ⚠ IT LISTS WHAT THEY OWE, NOT EVERYTHING AT THE STEP. A coordinator or an
 *   admin can ACT on every ticket in the hub (`fms_help_can_act`), but charging
 *   them with all of it would bury their own list and — once HD-12 lands — wreck
 *   their ranking score. `stepOwedBy` in lib/queues.ts is the single answer to
 *   "whose is this", and the Control Center is where the whole step is read.
 *
 * ⚠ THE TITLE IS WRITTEN FOR WHOEVER HOLDS THE QUEUE. Two of these belong to an
 *   ordinary employee, not to HR, and the desk's own wording ("Waiting on the
 *   Employee") is meaningless to the person who IS the employee. Same rule as
 *   the labels in nav.tsx.
 */
const HEADING: Partial<Record<StepKey, { title: string; blurb: string }>> = {
  acknowledge: {
    title: "To pick up",
    blurb: "Tickets that have come to you and nobody has said they have yet.",
  },
  resolve: {
    title: "To answer",
    blurb: "You have these. The turnaround runs from when each was raised, not from when you picked it up.",
  },
  awaiting_info: {
    title: "HR is waiting on you",
    blurb: "Someone in HR has asked you something. Until you answer, the ticket cannot move.",
  },
  confirm: {
    title: "Confirm a resolution",
    blurb: "These have been answered. Tell us whether the answer worked, or reopen them.",
  },
};

export default function StepQueue({ step }: { step: StepKey }) {
  const s = useHelpStore();
  const nav = useNavigate();

  const rows = useMemo(
    () => s.myQueueEntries.filter((e) => e.stepKey === step),
    [s.myQueueEntries, step],
  );

  const head = HEADING[step] ?? {
    title: stepByKey(step)?.title ?? step,
    blurb: "",
  };

  const columns: QueueColumn<HelpQueueEntry>[] = [
    {
      key: "ticketNo",
      header: "Ticket",
      cell: (e) => <span className="font-semibold text-navy">{e.ticketNo}</span>,
      sortValue: (e) => e.ticketNo,
      alwaysVisible: true,
    },
    {
      key: "subject",
      header: "What it is about",
      cell: (e) => (
        <span className="flex items-center gap-2">
          <span title={e.subject}>{e.subject}</span>
          {e.confidential && <ConfidentialPill />}
        </span>
      ),
      sortValue: (e) => e.subject.toLowerCase(),
      filter: { kind: "text", get: (e) => e.subject },
      resize: { width: 340 },
    },
    {
      key: "category",
      header: "Category",
      cell: (e) => e.categoryName,
      sortValue: (e) => e.categoryName,
      filter: { kind: "select", get: (e) => e.categoryName },
    },
    {
      key: "raisedBy",
      header: "Raised by",
      cell: (e) => s.personName(e.raisedBy),
      sortValue: (e) => s.personName(e.raisedBy).toLowerCase(),
      filter: { kind: "select", get: (e) => s.personName(e.raisedBy) },
    },
    {
      key: "raisedAt",
      header: "Raised",
      cell: (e) => formatDateDMY(e.raisedAt),
      sortValue: (e) => e.raisedAt,
      filter: { kind: "date", get: (e) => e.raisedAt },
    },
    {
      key: "due",
      header: "Due",
      cell: (e) =>
        e.dueIso ? (
          <DueCell dueIso={e.dueIso} />
        ) : (
          /* Governed by policy rather than a number of working days. The
             category's own words, never an invented date. */
          <span className="text-[12.5px] text-grey-2" title="Governed by policy, not by a fixed number of working days">
            {e.tatText ?? "—"}
          </span>
        ),
      // Untimed sorts to the END, not to 1970.
      sortValue: (e) => e.dueIso ?? "9999-12-31",
      filter: { kind: "date", get: (e) => e.dueIso ?? "" },
    },
  ];

  return (
    <div>
      <h1 className="text-[20px] font-bold text-navy">{head.title}</h1>
      {head.blurb && <p className="mt-1 text-[13.5px] text-grey-2">{head.blurb}</p>}

      <div className="mt-4">
        <QueueTable
          rows={rows}
          rowKey={(e) => `${e.ticketId}-${e.stepKey}`}
          columns={columns}
          loading={s.loading}
          rowsLabel="tickets"
          emptyTitle="Nothing here"
          emptyMessage="When a ticket lands on you at this step, it will appear here."
          initialSort={{ key: "due", dir: "asc" }}
          onRowClick={(e) => nav(`${B}/tickets/${e.ticketId}`)}
          exportName={`help-desk-${step}`}
          exportTitle={`Help Desk — ${head.title}`}
          resizeKey={`helpDeskQueue-${step}`}
          actions={(e) => {
            const t = s.tickets.find((x) => x.id === e.ticketId);
            if (!t) return null;
            // ⚠ THE ROW IS CLICKABLE, SO THE ACTIONS MUST STOP THE CLICK. Without
            //   this, `onRowClick` fires first and navigates to the ticket page
            //   before the dialog can open — every button in this column looked
            //   dead and just opened the ticket instead. Found by walking the
            //   queue in a browser; nothing in the type-checker or the SQL tests
            //   can see it. Same guard as receivables' PendingQueue.
            return (
              <span onClick={(ev) => ev.stopPropagation()}>
                <TicketActions ticket={t} />
              </span>
            );
          }}
        />
      </div>
    </div>
  );
}
