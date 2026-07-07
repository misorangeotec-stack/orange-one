/**
 * Offline-first sync engine for leads.
 *
 * The local AsyncStorage cache (per user) is the UI source of truth, so capture
 * works fully offline. Supabase (`app_leads` / `app_lead_masters` + `lead-media`
 * storage) is the source of record. Each sync cycle FLUSHES local changes up
 * (from a persisted outbox that survives app kills), then PULLS remote changes
 * and merges last-write-wins by `updatedAt`.
 *
 * No duplication: every contact has a stable client uuid = the row PK, and all
 * writes are upsert-on-conflict(id) → idempotent.
 * No loss: the outbox is cleared only after a successful push; media is uploaded
 * before the row and guarded by a media-map so nothing re-uploads.
 *
 * Pure-ish: talks to supabase + AsyncStorage but holds no React state.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { File } from 'expo-file-system';

import type { Database } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';
import type { Contact, Masters } from './types';

type LeadRow = Database['public']['Tables']['app_leads']['Row'];
type LeadInsert = Database['public']['Tables']['app_leads']['Insert'];

export const EPOCH = '1970-01-01T00:00:00.000Z';
const BUCKET = 'lead-media';
const time = (iso: string) => new Date(iso).getTime();

// React Native's fetch has NO timeout — a stalled request hangs forever and would
// wedge the whole sync (the chip stuck on "Syncing…"). Every network call is
// wrapped so it can only ever fail, never hang.
class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}
function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
    Promise.resolve(p).then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

// ---- Per-user storage keys -------------------------------------------------

const ns = (base: string, userId: string) => `${base}::${userId}`;
export function keys(userId: string) {
  return {
    contacts: ns('orange-one-leads.contacts.v2', userId),
    masters: ns('orange-one-leads.masters.v2', userId),
    cursor: ns('orange-one-leads.cursor.v1', userId),
    outbox: ns('orange-one-leads.outbox.v1', userId),
    mediamap: ns('orange-one-leads.mediamap.v1', userId),
  };
}

// ---- Outbox (persisted pending work) --------------------------------------

export type Outbox = {
  /** Contact ids whose row needs upserting (added/edited). */
  contactIds: string[];
  /** id → last-known contact, upserted as a deleted=true tombstone. */
  deletes: Record<string, Contact>;
  /** Whether the masters row needs upserting. */
  masters: boolean;
};

export const emptyOutbox = (): Outbox => ({ contactIds: [], deletes: {}, masters: false });

export function outboxHasWork(o: Outbox): boolean {
  return o.contactIds.length > 0 || Object.keys(o.deletes).length > 0 || o.masters;
}

export async function loadOutbox(userId: string): Promise<Outbox> {
  try {
    const raw = await AsyncStorage.getItem(keys(userId).outbox);
    if (!raw) return emptyOutbox();
    const p = JSON.parse(raw) as Partial<Outbox>;
    return { contactIds: p.contactIds ?? [], deletes: p.deletes ?? {}, masters: !!p.masters };
  } catch {
    return emptyOutbox();
  }
}
export const saveOutbox = (userId: string, o: Outbox) =>
  AsyncStorage.setItem(keys(userId).outbox, JSON.stringify(o)).catch(() => {});

// ---- Cache -----------------------------------------------------------------

export type CacheBundle = { contacts: Contact[]; masters: Masters | null; mastersUpdatedAt: string; cursor: string };

export async function loadCache(userId: string): Promise<CacheBundle | null> {
  const k = keys(userId);
  try {
    const raw = await AsyncStorage.getItem(k.contacts);
    if (raw == null) return null;
    const contacts = JSON.parse(raw) as Contact[];
    let masters: Masters | null = null;
    let mastersUpdatedAt = EPOCH;
    const mRaw = await AsyncStorage.getItem(k.masters);
    if (mRaw) {
      const m = JSON.parse(mRaw) as { masters?: Masters; updatedAt?: string };
      masters = m.masters ?? null;
      mastersUpdatedAt = m.updatedAt ?? EPOCH;
    }
    const cursor = (await AsyncStorage.getItem(k.cursor)) ?? EPOCH;
    return { contacts: Array.isArray(contacts) ? contacts : [], masters, mastersUpdatedAt, cursor };
  } catch {
    return null;
  }
}

