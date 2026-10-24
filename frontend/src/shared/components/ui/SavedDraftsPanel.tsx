import { useState } from "react";
import { FileText, Paperclip } from "lucide-react";
import { useDirectory } from "@/core/platform/store";
import { DRAFTS_LOCAL, type SavedDraft } from "@/shared/lib/savedDrafts";
import type { SavedDraftsApi } from "@/shared/lib/useSavedDrafts";
import Button from "./Button";
import Card from "./Card";

/** "2 Oct, 10:42" */
const when = (iso: string) =>
  new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * The drafts bucket at the top of a raise form — there is deliberately no
 * separate Drafts page. Renders nothing when the person has no drafts, so the
 * form looks exactly as it always did.
 *
 * Continue loads a draft INTO the form below; Discard deletes it after a
 * confirm. An admin (or someone granted All Drafts, read-only) also sees
 * everyone else's drafts of this form, with who saved them. Never Continue:
 * that would raise the request in the wrong name. Discard: admins only.
 */
export default function SavedDraftsPanel<T>({
  api,
  onContinue,
  noun = "request",
}: {
  api: SavedDraftsApi<T>;
  /** Put a loaded draft into the form. The panel does the download. */
  onContinue: (payload: T, files: File[]) => void;
  /** What the form raises — "request", "order", "ticket". */
  noun?: string;
}) {
  const { profileById } = useDirectory();
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (api.loading || (api.drafts.length === 0 && !api.loadError)) return null;

  const cont = async (d: SavedDraft<T>) => {
    setErr(null);
    try {
      const { payload, files } = await api.open(d);
      onContinue(payload, files);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const drop = async (d: SavedDraft<T>) => {
    const whose = d.ownerId === api.ownerId ? "" : ` saved by ${profileById(d.ownerId)?.name ?? "another user"}`;
    if (!window.confirm(`Discard the draft "${d.title || "Untitled"}"${whose}? This cannot be undone.`)) return;
    setErr(null);
    setBusyId(d.id);
    try {
      await api.discard(d);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const row = (d: SavedDraft<T>, own: boolean) => {
    const editing = api.active?.id === d.id;
    return (
      <li
        key={d.id}
        className={`flex flex-wrap items-center gap-3 px-4 py-3 ${editing ? "bg-orange/5" : ""}`}
      >
        <FileText className="h-4 w-4 shrink-0 text-grey-2" />
        <div className="min-w-0 grow">
          <p className="truncate text-[13.5px] font-semibold text-navy">{d.title || "Untitled draft"}</p>
          <p className="text-[12px] text-grey-2">
            {!own && <span className="font-semibold text-grey">{profileById(d.ownerId)?.name ?? "Another user"} · </span>}
            Saved {when(d.updatedAt)}
            {d.files.length > 0 && (
              <span className="ml-2 inline-flex items-center gap-0.5">
                <Paperclip className="h-3 w-3" />
                {d.files.length}
              </span>
            )}
          </p>
        </div>
        {editing ? (
          <span className="rounded-full bg-orange/10 px-2.5 py-1 text-[11.5px] font-semibold text-orange">Editing below</span>
        ) : (
          own && (
            <Button size="sm" onClick={() => void cont(d)} disabled={api.opening !== null || busyId !== null}>
              {api.opening === d.id ? "Opening…" : "Continue"}
            </Button>
          )
        )}
        {/* Someone else's draft: only an admin may delete it (an All Drafts grant is read-only). */}
        {(own || api.isAdmin) && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void drop(d)}
            disabled={busyId !== null || api.opening !== null}
          >
            {busyId === d.id ? "Discarding…" : "Discard"}
          </Button>
        )}
      </li>
    );
  };

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-[14.5px] font-bold text-navy">
          Your drafts{api.mine.length > 0 ? ` (${api.mine.length})` : ""}
          {DRAFTS_LOCAL && (
            <span className="ml-2 rounded-full bg-orange/10 px-2 py-0.5 text-[11px] font-semibold text-orange">
              Local test mode · this browser only
            </span>
          )}
        </h2>
        <p className="text-[12.5px] text-grey-2">
          {api.mine.length > 0
            ? `Continue a saved ${noun} or discard it. Only you, admins and people given All Drafts access can see them.`
            : "You have no saved drafts here."}
        </p>
      </div>

      {api.mine.length > 0 && <ul className="divide-y divide-line">{api.mine.map((d) => row(d, true))}</ul>}

      {api.others.length > 0 && (
        <>
          <div className="border-y border-line bg-page px-4 py-2 text-[12px] font-semibold uppercase tracking-wide text-grey-2">
            Other people's drafts ({api.others.length}) · {api.isAdmin ? "admin view" : "view only"}
          </div>
          <ul className="divide-y divide-line">{api.others.map((d) => row(d, false))}</ul>
        </>
      )}

      {(err || api.loadError) && <p className="px-4 py-2 text-[12.5px] text-ryg-red">{err ?? api.loadError}</p>}
    </Card>
  );
}

/**
 * The form's draft button and its "Saved to drafts" line. Goes in the action
 * row, next to Submit. Once a draft is loaded or saved, it updates that draft.
 */
export function SaveDraftButton<T>({
  api,
  onSave,
  disabled,
}: {
  api: SavedDraftsApi<T>;
  /** Gather the form and call `api.save`. Throw to show an error. */
  onSave: () => Promise<unknown>;
  disabled?: boolean;
}) {
  const [err, setErr] = useState<string | null>(null);
  const click = async () => {
    setErr(null);
    try {
      await onSave();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button variant="ghost" onClick={() => void click()} disabled={disabled || api.saving}>
        {api.saving ? "Saving…" : api.active ? "Update draft" : "Save as draft"}
      </Button>
      {api.savedAt && !err && (
        <span className="text-[12px] text-teal">
          Saved to drafts ·{" "}
          {new Date(api.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      )}
      {err && <span className="text-[12px] text-ryg-red">{err}</span>}
    </span>
  );
}
