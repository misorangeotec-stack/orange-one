import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import EmptyState from "@/shared/components/ui/EmptyState";
import { FieldLabel, Select, TextArea, TextInput } from "@/shared/components/ui/Form";
import { useSession } from "@/core/platform/session";
import { APPS, appName } from "../../appInfo";
import {
  accessAppIdFor, deleteVideo, fetchVideos, isMicrosoftLink, linkProblem, LOCAL_TEST, moduleName, saveVideo,
  type TrainingVideo, type VideoDraft,
} from "../lib/videos";

/**
 * TRAINING VIDEOS — the library. Videos grouped by module; "Watch" opens the OneDrive /
 * SharePoint link in a new tab.
 *
 * WHO SEES WHAT (asked for 03-10-2026): a person sees only the videos of the modules they hold
 * in Module Access — granted Order to Dispatch, they see the Order to Dispatch videos and no
 * others. Admins see every video. RLS on training_videos applies the same rule, so this filter
 * is for the screen, not the security.
 *
 * Only ADMINS get Add / Edit link / Remove (and on localhost, anyone, so it can be tried — see
 * LOCAL_TEST).
 */

const APP = appName("training-videos");
const KEY = ["training-videos"];

/**
 * The Module dropdown: the portal's own modules, by the names the left menu shows (appInfo).
 * The video stores the module's ID, which is what decides who sees it. Training Videos itself
 * is left out.
 */
const PORTAL_MODULES = Object.entries(APPS)
  .filter(([id]) => id !== "training-videos")
  .map(([id, a]) => ({ id, name: a.name }))
  .sort((a, b) => a.name.localeCompare(b.name));

const BLANK: VideoDraft = { appId: "", title: "", url: "", description: "", sortOrder: 100 };

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="14" rx="2" />
    <path d="m10 8 5 3-5 3Z" />
  </svg>
);