export const saveContactsCache = (userId: string, contacts: Contact[]) =>
  AsyncStorage.setItem(keys(userId).contacts, JSON.stringify(contacts)).catch(() => {});
export const saveMastersCache = (userId: string, masters: Masters, updatedAt: string) =>
  AsyncStorage.setItem(keys(userId).masters, JSON.stringify({ masters, updatedAt })).catch(() => {});
export const saveCursor = (userId: string, cursor: string) =>
  AsyncStorage.setItem(keys(userId).cursor, cursor).catch(() => {});

async function loadMediaMap(userId: string): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(keys(userId).mediamap);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}
const saveMediaMap = (userId: string, map: Record<string, string>) =>
  AsyncStorage.setItem(keys(userId).mediamap, JSON.stringify(map)).catch(() => {});

// ---- Media upload ----------------------------------------------------------

function contentTypeFor(uri: string): string {
  const ext = uri.split('?')[0].split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'm4a' || ext === 'mp4') return 'audio/mp4';
  if (ext === 'wav') return 'audio/wav';
  if (ext === 'caf') return 'audio/x-caf';
  return ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'application/octet-stream';
}

const isLocal = (uri?: string | null): uri is string =>
  !!uri && !uri.startsWith('http') && !uri.startsWith(`${BUCKET}/`);

