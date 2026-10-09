import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/core/platform/session";
import {
  deleteDraft,
  downloadDraftFile,
  listDrafts,
  removeDraftFiles,
  uploadDraftFile,
  writeDraft,
  type DraftFileRef,
  type SavedDraft,
} from "./savedDrafts";

/**
 * The drafts of one raise form, plus the draft currently loaded into it.
 *
 * A form wires this up with three things it already has: a JSON-safe snapshot of
 * its fields, a way to put a snapshot back, and its picked `File`s. Everything
 * about where drafts live stays in here.
 *
 *  • `save` inserts the first time and updates the loaded draft after that, so
 *    pressing it twice never makes two drafts.
 *  • A file is uploaded once. Files that came back from a draft, or were already
 *    uploaded by an earlier save, are remembered by identity and not re-sent;
 *    files the user removed since the last save are deleted from storage.
 *  • `finish` is called after the real submit succeeded: the draft has become a
 *    request, so it goes. It never throws — the request is already raised.
 *
 * Identity is the REAL session, not a demo persona: RLS checks auth.uid().
 */
export function useSavedDrafts<T>(appKey: string) {
  const { user, isAdmin } = useSession();
  const ownerId = user?.id ?? null;

  const [drafts, setDrafts] = useState<SavedDraft<T>[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [active, setActive] = useState<SavedDraft<T> | null>(null);
  const [saving, setSaving] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  /** File → its stored copy, so a re-save doesn't upload the same file again. */
  const stored = useRef(new WeakMap<File, DraftFileRef>());

  const refresh = useCallback(async () => {
    if (!ownerId) return;
    try {
      setDrafts(await listDrafts<T>(appKey));
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [appKey, ownerId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (input: { title: string; summary?: string[]; payload: T; files?: File[] }): Promise<SavedDraft<T>> => {
      if (!ownerId) throw new Error("Sign in again to save a draft.");
      setSaving(true);
      try {
        const isNew = active === null;
        const id = active?.id ?? crypto.randomUUID();
        const refs: DraftFileRef[] = [];
        for (const f of input.files ?? []) {
          let ref = stored.current.get(f);
          // A file stored under another draft (or by another owner) is copied in fresh.
          if (!ref || !ref.path.startsWith(`${ownerId}/${id}/`)) {
            ref = await uploadDraftFile(ownerId, id, f);
            stored.current.set(f, ref);
          }
          refs.push(ref);
        }
        const saved = await writeDraft<T>({
          id, isNew, appKey, title: input.title, summary: input.summary, payload: input.payload, files: refs,
        });
        // Files dropped since the last save.
        const keep = new Set(refs.map((r) => r.path));
        if (active) await removeDraftFiles(active.files.map((f) => f.path).filter((p) => !keep.has(p)));
        setActive(saved);
        setSavedAt(Date.now());
        setDrafts((ds) => [saved, ...ds.filter((d) => d.id !== saved.id)]);
        return saved;
      } finally {
        setSaving(false);
      }
    },
    [active, appKey, ownerId],
  );

  /** Load a draft: returns its fields and its files, ready to put into the form. */
  const open = useCallback(async (d: SavedDraft<T>): Promise<{ payload: T; files: File[] }> => {
    setOpening(d.id);
    try {
      const files: File[] = [];
      for (const ref of d.files) {
        const f = await downloadDraftFile(ref);
        stored.current.set(f, ref);
        files.push(f);
      }
      setActive(d);
      setSavedAt(null);
      return { payload: d.payload, files };
    } finally {
      setOpening(null);
    }
  }, []);

  const discard = useCallback(
    async (d: SavedDraft<T>) => {
      await deleteDraft(d);
      setDrafts((ds) => ds.filter((x) => x.id !== d.id));
      if (active?.id === d.id) {
        setActive(null);
        setSavedAt(null);
      }
    },
    [active],
  );

  /** The loaded draft was submitted as a real request. */
  const finish = useCallback(async () => {
    if (!active) return;
    const d = active;
    setActive(null);
    setSavedAt(null);
    setDrafts((ds) => ds.filter((x) => x.id !== d.id));
    try {
      await deleteDraft(d);
    } catch {
      /* the request is raised; a leftover draft is harmless and can be discarded */
    }
  }, [active]);

  /** Stop editing the loaded draft (it stays saved); the form starts afresh. */
  const detach = useCallback(() => {
    setActive(null);
    setSavedAt(null);
  }, []);

  const mine = drafts.filter((d) => d.ownerId === ownerId);
  const others = drafts.filter((d) => d.ownerId !== ownerId);

  return {
    drafts,
    mine,
    /** Other people's drafts — only ever non-empty for an admin. */
    others,
    isAdmin,
    ownerId,
    loading,
    loadError,
    active,
    saving,
    opening,
    savedAt,
    save,
    open,
    discard,
    finish,
    detach,
    refresh,
  };
}

export type SavedDraftsApi<T> = ReturnType<typeof useSavedDrafts<T>>;
