import { useCallback, useEffect, useMemo, useState } from "react";
import { Paperclip } from "lucide-react";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { useDirectory } from "@/core/platform/store";
import { useSession } from "@/core/platform/session";
import {
  DRAFTS_LOCAL,
  deleteDraft,
  draftFileUrl,
  listAllDrafts,
  type DraftFileRef,
  type SavedDraft,
} from "@/shared/lib/savedDrafts";
import { appName } from "../../appInfo";

/** "procurement:request" → "Purchase RM Domestic". The prefix is the app id. */
const fmsOf = (d: SavedDraft) => appName(d.appKey.split(":")[0]);

const when = (iso: string) =>
  new Date(iso).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const label = (k: string) => k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

/**
 * Fallback for a draft saved without summary lines: the payload's own readable
 * values. Ids are dropped — they mean nothing on screen.
 */
function payloadLines(v: unknown, prefix = ""): string[] {
  if (v === null || v === undefined || v === "" || v === false) return [];
  if (typeof v === "string") return UUID.test(v) ? [] : [prefix ? `${prefix}: ${v}` : v];
  if (typeof v === "number" || v === true) return [prefix ? `${prefix}: ${v === true ? "Yes" : v}` : String(v)];
  if (Array.isArray(v)) {
    return v.flatMap((x) => {
      if (x && typeof x === "object") {
        const parts = payloadLines(x).filter(Boolean);
        return parts.length ? [`• ${parts.join(" · ")}`] : [];
      }
      return payloadLines(x, prefix);
    });
  }
  if (typeof v === "object") {
    return Object.entries(v as Record<string, unknown>)
      .filter(([k]) => k !== "uid" && !/Id$|^id$|Ids$/.test(k))
      .flatMap(([k, x]) => payloadLines(x, label(k)));
  }
  return [];
}

/**
 * Every saved draft across the FMS raise forms, on one page. Who sees what is
 * RLS's call: an admin and anyone granted 'all-drafts' see all of them; anyone
 * else, only their own. View is for everyone here; Discard only for the owner
 * or an admin — continuing a draft happens on its own FMS raise form.
 */
export default function AllDrafts() {
  const { user, isAdmin } = useSession();
  const { profileById } = useDirectory();
  const [rows, setRows] = useState<SavedDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [viewing, setViewing] = useState<SavedDraft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await listAllDrafts());
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const ownerName = useCallback((d: SavedDraft) => profileById(d.ownerId)?.name ?? "Unknown user", [profileById]);
  const canDiscard = (d: SavedDraft) => isAdmin || d.ownerId === user.id;

  const discard = async (d: SavedDraft) => {
    if (!window.confirm(`Discard ${ownerName(d)}'s draft "${d.title || "Untitled"}"? This cannot be undone.`)) return;
    setBusy(d.id);
    try {
      await deleteDraft(d);
      setRows((rs) => rs.filter((r) => r.id !== d.id));
      if (viewing?.id === d.id) setViewing(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const openFile = async (f: DraftFileRef) => {
    try {
      window.open(await draftFileUrl(f), "_blank", "noopener,noreferrer");
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const columns: QueueColumn<SavedDraft>[] = useMemo(
    () => [
      {
        key: "fms",
        header: "FMS",
        cell: (d) => <span className="font-semibold text-navy">{fmsOf(d)}</span>,
        sortValue: fmsOf,
        filter: { kind: "select", get: fmsOf },
      },
      {
        key: "title",
        header: "Draft",
        cell: (d) => d.title || "Untitled draft",
        sortValue: (d) => d.title,
        filter: { kind: "text", get: (d) => d.title },
      },
      {
        key: "owner",
        header: "Saved by",
        cell: ownerName,
        sortValue: ownerName,
        filter: { kind: "select", get: ownerName },
      },
      {
        key: "updated",
        header: "Last saved",
        cell: (d) => <span className="whitespace-nowrap">{when(d.updatedAt)}</span>,
        sortValue: (d) => d.updatedAt,
        exportValue: (d) => when(d.updatedAt),
        filter: { kind: "select", get: (d) => new Date(d.updatedAt).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) },
      },
      {
        key: "files",
        header: "Files",
        align: "right",
        cell: (d) =>
          d.files.length ? (
            <span className="inline-flex items-center gap-1">
              <Paperclip className="h-3.5 w-3.5" />
              {d.files.length}
            </span>
          ) : (
            "—"
          ),
        sortValue: (d) => d.files.length,
        exportValue: (d) => d.files.length,
        filter: { kind: "select", get: (d) => (d.files.length ? "With files" : "No files") },
      },
    ],
    [ownerName],
  );

  const details = viewing ? (viewing.summary.length ? viewing.summary : payloadLines(viewing.payload)) : [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">All Drafts</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Every request saved as a draft across the FMS, not yet submitted. The person who saved it continues it from
          that FMS's raise form.
          {DRAFTS_LOCAL && <span className="ml-1 font-semibold text-orange">Local test mode: drafts in this browser only.</span>}
        </p>
      </div>

      {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}

      <QueueTable<SavedDraft>
        rows={rows}
        rowKey={(d) => d.id}
        columns={columns}
        initialSort={{ key: "updated", dir: "desc" }}
        rowsLabel="drafts"
        loading={loading}
        emptyTitle="No drafts"
        emptyMessage="Drafts saved on any FMS raise form appear here."
        exportName="all-drafts"
        onRowClick={setViewing}
        actions={(d) => (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setViewing(d);
              }}
              className="text-[12.5px] font-semibold text-orange hover:underline"
            >
              View
            </button>
            {canDiscard(d) && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={(e) => {
                  e.stopPropagation();
                  void discard(d);
                }}
                className="text-[12.5px] font-semibold text-ryg-red hover:underline disabled:opacity-50"
              >
                {busy === d.id ? "Discarding…" : "Discard"}
              </button>
            )}
          </div>
        )}
      />

      <Modal
        open={viewing !== null}
        onClose={() => setViewing(null)}
        title={viewing?.title || "Untitled draft"}
        subtitle={viewing ? `${fmsOf(viewing)} · saved by ${ownerName(viewing)} · ${when(viewing.updatedAt)}` : undefined}
        size="lg"
        footer={
          <div className="flex justify-end gap-3">
            {viewing && canDiscard(viewing) && (
              <Button variant="ghost" size="sm" onClick={() => void discard(viewing)} disabled={busy !== null}>
                Discard
              </Button>
            )}
            <Button size="sm" onClick={() => setViewing(null)}>Close</Button>
          </div>
        }
      >
        {viewing && (
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-grey-2">What it holds</p>
              {details.length ? (
                <ul className="space-y-1 text-[13.5px] text-navy">
                  {details.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-grey-2">Nothing filled in yet.</p>
              )}
            </div>
            <div>
              <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-grey-2">
                Attachments ({viewing.files.length})
              </p>
              {viewing.files.length ? (
                <ul className="space-y-1">
                  {viewing.files.map((f) => (
                    <li key={f.path}>
                      <button
                        type="button"
                        onClick={() => void openFile(f)}
                        className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-orange hover:underline"
                      >
                        <Paperclip className="h-3.5 w-3.5" />
                        {f.name}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-grey-2">No files attached.</p>
              )}
            </div>
            <p className="text-[12px] text-grey-2">
              Created {when(viewing.createdAt)}. Only {ownerName(viewing)} can continue and submit it, from the{" "}
              {fmsOf(viewing)} raise form.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