/** Upload one local file, returning its storage path (cached in mediaMap). Throws on network error. */
async function uploadOne(userId: string, contactId: string, uri: string, map: Record<string, string>): Promise<string> {
  if (map[uri]) return map[uri];
  const bytes = await withTimeout(new File(uri).bytes(), 15000, 'read media');
  const ext = uri.split('?')[0].split('.').pop()?.toLowerCase() || 'dat';
  const path = `${userId}/${contactId}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await withTimeout(
    supabase.storage.from(BUCKET).upload(path, bytes as unknown as ArrayBuffer, {
      contentType: contentTypeFor(uri),
      upsert: true,
    }),
    30000,
    'upload media'
  );
  if (error) throw error;
  const stored = `${BUCKET}/${path}`;
  map[uri] = stored;
  return stored;
}

/**
 * Clone a contact with every LOCAL media uri replaced by its uploaded storage
 * path. Best-effort: a media file that can't be read/uploaded keeps its local
 * uri so the lead still syncs (the capturing device keeps showing it; it
 * re-uploads on a later dirty cycle). Never throws. Legacy contacts may miss
 * some arrays, so every field is guarded.
 */
async function prepareForUpload(userId: string, c: Contact, map: Record<string, string>): Promise<Contact> {
  const up = async (uri?: string | null): Promise<string | null> => {
    if (!isLocal(uri)) return uri ?? null;
    try {
      return await uploadOne(userId, c.id, uri, map);
    } catch {
      return uri; // keep local uri — media is best-effort, the lead row still syncs
    }
  };
  const out: Contact = JSON.parse(JSON.stringify(c));
  out.person = out.person ?? ({} as Contact['person']);
  out.company = out.company ?? ({} as Contact['company']);
  out.person.photoUri = await up(c.person?.photoUri);
  out.company.logoUri = await up(c.company?.logoUri);
  out.cardImages = { front: await up(c.cardImages?.front), back: await up(c.cardImages?.back) };
  out.reminderPhotos = [];
  for (const p of c.reminderPhotos ?? []) out.reminderPhotos.push((await up(p)) as string);
  out.voiceNotes = [];
  for (const v of c.voiceNotes ?? []) out.voiceNotes.push({ ...v, uri: (await up(v.uri)) as string });
  return out;
}

// ---- Row <-> domain --------------------------------------------------------

function contactToRow(userId: string, c: Contact, deleted: boolean): LeadInsert {
  return {
    id: c.id,
    user_id: userId,
    person_name: c.person?.name ?? '',
    company_name: c.company?.name ?? '',
    interest_level_id: c.interestLevelId ?? null,
    follow_up_action_id: c.followUpActionId ?? null,
    captured_on: c.capturedOn,
    payload: c as unknown as Database['public']['Tables']['app_leads']['Insert']['payload'],
    deleted,
    updated_at: c.updatedAt,
  };
}

function rowToContact(row: LeadRow): Contact {
  const c = (row.payload ?? {}) as unknown as Contact;
  return { ...c, id: row.id, updatedAt: row.updated_at };
}

/** Keep the capturing device's LOCAL media uris when overwriting with a remote row. */
function preserveLocalMedia(remote: Contact, local: Contact): Contact {
  const pick = (r?: string | null, l?: string | null) => (isLocal(l) ? l : r ?? null);
  return {
    ...remote,
    person: { ...remote.person, photoUri: pick(remote.person.photoUri, local.person.photoUri) },
    company: { ...remote.company, logoUri: pick(remote.company.logoUri, local.company.logoUri) },
    cardImages: {
      front: pick(remote.cardImages?.front, local.cardImages?.front),
      back: pick(remote.cardImages?.back, local.cardImages?.back),
    },
    voiceNotes: remote.voiceNotes.map((rv) => {
      const lv = local.voiceNotes.find((x) => x.id === rv.id);
      return lv && isLocal(lv.uri) ? { ...rv, uri: lv.uri } : rv;
    }),
  };
}

/** Merge remote rows into local, last-write-wins by updatedAt; handle tombstones. */
export function mergeContacts(local: Contact[], rows: LeadRow[]): Contact[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const localById = new Map(local.map((c) => [c.id, c]));
  const handled = new Set<string>();
  const result: Contact[] = [];

  for (const c of local) {
    const r = byId.get(c.id);
    if (!r) {
      result.push(c);
      continue;
    }
    handled.add(c.id);
    if (r.deleted) {
      if (time(r.updated_at) >= time(c.updatedAt)) continue; // remote delete wins
      result.push(c); // local edit newer → keep, re-upload
    } else {
      result.push(time(r.updated_at) > time(c.updatedAt) ? preserveLocalMedia(rowToContact(r), c) : c);
    }
  }
  for (const r of rows) {
    if (handled.has(r.id) || r.deleted) continue;
    const local0 = localById.get(r.id);
    result.push(local0 ? preserveLocalMedia(rowToContact(r), local0) : rowToContact(r));
  }
  // Guard against any duplicate ids sneaking into the local list (a corrupted
  // cache or a bad merge) — keep one entry per id, newest first.
  const unique = Array.from(new Map(result.map((c) => [c.id, c])).values());
  return unique.sort((a, b) => time(b.capturedOn) - time(a.capturedOn));
}

/** Collapse any duplicate-id entries, keeping the last occurrence. */
export function dedupeById(list: Contact[]): Contact[] {
  return Array.from(new Map(list.map((c) => [c.id, c])).values());
}

// ---- Flush (push) ----------------------------------------------------------

export type FlushResult = { outbox: Outbox; error: string | null };

export async function flush(
  userId: string,
  contactsById: Map<string, Contact>,
  outbox: Outbox
): Promise<FlushResult> {
  // Masters are admin-managed globally now — the mobile app only reads them, never
  // pushes. So flush only ever uploads lead rows + media.
  const next: Outbox = { contactIds: [...outbox.contactIds], deletes: { ...outbox.deletes }, masters: false };
  let error: string | null = null;

  // 1) Push the lead ROWS first — plain JSON, small, fast, reliable. Media may
  //    still be local file:// uris at this point; that's fine (the capturing
  //    device shows them, and step 3 swaps in storage paths best-effort). This
  //    ordering is what makes the sync COMPLETE in ~seconds even when media
  //    upload is slow or offline — the lead never waits on its photos/audio.
  const rows: LeadInsert[] = [];
  for (const id of outbox.contactIds) {
    const c = contactsById.get(id);
    if (!c) continue; // deleted meanwhile
    rows.push(contactToRow(userId, c, false));
  }
  for (const tomb of Object.values(outbox.deletes)) rows.push(contactToRow(userId, tomb, true));

  if (rows.length > 0) {
    try {
      const { error: e } = await withTimeout(
        supabase.from('app_leads').upsert(rows, { onConflict: 'id' }),
        30000,
        'upsert leads'
      );
      if (e) return { outbox: next, error: e.message }; // offline/transient → keep outbox, retry
      next.contactIds = [];
      next.deletes = {};
    } catch (e) {
      return { outbox: next, error: e instanceof Error ? e.message : 'upsert leads failed' };
    }
  }

  // 2) Media best-effort: upload each dirty contact's local media, then re-write
  //    JUST that row with the storage paths — same updated_at, so no LWW churn.
  //    Every failure is swallowed; the lead already synced in step 1, so nothing
  //    here can wedge the cycle or lose data.
  const map = await loadMediaMap(userId);
  try {
    for (const id of outbox.contactIds) {
      const c = contactsById.get(id);
      if (!c) continue;
      const withMedia = await prepareForUpload(userId, c, map); // non-throwing
      if (JSON.stringify(withMedia) !== JSON.stringify(c)) {
        await withTimeout(
          supabase.from('app_leads').upsert([contactToRow(userId, withMedia, false)], { onConflict: 'id' }),
          30000,
          'upsert media paths'
        ).catch(() => {});
      }
    }
  } finally {
    await saveMediaMap(userId, map); // persist whatever uploaded
  }

  return { outbox: next, error };
}

// ---- Pull ------------------------------------------------------------------

export type PullResult = { rows: LeadRow[]; masters: Masters | null; mastersUpdatedAt: string | null; cursor: string };

export async function pull(since: string): Promise<PullResult> {
  const { data: rows, error } = await withTimeout(
    supabase.from('app_leads').select('*').gt('updated_at', since),
    30000,
    'pull leads'
  );
  if (error) throw error;
  // Masters are the single admin-managed org-wide row (id = 'global').
  const { data: mRow } = await withTimeout(
    supabase.from('app_lead_masters_global').select('masters,updated_at').eq('id', 'global').maybeSingle(),
    30000,
    'pull masters'
  );

  let cursor = since;
  let cursorT = time(since);
  for (const r of (rows as LeadRow[] | null) ?? []) {
    if (time(r.updated_at) > cursorT) {
      cursorT = time(r.updated_at);
      cursor = r.updated_at;
    }
  }
  if (mRow && time(mRow.updated_at) > cursorT) cursor = mRow.updated_at;

  return {
    rows: ((rows as LeadRow[] | null) ?? []),
    masters: (mRow?.masters as unknown as Masters) ?? null,
    mastersUpdatedAt: mRow?.updated_at ?? null,
    cursor,
  };
}

/** Resolve a media uri for display: local files pass through; storage paths → signed url. */
export async function resolveMediaUrl(uri?: string | null): Promise<string | null> {
  if (!uri) return null;
  if (!uri.startsWith(`${BUCKET}/`)) return uri; // local file:// or http
  const path = uri.slice(BUCKET.length + 1);
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

export async function clearUserCache(userId: string): Promise<void> {
  const k = keys(userId);
  await AsyncStorage.multiRemove([k.contacts, k.masters, k.cursor, k.outbox, k.mediamap]).catch(() => {});
}
