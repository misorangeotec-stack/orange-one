import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import Modal from "@/shared/components/ui/Modal";
import { formatDateDMY, dayKey } from "@/shared/lib/date";
import { useSession } from "@/core/platform/session";
import AnnouncementReader from "@/core/announcements/AnnouncementReader";
import StatusPill from "@/core/announcements/StatusPill";
import {
  ANNOUNCEMENTS_PATH,
  audienceLabel,
  dmy,
  STATUS_LABEL,
  STATUS_ORDER,
  useEndAnnouncement,
  useManagedAnnouncements,
  type ManagedAnnouncement,
} from "@/core/announcements/data";
import EditAnnouncementModal from "../components/EditAnnouncementModal";
import { B } from "../nav";

function emailedLabel(a: ManagedAnnouncement): string {
  return a.emailed_count != null ? `${a.emailed_count} ${a.emailed_count === 1 ? "person" : "people"}` : "Not emailed";
}

/**
 * PF-18 · Every announcement ever posted, whoever it was for, with Edit and End now.
 *
 * Flat, like every list in the portal: each column sorts and has a searchable filter
 * under it that narrows to what the other filters still allow (QueueTable does both).
 * Only the poster or an admin may edit or end one; the buttons follow `can_edit`
 * from the database, which checks the same thing again on the call.
 */
export default function Manage() {
  const navigate = useNavigate();
  const { state } = useLocation() as { state: { published?: string; emailed?: number } | null };
  const { canEditModule, isExternal } = useSession();
  const canPost = !isExternal && canEditModule("announcements");
  const { data, isLoading, error } = useManagedAnnouncements(canPost);
  const end = useEndAnnouncement();
  const [reading, setReading] = useState<ManagedAnnouncement | null>(null);
  const [editing, setEditing] = useState<ManagedAnnouncement | null>(null);
  const [ending, setEnding] = useState<ManagedAnnouncement | null>(null);
  const [endError, setEndError] = useState("");
  const rows = data ?? [];

  const columns = useMemo<QueueColumn<ManagedAnnouncement>[]>(
    () => [
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
        key: "by",
        header: "Posted by",
        cell: (a) => <span className="whitespace-nowrap text-grey">{a.posted_by ?? "—"}</span>,
        sortValue: (a) => a.posted_by ?? "",
        filter: { kind: "select", get: (a) => a.posted_by ?? "" },
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
            {a.ended_at && (
              <div className="text-[12px] text-grey-2">
                Ended {formatDateDMY(a.ended_at)}
                {a.ended_by ? ` by ${a.ended_by}` : ""}
              </div>
            )}
          </div>
        ),
        sortValue: (a) => a.ends_on,
        filter: { kind: "date", get: (a) => a.ends_on },
        exportValue: (a) => dmy(a.ends_on),
      },
      {
        key: "audience",
        header: "For",
        cell: (a) => <span className="text-grey">{audienceLabel(a.audience_modules)}</span>,
        sortValue: (a) => audienceLabel(a.audience_modules),
        filter: { kind: "select", get: (a) => audienceLabel(a.audience_modules) },
      },
      {
        key: "emailed",
        header: "Emailed",
        align: "right",
        cell: (a) => <span className="whitespace-nowrap text-grey">{emailedLabel(a)}</span>,
        sortValue: (a) => a.emailed_count ?? -1,
        filter: { kind: "select", get: emailedLabel },
        exportValue: (a) => a.emailed_count ?? "",
      },
      {
        key: "status",
        header: "Status",
        cell: (a) => <StatusPill status={a.status} />,
        sortValue: (a) => STATUS_ORDER[a.status],
        filter: { kind: "select", get: (a) => STATUS_LABEL[a.status] },
        exportValue: (a) => STATUS_LABEL[a.status],
      },
    ],
    []
  );

  if (!canPost) {
    return (
      <Card className="max-w-2xl p-6 text-[14px] text-grey">
        Posting and managing announcements needs Full access to the Announcements module. You can still read every
        announcement meant for you on <Link to={ANNOUNCEMENTS_PATH} className="font-semibold text-orange hover:underline">the Announcements page</Link>.
      </Card>
    );
  }

  const confirmEnd = () => {
    if (!ending) return;
    setEndError("");
    end.mutate(ending.id, {
      onSuccess: () => setEnding(null),
      onError: (e) => setEndError((e as Error).message),
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-navy">Announcements</h1>
          <p className="mt-1 text-[13.5px] text-grey-2">
            Everything posted, for everyone. Edit fixes the words or the end date; End now takes it off every screen at once.
          </p>
        </div>
        <Button onClick={() => navigate(`${B}/new`)}>New announcement</Button>
      </div>

      {state?.published && (
        <div className="rounded-xl border border-[#BFE8CF] bg-[#E8F7EE] px-4 py-3 text-[13.5px] text-[#1E8A4C]">
          Published <b>{state.published}</b>.{" "}
          {state.emailed ? `Emailed ${state.emailed} ${state.emailed === 1 ? "person" : "people"}.` : "No email was sent."}
        </div>
      )}

      {error ? (
        <div className="rounded-card border border-ryg-red/30 bg-white p-5 text-[13.5px] text-ryg-red">
          Could not load announcements: {(error as Error).message}
        </div>
      ) : (
        <QueueTable<ManagedAnnouncement>
          rows={rows}
          rowKey={(a) => a.id}
          columns={columns}
          loading={isLoading}
          rowsLabel="announcements"
          initialSort={{ key: "posted", dir: "desc" }}
          emptyTitle="Nothing posted yet"
          emptyMessage="Write the first one with New announcement. It shows at the top of every screen for the people it is for."
          actions={(a) => (
            <div className="flex items-center gap-1.5">
              {/* No Read button: the title opens it, and a third button here crushed
                  the Title column to one word per line. */}
              {a.can_edit && (
                <Button size="sm" variant="ghost" className="!px-3 !py-1.5 text-[12.5px]" onClick={() => setEditing(a)}>
                  Edit
                </Button>
              )}
              {a.can_edit && a.status === "running" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="!px-3 !py-1.5 text-[12.5px] !text-ryg-red"
                  onClick={() => {
                    setEndError("");
                    setEnding(a);
                  }}
                >
                  End now
                </Button>
              )}
            </div>
          )}
          exportName="Announcements_Posted"
        />
      )}

      <AnnouncementReader announcement={reading} open={!!reading} onClose={() => setReading(null)} />
      <EditAnnouncementModal row={editing} onClose={() => setEditing(null)} />

      <Modal
        open={!!ending}
        onClose={() => !end.isPending && setEnding(null)}
        title="End this announcement now?"
        subtitle={ending?.title}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEnding(null)} disabled={end.isPending}>
              Keep it running
            </Button>
            <Button onClick={confirmEnd} disabled={end.isPending}>
              {end.isPending ? "Ending…" : "End now"}
            </Button>
          </>
        }
      >
        <p className="text-[14px] text-ink">
          It leaves every screen at once, for everyone. It stays on the Announcements page, marked Ended early. This cannot be
          undone; to show it again, post it again.
        </p>
        {endError && (
          <div className="mt-3 rounded-xl border border-ryg-red/30 bg-[#FDECEC] px-4 py-3 text-[13px] text-ryg-red">{endError}</div>
        )}
      </Modal>
    </div>
  );
}
