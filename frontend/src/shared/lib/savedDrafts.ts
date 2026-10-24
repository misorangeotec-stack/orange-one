import { supabase } from "@/core/platform/supabase";
import * as local from "./savedDraftsLocal";

/**
 * "Save as draft" for FMS raise forms — the server side.
 *
 * A draft is a parked FORM in `public.fms_drafts`, not a request: no number, no
 * step, invisible to every queue and report. RLS lets only its owner and admins
 * read it. Its files sit in the private `fms-drafts` bucket under
 * `<owner>/<draft>/…`, and come back as ordinary `File`s on Continue, so each
 * app's own upload path runs unchanged at submit.
 *
 * Not to be confused with `draftStore.ts`, the browser-only autosave of a step
 * modal. That one is silent and per-device; this one is an explicit button and
 * follows the person to any machine.
 *
 * Migration: supabase/migrations/20270103120000_add_fms_drafts.sql.
 */

const BUCKET = "fms-drafts";

/** Local test mode (browser storage, no database) — see savedDraftsLocal.ts. */
export const DRAFTS_LOCAL = import.meta.env.VITE_DRAFTS_LOCAL === "1";

/** A file stored with a draft. */
export interface DraftFileRef {
  path: string;
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
}

export interface SavedDraft<T = unknown> {
  id: string;
  appKey: string;
  ownerId: string;
  title: string;
  /** Plain-language lines of what the draft holds — what All Drafts shows. */
  summary: string[];
  payload: T;
  files: DraftFileRef[];
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  app_key: string;
  owner_id: string;
  title: string;
  summary: string[] | null;
  payload: unknown;
  files: { path: string; name: string; mime_type?: string | null; size_bytes?: number | null }[] | null;
  created_at: string;
  updated_at: string;
}

// fms_drafts is not in database.types.ts — this module is its only reader.
const table = () => (supabase as any).from("fms_drafts");

const COLS = "id, app_key, owner_id, title, summary, payload, files, created_at, updated_at";

const fromRow = <T,>(r: Row): SavedDraft<T> => ({
  id: r.id,
  appKey: r.app_key,
  ownerId: r.owner_id,
  title: r.title,
  summary: Array.isArray(r.summary) ? r.summary.map(String) : [],
  payload: r.payload as T,
  files: (r.files ?? []).map((f) => ({
    path: f.path,
    name: f.name,
    mimeType: f.mime_type ?? null,
    sizeBytes: f.size_bytes ?? null,
  })),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toFilesJson = (files: DraftFileRef[]) =>
  files.map((f) => ({ path: f.path, name: f.name, mime_type: f.mimeType, size_bytes: f.sizeBytes }));

/** Every draft of this form the caller may see: their own, or everyone's for an admin. Newest first. */
export async function listDrafts<T>(appKey: string): Promise<SavedDraft<T>[]> {
  if (DRAFTS_LOCAL) return local.listDrafts<T>(appKey);
  const { data, error } = await table()
    .select(COLS)
    .eq("app_key", appKey)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map((r) => fromRow<T>(r));
}

/**
 * Every draft of every FMS the caller may see — for the All Drafts page. RLS
 * decides: owner, admin, or an 'all-drafts' grant. Newest first.
 */
export async function listAllDrafts(): Promise<SavedDraft[]> {
  if (DRAFTS_LOCAL) return local.listAllDrafts();
  const { data, error } = await table().select(COLS).order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map((r) => fromRow(r));
}

/** A short-lived link to open a draft's attachment. */
export async function draftFileUrl(ref: DraftFileRef): Promise<string> {
  if (DRAFTS_LOCAL) return URL.createObjectURL(await local.downloadDraftFile(ref));
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(ref.path, 60 * 10);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

/** Insert (no id) or update (id) a draft row. Files must already be uploaded. */
export async function writeDraft<T>(input: {
  id: string;
  isNew: boolean;
  appKey: string;
  title: string;
  summary?: string[];
  payload: T;
  files: DraftFileRef[];
}): Promise<SavedDraft<T>> {
  if (DRAFTS_LOCAL) return local.writeDraft<T>(input);
  const body = {
    title: input.title,
    summary: input.summary ?? [],
    payload: input.payload,
    files: toFilesJson(input.files),
  };
  const q = input.isNew
    ? table().insert({ id: input.id, app_key: input.appKey, ...body })
    : table().update(body).eq("id", input.id);
  const { data, error } = await q
    .select(COLS)
    .single();
  if (error) throw new Error(error.message);
  return fromRow<T>(data as Row);
}

/** Upload one file into the owner's folder for this draft. */
export async function uploadDraftFile(ownerId: string, draftId: string, file: File): Promise<DraftFileRef> {
  if (DRAFTS_LOCAL) return local.uploadDraftFile(ownerId, draftId, file);
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${ownerId}/${draftId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safeName}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
  if (error) throw new Error(error.message);
  return { path, name: file.name, mimeType: file.type || null, sizeBytes: file.size };
}

/** Fetch a stored draft file back as a `File` the form can hold like any other pick. */
export async function downloadDraftFile(ref: DraftFileRef): Promise<File> {
  if (DRAFTS_LOCAL) return local.downloadDraftFile(ref);
  const { data, error } = await supabase.storage.from(BUCKET).download(ref.path);
  if (error || !data) throw new Error(error?.message ?? `Could not load ${ref.name}.`);
  return new File([data], ref.name, { type: ref.mimeType || data.type || "" });
}

/** Best effort: an orphaned object is a nuisance, never a reason to fail a save. */
export async function removeDraftFiles(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  if (DRAFTS_LOCAL) return local.removeDraftFiles(paths);
  try {
    await supabase.storage.from(BUCKET).remove(paths);
  } catch {
    /* ignore */
  }
}

/** Delete the draft row and its files. */
export async function deleteDraft(d: Pick<SavedDraft, "id" | "files">): Promise<void> {
  if (DRAFTS_LOCAL) return local.deleteDraft(d);
  const { error } = await table().delete().eq("id", d.id);
  if (error) throw new Error(error.message);
  await removeDraftFiles(d.files.map((f) => f.path));
}
