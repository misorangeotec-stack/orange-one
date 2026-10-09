import { supabase } from "@/core/platform/supabase";
import type { DraftFileRef, SavedDraft } from "./savedDrafts";

/**
 * LOCAL TEST MODE for Save as draft — on only when VITE_DRAFTS_LOCAL=1 (set in
 * a developer's .env.local, never in Vercel).
 *
 * Same contract as the Supabase backend in savedDrafts.ts, but rows and files
 * live in this browser's IndexedDB, so the whole Save → Continue → Discard flow
 * can be audited on localhost before the fms_drafts migration reaches the live
 * database. What it cannot show: a draft following the person to another
 * machine, and an admin seeing other people's drafts.
 */

const DB_NAME = "o1-fms-drafts-local";
const ROWS = "drafts";
const FILES = "files";

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(ROWS, { keyPath: "id" });
      req.result.createObjectStore(FILES);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Local draft store unavailable."));
  });
}

async function run<R>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<R> {
  const d = await db();
  return new Promise<R>((resolve, reject) => {
    const req = fn(d.transaction(store, mode).objectStore(store));
    req.onsuccess = () => resolve(req.result as R);
    req.onerror = () => reject(req.error ?? new Error("Local draft store failed."));
  });
}

async function me(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error("Sign in again to use drafts.");
  return id;
}

export async function listDrafts<T>(appKey: string): Promise<SavedDraft<T>[]> {
  const owner = await me();
  const all = await run<SavedDraft<T>[]>(ROWS, "readonly", (s) => s.getAll());
  return all
    .filter((d) => d.appKey === appKey && d.ownerId === owner)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Every draft in this browser — local mode has no other people to hide. */
export async function listAllDrafts(): Promise<SavedDraft[]> {
  const all = await run<SavedDraft[]>(ROWS, "readonly", (s) => s.getAll());
  return all.map((d) => ({ ...d, summary: d.summary ?? [] })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function writeDraft<T>(input: {
  id: string;
  isNew: boolean;
  appKey: string;
  title: string;
  summary?: string[];
  payload: T;
  files: DraftFileRef[];
}): Promise<SavedDraft<T>> {
  const owner = await me();
  const now = new Date().toISOString();
  const prev = input.isNew ? undefined : await run<SavedDraft<T> | undefined>(ROWS, "readonly", (s) => s.get(input.id));
  if (!input.isNew && !prev) throw new Error("This draft no longer exists.");
  // Round-trip through JSON, as the database would: catches anything non-serialisable.
  const row: SavedDraft<T> = {
    id: input.id,
    appKey: input.appKey,
    ownerId: owner,
    title: input.title,
    summary: input.summary ?? [],
    payload: JSON.parse(JSON.stringify(input.payload)) as T,
    files: input.files,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };
  await run(ROWS, "readwrite", (s) => s.put(row));
  return row;
}

export async function uploadDraftFile(ownerId: string, draftId: string, file: File): Promise<DraftFileRef> {
  const path = `${ownerId}/${draftId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${file.name}`;
  await run(FILES, "readwrite", (s) => s.put(file, path));
  return { path, name: file.name, mimeType: file.type || null, sizeBytes: file.size };
}

export async function downloadDraftFile(ref: DraftFileRef): Promise<File> {
  const blob = await run<Blob | undefined>(FILES, "readonly", (s) => s.get(ref.path));
  if (!blob) throw new Error(`Could not load ${ref.name}.`);
  return new File([blob], ref.name, { type: ref.mimeType || blob.type || "" });
}

export async function removeDraftFiles(paths: string[]): Promise<void> {
  for (const p of paths) {
    try {
      await run(FILES, "readwrite", (s) => s.delete(p));
    } catch {
      /* ignore */
    }
  }
}

export async function deleteDraft(d: Pick<SavedDraft, "id" | "files">): Promise<void> {
  await run(ROWS, "readwrite", (s) => s.delete(d.id));
  await removeDraftFiles(d.files.map((f) => f.path));
}
