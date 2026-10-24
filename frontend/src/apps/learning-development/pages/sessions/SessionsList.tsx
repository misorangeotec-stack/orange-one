import { useMemo } from "react";
import { Link } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { useLdStore } from "../../store";
import { B } from "../../nav";
import { dmy, inr } from "../../lib/format";
import type { TrainingSession } from "../../types";

const STATUS_LABEL: Record<string, string> = {
  scheduled: "Scheduled",
  nomination_open: "Nominations open",
  invited: "Invitations sent",
  ready: "Ready to run",
  conducted: "Conducted",
  attendance_closed: "Attendance closed",
  in_review: "Reviewed",
  closed: "Closed",
  rescheduled: "Rescheduled",
  cancelled: "Cancelled",
};

/**
 * Every session, flat, sortable and filterable on every column — the register
 * behind the calendar, and what Excel exports from.
 *
 * ⚠ NO `groupBy`. Banding by type or by month would make that the PRIMARY sort,
 *   so a list ordered by date would only be ordered within each band and the next
 *   session could hide mid-page. Both are ordinary columns with their own sort
 *   and filter.
 */
export default function SessionsList() {
  const s = useLdStore();
  const d = s.data;

  const typeNames = useMemo(() => {
    const m = new Map((d?.sessionTypes ?? []).map((t) => [t.id, t.name] as const));
    return (ids: string[]) => ids.map((i) => m.get(i)).filter(Boolean).join(", ") || "—";
  }, [d?.sessionTypes]);

  const trainerName = (id: string | null) =>
    (d?.trainers ?? []).find((t) => t.id === id)?.name ?? "—";

  const countFor = (sessionId: string) => {
    const noms = (d?.nominations ?? []).filter((n) => n.sessionId === sessionId && n.status === "approved");
    const att = (d?.attendance ?? []).filter(
      (a) => a.sessionId === sessionId && ["present", "partial"].includes(a.status),
    );
    return { nominated: noms.length, attended: att.length };
  };

  const feedbackAvg = (sessionId: string): number | null => {
    const rows = (d?.feedback ?? []).filter((f) => f.sessionId === sessionId);
    if (rows.length === 0) return null;
    return rows.reduce((n, f) => n + f.overallRating, 0) / rows.length;
  };

  const columns: QueueColumn<TrainingSession>[] = [
    {
      key: "code",
      header: "Session",
      cell: (x) => (
        <Link to={`${B}/sessions/${x.id}`} className="font-semibold text-navy hover:text-orange">
          {x.code ?? "—"}
        </Link>
      ),
      sortValue: (x) => x.code ?? "zzz",
    },
    {
      key: "title",
      header: "Topic",
      cell: (x) => <span className="text-navy">{x.title}</span>,
      filter: { kind: "text", get: (x) => x.title },
    },
    {
      key: "type",
      header: "Type",
      cell: (x) => typeNames(x.sessionTypeIds),
      filter: { kind: "select", get: (x) => typeNames(x.sessionTypeIds) },
    },
    {
      key: "trainer",
      header: "Trainer / agency",
      cell: (x) => trainerName(x.trainerId),
      filter: { kind: "select", get: (x) => trainerName(x.trainerId) },
    },
    {
      key: "date",
      header: "Date",
      cell: (x) => dmy(x.sessionDate),
      sortValue: (x) => x.sessionDate,
      filter: { kind: "date", get: (x) => x.sessionDate },
    },
    {
      key: "people",
      header: "Attended",
      align: "right",
      cell: (x) => {
        const c = countFor(x.id);
        return x.attendanceClosedAt ? `${c.attended} of ${c.nominated}` : `${c.nominated} nominated`;
      },
      sortValue: (x) => countFor(x.id).attended,
      exportValue: (x) => countFor(x.id).attended,
    },
    {
      key: "hours",
      header: "Hours",
      align: "right",
      cell: (x) => x.hours ?? "—",
      sortValue: (x) => x.hours ?? -1,
    },
    {
      key: "feedback",
      header: "Feedback",
      align: "right",
      cell: (x) => {
        const a = feedbackAvg(x.id);
        return a === null ? <span className="text-grey-2">—</span> : `${a.toFixed(1)} / 5`;
      },
      sortValue: (x) => feedbackAvg(x.id) ?? -1,
      exportValue: (x) => feedbackAvg(x.id)?.toFixed(1) ?? "",
    },
    {
      key: "cost",
      header: "Cost",
      align: "right",
      cell: (x) => inr(x.actualCost),
      sortValue: (x) => x.actualCost ?? -1,
      exportValue: (x) => x.actualCost ?? "",
    },
    {
      key: "status",
      header: "Status",
      cell: (x) => STATUS_LABEL[x.status] ?? x.status,
      filter: { kind: "select", get: (x) => STATUS_LABEL[x.status] ?? x.status },
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">All sessions</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Every training that has been scheduled, and how each one went.
        </p>
      </div>

      <QueueTable
        rows={s.sessions}
        rowKey={(x) => x.id}
        columns={columns}
        loading={s.loading}
        rowsLabel="sessions"
        initialSort={{ key: "date", dir: "desc" }}
        exportName="training-sessions"
        exportTitle="Training sessions"
        emptyTitle="No sessions yet"
        emptyMessage="A session appears here once an approved training request has been scheduled."
      />
    </div>
  );
}
