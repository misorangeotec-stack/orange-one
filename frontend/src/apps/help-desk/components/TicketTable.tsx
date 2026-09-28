import { useNavigate } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import DueCell from "@/shared/components/ui/DueCell";
import { formatDateDMY } from "@/shared/lib/date";
import { useHelpStore } from "../store";
import StatusPill, { ConfidentialPill } from "./StatusPill";
import { B } from "../nav";
import type { Ticket } from "../types";

/**
 * The ticket grid, shared by My Tickets and All Tickets.
 *
 * ⚠ EVERY COLUMN SORTS AND EVERY COLUMN FILTERS. That is this repo's default,
 *   not a per-screen decision — `QueueTable` derives both, and the filters
 *   CASCADE so no combination a reader can assemble returns an empty table. The
 *   only column with NO filter is the ticket number, where every value is unique
 *   and the dropdown would merely restate the table.
 *
 * ⚠ THE DUE DATE IS BLANK ON AN UNTIMED CATEGORY, AND THAT IS THE POINT. Five
 *   categories are governed by policy rather than a number of working days
 *   ("As per POSH Policy", "As per Exit Policy"…). Their cell prints the
 *   policy's own words instead of a date, and `sortValue` sends them to the END
 *   rather than to 1970 — which is where an empty string would put them, making
 *   a POSH complaint look like the most overdue thing in the list.
 */
export default function TicketTable({
  tickets,
  loading,
  emptyTitle,
  emptyMessage,
  showRaisedBy = false,
}: {
  tickets: Ticket[];
  loading?: boolean;
  emptyTitle: string;
  emptyMessage: string;
  /** Off on My Tickets — every row would say the reader's own name. */
  showRaisedBy?: boolean;
}) {
  const s = useHelpStore();
  const nav = useNavigate();

  const dueOf = (t: Ticket): string | null =>
    t.currentStep ? s.dueIsoFor(t, t.currentStep) : null;

  const columns: QueueColumn<Ticket>[] = [
    {
      key: "ticketNo",
      header: "Ticket",
      cell: (t) => <span className="font-semibold text-navy">{t.ticketNo}</span>,
      sortValue: (t) => t.ticketNo,
      // NO `filter` KEY AT ALL, which is how a filter is suppressed here — the
      // type is `filter?: ColumnFilter<T>`, so there is no `false` to pass.
      // Every value is unique, and the dropdown would list every ticket once and
      // narrow nothing.
      alwaysVisible: true,
    },
    {
      key: "subject",
      header: "What it is about",
      cell: (t) => (
        <span className="flex items-center gap-2">
          <span title={t.subject}>{t.subject}</span>
          {s.categoryById(t.categoryId)?.confidential && <ConfidentialPill />}
        </span>
      ),
      sortValue: (t) => t.subject.toLowerCase(),
      filter: { kind: "text", get: (t) => t.subject },
      resize: { width: 320 },
    },
    {
      key: "category",
      header: "Category",
      cell: (t) => s.categoryById(t.categoryId)?.name ?? "—",
      sortValue: (t) => s.categoryById(t.categoryId)?.name ?? "",
      filter: { kind: "select", get: (t) => s.categoryById(t.categoryId)?.name ?? "—" },
    },
    ...(showRaisedBy
      ? [
          {
            key: "raisedBy",
            header: "Raised by",
            cell: (t: Ticket) => s.personName(t.raisedBy),
            sortValue: (t: Ticket) => s.personName(t.raisedBy).toLowerCase(),
            filter: { kind: "select" as const, get: (t: Ticket) => s.personName(t.raisedBy) },
          },
        ]
      : []),
    {
      key: "with",
      header: "With",
      cell: (t) => {
        if (!t.currentStep) return "—";
        const owners = ownersOf(t, s);
        return owners.length ? owners.join(", ") : "Nobody — needs routing";
      },
      sortValue: (t) => ownersOf(t, s).join(", ").toLowerCase(),
      filter: {
        kind: "select",
        get: (t) => {
          if (!t.currentStep) return "—";
          const owners = ownersOf(t, s);
          return owners.length ? owners.join(", ") : "Nobody — needs routing";
        },
      },
    },
    {
      key: "status",
      header: "Status",
      cell: (t) => <StatusPill status={t.status} />,
      // ⚠ sortValue is the ORDER OF THE WORKFLOW, not the alphabet: a reader
      //   scanning by status wants open work first, not "awaiting" before "open".
      sortValue: (t) => STATUS_ORDER[t.status] ?? 99,
      filter: { kind: "select", get: (t) => STATUS_LABEL[t.status] ?? t.status },
      resize: false,
    },
    {
      key: "raisedAt",
      header: "Raised",
      cell: (t) => formatDateDMY(t.raisedAt),
      sortValue: (t) => t.raisedAt,
      filter: { kind: "date", get: (t) => t.raisedAt },
    },
    {
      key: "due",
      header: "Due",
      cell: (t) => {
        const cat = s.categoryById(t.categoryId);
        const due = dueOf(t);
        if (due) return <DueCell dueIso={due} />;
        // See the ⚠ in the header: the policy's own words, never an invented date.
        return (
          <span className="text-[12.5px] text-grey-2" title="Governed by policy, not by a fixed number of working days">
            {cat?.tatText ?? "—"}
          </span>
        );
      },
      // Untimed rows sort to the END. An empty string would sort them to the
      // front as though they were the most overdue thing on the page.
      sortValue: (t) => dueOf(t) ?? "9999-12-31",
      filter: { kind: "date", get: (t) => dueOf(t) ?? "" },
    },
  ];

  return (
    <QueueTable
      rows={tickets}
      rowKey={(t) => t.id}
      columns={columns}
      loading={loading}
      rowsLabel="tickets"
      emptyTitle={emptyTitle}
      emptyMessage={emptyMessage}
      initialSort={{ key: "raisedAt", dir: "desc" }}
      onRowClick={(t) => nav(`${B}/tickets/${t.id}`)}
      exportName="help-desk-tickets"
      exportTitle="Help Desk — tickets"
      resizeKey="helpDeskTickets"
    />
  );
}

/** Workflow order, so sorting by status reads as progress rather than as spelling. */
const STATUS_ORDER: Record<string, number> = {
  open: 1,
  awaiting_info: 2,
  resolved: 3,
  on_hold: 4,
  closed: 5,
  cancelled: 6,
};

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  awaiting_info: "Needs your reply",
  resolved: "Resolved",
  on_hold: "On hold",
  closed: "Closed",
  cancelled: "Cancelled",
};

/** Who owes this ticket right now, as names. */
function ownersOf(t: Ticket, s: ReturnType<typeof useHelpStore>): string[] {
  if (!t.currentStep) return [];
  const e = s.queueEntries.find((q) => q.ticketId === t.id);
  return (e?.ownerIds ?? []).map((id) => s.personName(id)).filter((n) => n !== "—");
}
