import { useMemo, useState } from "react";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import Button from "@/shared/components/ui/Button";
import { formatDateDMY, dayKey } from "@/shared/lib/date";
import { useSession } from "@/core/platform/session";
import AnnouncementReader from "./AnnouncementReader";
import StatusPill from "./StatusPill";
import {
  audienceLabel,
  dmy,
  STATUS_LABEL,
  STATUS_ORDER,
  useAnnouncementHistory,
  type HistoryAnnouncement,
} from "./data";

/** What the strip is doing with it for YOU — the answer to "why can't I see it any more?". */
function stripState(a: HistoryAnnouncement): string {
  if (a.status !== "running") return "No longer shown";
  return a.dismissed ? "Closed by you" : "Showing";
}

function emailedLabel(a: HistoryAnnouncement): string {
  return a.emailed_count != null ? `${a.emailed_count} ${a.emailed_count === 1 ? "person" : "people"}` : "Not emailed";
}

/**
 * PF-18 · `/announcements` — every announcement the reader was meant to see, running
 * or past, so one they closed or that has run out can be read again.
 *
 * Open to every member of staff with no grant: it is portal furniture like `/account`,
 * not a module, and the database decides the list (announcements_history), so there
 * is nothing here to gate. People who may post also see who posted each one and how
 * many it was emailed to.
 */
export default function AnnouncementsHistory() {
  const { canEditModule, isExternal } = useSession();
  const isPoster = !isExternal && canEditModule("announcements");
  const { data, isLoading, error } = useAnnouncementHistory();
  const [reading, setReading] = useState<HistoryAnnouncement | null>(null);
  const rows = data ?? [];

  const columns = useMemo<QueueColumn<HistoryAnnouncement>[]>(() => {
    const cols: QueueColumn<HistoryAnnouncement>[] = [
      {
        key: "title",
        header: "Title",
        cell: (a) => (
          <button type="button" onClick={() => setReading(a)} className="min-w-[220px] max-w-[420px] text-left font-semibold text-navy hover:text-orange hover:underline">
            {a.title}
          </button>
        ),
        sortValue: (a) => a.title.toLowerCase(),
        filter: { kind: "text", get: (a) => `${a.title} ${a.body ?? ""}` },
        exportValue: (a) => a.title,
      },
      {
        key: "posted",
        header: "Posted on",
        cell: (a) => <span className="whitespace-nowrap text-grey">{formatDateDMY(a.created_at)}</span>,
        sortValue: (a) => a.created_at,
        filter: { kind: "date", get: (a) => dayKey(a.created_at) ?? "" },
        exportValue: (a) => formatDateDMY(a.created_at),
      },
      {
        key: "ends",
        header: "Ends",
        cell: (a) => (
          <div className="whitespace-nowrap">
            <div className="text-grey">{dmy(a.ends_on)}</div>
            {a.ended_at && <div className="text-[12px] text-grey-2">Ended {formatDateDMY(a.ended_at)}</div>}
          </div>
        ),
        sortValue: (a) => a.ends_on,
        filter: { kind: "date", get: (a) => a.ends_on },
        exportValue: (a) => dmy(a.ends_on),
      },
      {
        key: "status",
        header: "Status",
        cell: (a) => <StatusPill status={a.status} />,
        sortValue: (a) => STATUS_ORDER[a.status],
        filter: { kind: "select", get: (a) => STATUS_LABEL[a.status] },
        exportValue: (a) => STATUS_LABEL[a.status],
      },
      {
        key: "strip",
        header: "On your screen",
        cell: (a) => <span className="whitespace-nowrap text-grey-2">{stripState(a)}</span>,
        sortValue: (a) => stripState(a),
        filter: { kind: "select", get: (a) => stripState(a) },
      },
    ];
    if (isPoster) {
      cols.push(
        {
          key: "audience",
          header: "For",
          cell: (a) => <span className="text-grey">{audienceLabel(a.audience_modules)}</span>,
          sortValue: (a) => audienceLabel(a.audience_modules),
          filter: { kind: "select", get: (a) => audienceLabel(a.audience_modules) },
        },
        {
          key: "by",
          header: "Posted by",
          cell: (a) => <span className="whitespace-nowrap text-grey">{a.posted_by ?? "—"}</span>,
          sortValue: (a) => a.posted_by ?? "",
          filter: { kind: "select", get: (a) => a.posted_by ?? "" },
        },
        {
          key: "emailed",
          header: "Emailed",
          align: "right",
          cell: (a) => <span className="whitespace-nowrap text-grey">{emailedLabel(a)}</span>,
          sortValue: (a) => a.emailed_count ?? -1,
          filter: { kind: "select", get: emailedLabel },
          exportValue: (a) => a.emailed_count ?? "",
        }
      );
    }
    return cols;
  }, [isPoster]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Announcements</h1>
        <p className="mt-1 text-[13.5px] text-grey-2">
          Everything posted for you, running or past. Open one to read it in full, even after you have closed it.
        </p>
      </div>

      {error ? (
        <div className="rounded-card border border-ryg-red/30 bg-white p-5 text-[13.5px] text-ryg-red">
          Could not load announcements: {(error as Error).message}
        </div>
      ) : (
        <QueueTable<HistoryAnnouncement>
          rows={rows}
          rowKey={(a) => a.id}
          columns={columns}
          loading={isLoading}
          rowsLabel="announcements"
          initialSort={{ key: "posted", dir: "desc" }}
          emptyTitle="No announcements yet"
          emptyMessage="When something is posted for you, it shows at the top of every screen and stays listed here."
          actions={(a) => (
            <Button size="sm" variant="ghost" className="!px-3 !py-1.5 text-[12.5px]" onClick={() => setReading(a)}>
              Read
            </Button>
          )}
          exportName="Announcements"
        />
      )}

      <AnnouncementReader announcement={reading} open={!!reading} onClose={() => setReading(null)} showHistoryLink={false} />
    </div>
  );
}