export default function VideoLibrary() {
  const { user, isAdmin, hasModule } = useSession();
  // NOT canEditModule: the app is universal, so that reads 'edit' for everyone. RLS agrees —
  // writes on training_videos need is_admin().
  const canEdit = isAdmin || LOCAL_TEST;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: fetchVideos });

  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<{ id: string | null; draft: VideoDraft } | null>(null);
  const [removing, setRemoving] = useState<TrainingVideo | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (e: { id: string | null; draft: VideoDraft }) => saveVideo(e.id, e.draft, user.id),
    onSuccess: () => {
      setEditing(null);
      setErr(null);
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteVideo(id),
    onSuccess: () => {
      setRemoving(null);
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e: Error) => setErr(e.message),
  });

  // Only the modules this person holds. hasModule is already true for admins and for the
  // universal apps, so neither needs naming here.
  const videos = useMemo(
    () => (q.data ?? []).filter((v) => hasModule(accessAppIdFor(v.appId))),
    [q.data, hasModule],
  );

  const groups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const shown = needle
      ? videos.filter((v) => `${moduleName(v.appId)} ${v.title} ${v.description ?? ""}`.toLowerCase().includes(needle))
      : videos;
    const by = new Map<string, TrainingVideo[]>();
    for (const v of shown) by.set(v.appId, [...(by.get(v.appId) ?? []), v]);
    return [...by.entries()]
      .map(([appId, rows]) => ({
        appId,
        module: moduleName(appId),
        rows: rows.sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title)),
      }))
      .sort((a, b) => a.module.localeCompare(b.module));
  }, [videos, search]);

  const openNew = (appId = "") => {
    setErr(null);
    setEditing({ id: null, draft: { ...BLANK, appId } });
  };
  const openEdit = (v: TrainingVideo) => {
    setErr(null);
    setEditing({
      id: v.id,
      draft: { appId: v.appId, title: v.title, url: v.url, description: v.description ?? "", sortOrder: v.sortOrder },
    });
  };

  const draft = editing?.draft;
  const urlProblem = draft ? linkProblem(draft.url) : null;
  const canSave = !!draft && !!draft.appId && !!draft.title.trim() && !urlProblem && !save.isPending;
  const setDraft = (patch: Partial<VideoDraft>) =>
    setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));

  return (
    <div className="mx-auto max-w-[1100px] space-y-5 px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-navy">{APP}</h1>
          <p className="text-[13px] text-grey">
            The training video for each module. <b>Watch</b> opens the recording from OneDrive / SharePoint in a new tab — sign in with your company Microsoft account if asked.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TextInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search videos…"
            className="h-10 w-56"
          />
          {canEdit && (
            <Button size="sm" onClick={() => openNew()}>
              + Add video
            </Button>
          )}
        </div>
      </div>

      {LOCAL_TEST && (
        <Card className="border-orange/40 bg-orange-soft p-3 text-[12.5px] text-navy">
          <b>Local test mode.</b> Videos you add here are saved in this browser only — nothing is written to the live
          database, and nobody else sees them.
        </Card>
      )}

      {q.isError && (
        <Card className="border-ryg-red/40 p-4 text-[13px] text-ryg-red">
          The videos could not be loaded: {(q.error as Error).message}
        </Card>
      )}
      {err && !editing && (
        <Card className="border-ryg-red/40 p-4 text-[13px] text-ryg-red">{err}</Card>
      )}

      {q.isLoading ? (
        <Card className="p-6 text-[13px] text-grey">Loading videos…</Card>
      ) : !videos.length && !q.isError ? (
        <Card>
          <EmptyState
            icon={<PlayIcon />}
            title={canEdit ? "No training videos yet" : "No training videos for your modules yet"}
            message={
              canEdit
                ? "Add the first one — paste its OneDrive / SharePoint link."
                : "You see the videos of the modules you have access to. They will appear here once they are added."
            }
            {...(canEdit ? { actionLabel: "+ Add video", onAction: () => openNew() } : {})}
          />
        </Card>
      ) : !groups.length ? (
        <Card className="p-6 text-[13px] text-grey">No video matches “{search}”.</Card>
      ) : (
        groups.map((g) => (
          <Card key={g.appId} className="overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-line bg-[#F7F9FC] px-4 py-2.5">
              <h2 className="text-[14px] font-bold text-navy">
                {g.module} <span className="font-medium text-grey-2">· {g.rows.length}</span>
              </h2>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => openNew(g.appId)}
                  className="text-[12.5px] font-semibold text-orange hover:underline"
                >
                  + Add to {g.module}
                </button>
              )}
            </div>
            <ul className="divide-y divide-line">
              {g.rows.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-soft text-orange [&>svg]:h-5 [&>svg]:w-5">
                    <PlayIcon />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold text-navy">{v.title}</div>
                    {v.description && <div className="text-[12.5px] text-grey">{v.description}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    <a
                      href={v.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl bg-orange-grad px-4 py-2 text-[13px] font-semibold text-white shadow-cta transition hover:-translate-y-0.5"
                    >
                      ▶ Watch
                    </a>
                    {canEdit && (
                      <>
                        <Button variant="ghost" size="sm" className="px-3 py-2" onClick={() => openEdit(v)}>
                          Edit link
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="px-3 py-2 text-ryg-red"
                          onClick={() => {
                            setErr(null);
                            setRemoving(v);
                          }}
                        >
                          Remove
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? "Edit video link" : "Add training video"}
        subtitle="Upload the video to OneDrive or SharePoint, click Share, set it to “People in your organisation with the link”, copy the link and paste it here."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button size="sm" disabled={!canSave} onClick={() => editing && save.mutate(editing)}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        {draft && (
          <div className="space-y-4">
            <FieldLabel label="Module" required hint="Only people with access to this module see the video">
              <Select value={draft.appId} onChange={(e) => setDraft({ appId: e.target.value })}>
                <option value="">Select a module…</option>
                {/* A saved module that is no longer in the portal still shows, so editing an
                    old video never silently moves it. */}
                {draft.appId && !PORTAL_MODULES.some((m) => m.id === draft.appId) && (
                  <option value={draft.appId}>{moduleName(draft.appId)}</option>
                )}
                {PORTAL_MODULES.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </FieldLabel>
            <FieldLabel label="Video title" required>
              <TextInput
                value={draft.title}
                onChange={(e) => setDraft({ title: e.target.value })}
                placeholder="e.g. Raising a purchase requisition"
              />
            </FieldLabel>
            <FieldLabel label="Video link (OneDrive / SharePoint)" required>
              <TextInput
                value={draft.url}
                onChange={(e) => setDraft({ url: e.target.value })}
                placeholder="https://yourcompany-my.sharepoint.com/:v:/g/personal/…"
              />
              {draft.url.trim() && urlProblem && <p className="mt-1 text-[12px] text-ryg-red">{urlProblem}</p>}
              {draft.url.trim() && !urlProblem && !isMicrosoftLink(draft.url) && (
                <p className="mt-1 text-[12px] text-grey-2">This is not a OneDrive / SharePoint link — it will still be saved.</p>
              )}
            </FieldLabel>
            <FieldLabel label="Short description">
              <TextArea
                rows={2}
                value={draft.description}
                onChange={(e) => setDraft({ description: e.target.value })}
                placeholder="What the video covers (optional)"
              />
            </FieldLabel>
            <FieldLabel label="Position" hint="Lower numbers are listed first within the module">
              <TextInput
                type="number"
                value={draft.sortOrder}
                onChange={(e) => setDraft({ sortOrder: Number(e.target.value) })}
                className="w-28"
              />
            </FieldLabel>
            {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
          </div>
        )}
      </Modal>

      <Modal
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Remove this video?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button size="sm" disabled={remove.isPending} onClick={() => removing && remove.mutate(removing.id)}>
              {remove.isPending ? "Removing…" : "Remove"}
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-grey">
          <b className="text-navy">{removing?.title}</b> will no longer be listed. The video itself stays on OneDrive.
        </p>
      </Modal>
    </div>
  );
}
