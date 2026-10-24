import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { ITEM_TYPES, type ItemType, type MasterItem } from "@/core/platform/liveMasters";
import { colourFromDescription } from "./itemColour";
import {
  deleteAllOverrides, deleteOverrides, fetchOverrideIds, fetchOverrides, upsertOverrides,
} from "./overridesDb";

/**
 * BUSHRA CENTRAL MASTER — a mirror of Central Masters' items, edited by the team.
 *
 * ⚠ THE CENTRAL MASTER IS NEVER WRITTEN. Every row comes live from `mst_items`
 *   through the same loader and the same query key (`["masters", "items"]`) the
 *   admin screen uses, so the PF-17 realtime signal refreshes both at once: an
 *   item added centrally — by a sync or by hand — appears here with no action.
 *
 * ⚠ ONLY WHAT DIFFERS IS STORED. An override holds a field only while it
 *   disagrees with its source. Change a field back and the key is dropped, so
 *   later corrections to fields nobody has changed keep flowing through. A field
 *   that HAS been changed stays changed until it is reset.
 *
 * ⚠ THE SAVED VALUES ARE SHARED; ONE PERSON'S READING STATE IS NOT. Asked for on
 *   24-09-2026, this reverses the browser-only decision the app shipped with (which
 *   Ink IMS still holds). Three stores now, and the split is the whole design:
 *
 *     OVERRIDES  the server, `bushra_central_master_overrides` (20261212120000).
 *                One shared set: what anyone saves, everyone reads. Writes need the
 *                app at 'edit'; RLS, not this file, is what enforces that.
 *     DRAFTS     this browser. Half-typed edits are nobody else's business, and
 *                pushing them would hand colleagues an unfinished thought as fact.
 *     SEEN       this browser. "New from central" is about what THIS reader has
 *                already looked at; shared, the first person to open it would clear
 *                the flags for everyone.
 *
 *   The two local stores stay written defensively, because the browser is their only
 *   copy: PER USER (every key carries the signed-in user's id), and TAB-SAFE (a
 *   `storage` event from another tab refreshes this one).
 */

/**
 * The fields that can be changed here.
 *
 * Every one of them has a value behind it, so every one is stored only while it
 * DISAGREES with that value. `groupName` resolves Central's per-company group id
 * to its name. Central Masters carries neither a colour nor a description column
 * (MS-1), so those two are taken from Tally instead: the description is Tally's
 * own item name, and the colour is read out of it (lib/itemColour.ts).
 */
export interface MirrorOverride {
  itemType?: ItemType | null;
  category?: string | null;
  inkType?: string | null;
  groupName?: string | null;
  color?: string | null;
  code?: string | null;
  description?: string | null;
  active?: boolean;
  updatedAt?: string;
}

export type OverrideMap = Record<string, MirrorOverride>;

export const EDITABLE_KEYS = [
  "itemType", "category", "inkType", "groupName", "color", "code", "description",
] as const;
export type EditableKey = (typeof EDITABLE_KEYS)[number];

/** Unsaved cell edits, by item id — kept too, so leaving the page does not lose them. */
export type DraftMap = Record<string, Partial<Record<EditableKey, string>>>;

const PREFIX = "bushra-central-master";
export const APP_ID = "bushra-central-master";
const keyFor = (uid: string, what: "overrides" | "seen" | "drafts") => `${PREFIX}:${uid}:${what}:v1`;
/** Where this app kept its data before the keys carried a user. Adopted once, then removed. */
const LEGACY = { overrides: `${PREFIX}:overrides:v1`, seen: `${PREFIX}:seen:v1` };

/** The browser would not store it. The message is written for the person at the screen. */
export class StorageFullError extends Error {
  constructor() {
    super(
      "Not saved — this browser would not store it (its storage is full or blocked). " +
      "Your edits are still on screen. Take a Backup before closing the page.",
    );
  }
}

function readRaw(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new StorageFullError();
  }
}

// ---- shape checks -------------------------------------------------------------

const TYPE_VALUES = new Set<string>(ITEM_TYPES.map((t) => t.value));

/**
 * One stored override, checked. `undefined` = nothing in it; `null` = not the
 * expected shape. A value of the wrong type would otherwise reach the grid and crash
 * it on render — and now that the store is shared, it would do so for EVERYONE, on
 * every load, for as long as the row sat there.
 */
export function cleanOverride(v: unknown): MirrorOverride | null | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const src = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of EDITABLE_KEYS) {
    if (!(k in src)) continue;
    const x = src[k];
    if (x !== null && typeof x !== "string") return null;
    if (k === "itemType" && typeof x === "string" && !TYPE_VALUES.has(x)) return null;
    out[k] = x;
  }
  if ("active" in src) {
    if (typeof src.active !== "boolean") return null;
    out.active = src.active;
  }
  if (Object.keys(out).length === 0) return undefined;
  if (typeof src.updatedAt === "string") out.updatedAt = src.updatedAt;
  return out as MirrorOverride;
}

/**
 * A whole map, checked. `strict` (a backup being restored) refuses the file on the
 * first bad entry; otherwise a bad entry is dropped, never crashes.
 */
function cleanMap(v: unknown, strict: boolean): OverrideMap {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    if (strict) throw new Error("The backup holds no item list.");
    return {};
  }
  const out: OverrideMap = {};
  for (const [id, raw] of Object.entries(v as Record<string, unknown>)) {
    const o = cleanOverride(raw);
    if (o === null) {
      if (strict) throw new Error(`The backup's entry for item ${id} is not in the expected shape.`);
      continue;
    }
    if (o) out[id] = o;
  }
  return out;
}

const cleanIds = (v: unknown): Set<string> | null =>
  Array.isArray(v) && v.every((x) => typeof x === "string") ? new Set(v as string[]) : null;

// ---- the shared overrides -----------------------------------------------------

/** One key for the whole team's overrides; every write invalidates it. */
export const OVERRIDES_KEY = ["bushra-central-master", "overrides"] as const;

/**
 * The team's saved values.
 *
 * Not cached for long on purpose: these are other people's edits, and a stale grid
 * is one that saves over work it never showed. `staleTime: 0` makes returning to the
 * tab re-read, which is the cheapest form of "what has changed since I looked?".
 */
export function useOverrides() {
  return useQuery({
    queryKey: OVERRIDES_KEY,
    queryFn: () => fetchOverrides(cleanOverride),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

// ---- the per-browser stores (seen) --------------------------------------------

let uid: string | null = null;
/** Null until the first load has recorded what already existed. */
let seen: Set<string> | null = null;
let version = 0;
const listeners = new Set<() => void>();
const notify = () => {
  version++;
  listeners.forEach((l) => l());
};

/** Another tab saved: take its copy, so this tab does not show stale flags. */
function onStorage(e: StorageEvent) {
  if (!uid || !e.key) return;
  if (e.key === keyFor(uid, "seen")) {
    seen = cleanIds(readRaw(e.key)) ?? seen;
    notify();
  }
}
let listening = false;

/** Load the signed-in user's seen-list, once per user. Silent: it runs during render. */
function ensureLoaded(forUid: string) {
  if (uid === forUid) return;
  uid = forUid;
  let sn = readRaw(keyFor(forUid, "seen"));
  // The first open after keys became per-user: adopt what this browser held before.
  if (sn === null) {
    const legacySeen = readRaw(LEGACY.seen);
    if (legacySeen !== null && cleanIds(legacySeen)) {
      sn = legacySeen;
      try {
        write(keyFor(forUid, "seen"), sn);
        window.localStorage.removeItem(LEGACY.seen);
      } catch {
        // Left where it was; the next load tries again.
      }
    }
  }
  seen = cleanIds(sn);
  version++;
  if (!listening) {
    window.addEventListener("storage", onStorage);
    listening = true;
  }
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** What THIS reader has already looked at. Deliberately not shared — see the file header. */
export function useSeen(forUid: string) {
  ensureLoaded(forUid);
  useSyncExternalStore(subscribe, () => version);
  return seen;
}

function requireUid(): string {
  if (!uid) throw new Error("The mirror store was used before it was loaded.");
  return uid;
}

const norm = (v: string | null | undefined) => (v ?? "").trim() || null;

/**
 * The value an editable field starts at; groupName is resolved by the caller.
 *
 * ⚠ THIS IS WHAT "UNCHANGED" MEANS. A cell equal to this is not stored at all, so
 *   the field keeps following its source — which is what lets a Tally rename reach
 *   a description nobody has overwritten. Type over it and only then is it yours.
 *
 * Description is Tally's own item name: it IS the description, and the item has no
 * other. Colour is read back out of that same text, so the two always agree.
 */
export function centralValue(item: MasterItem, key: EditableKey, centralGroupName: string | null): string | null {
  switch (key) {
    case "itemType": return item.itemType;
    case "category": return item.category;
    case "inkType": return item.inkType;
    case "groupName": return centralGroupName;
    case "code": return item.code;
    case "description": return item.name;
    case "color": return colourFromDescription(item.name);
  }
}

/** One row's worth of edits, as the grid hands them over. */
export interface MirrorEdit {
  item: MasterItem;
  centralGroupName: string | null;
  values: Partial<Record<EditableKey, string>>;
}

/** What one row's override becomes, given the edits over it. Nothing is written here. */
function nextOverride({ item, centralGroupName, values }: MirrorEdit, current: MirrorOverride = {}): MirrorOverride | null {
  const next: MirrorOverride = {};
  for (const key of EDITABLE_KEYS) {
    // A key the edit does not mention keeps whatever the override already holds,
    // so saving one cell never silently drops the others.
    if (!(key in values)) {
      if (current[key] !== undefined) (next as Record<string, unknown>)[key] = current[key];
      continue;
    }
    const mine = norm(values[key]);
    if (mine !== norm(centralValue(item, key, centralGroupName))) (next as Record<string, unknown>)[key] = mine;
  }
  const wantActive = current.active ?? item.active;
  if (wantActive !== item.active) next.active = wantActive;

  return Object.keys(next).length === 0 ? null : { ...next, updatedAt: new Date().toISOString() };
}

/**
 * Save many rows at once — what the grid's single Save button and the Excel import
 * call. The rows that still hold something are upserted; the rows left holding
 * nothing are DELETED, so a field edited back to Central's value stops being stored
 * rather than lingering as an empty override.
 *
 * `current` is the team's overrides as this screen last read them. Two people editing
 * the same item resolve last-save-wins; different items never contend.
 */
export async function saveMany(edits: MirrorEdit[], current: OverrideMap, userId: string): Promise<number> {
  if (edits.length === 0) return 0;
  const toWrite: [string, MirrorOverride][] = [];
  const toClear: string[] = [];
  for (const edit of edits) {
    const row = nextOverride(edit, current[edit.item.id]);
    if (row) toWrite.push([edit.item.id, row]);
    else if (current[edit.item.id]) toClear.push(edit.item.id);
  }
  if (toWrite.length) await upsertOverrides(toWrite, userId);
  if (toClear.length) await deleteOverrides(toClear);
  return edits.length;
}

export async function resetOverride(id: string): Promise<void> {
  await deleteOverrides([id]);
}

export async function resetAllOverrides(): Promise<void> {
  await deleteAllOverrides();
}

/** Replace every saved change with a checked backup's — the whole team's, so the caller confirms. */
export async function replaceAllOverrides(map: OverrideMap, userId: string): Promise<void> {
  await deleteAllOverrides();
  const entries = Object.entries(map);
  if (entries.length) await upsertOverrides(entries, userId);
}

/**
 * ONE-TIME ADOPTION — carry this browser's old private edits up to the shared table.
 *
 * Before 24-09-2026 everything typed here lived in localStorage and nowhere else, so
 * without this step the move to a shared store would read to the person who did the
 * typing as though their work had been thrown away.
 *
 * ⚠ IT NEVER OVERWRITES WHAT IS ALREADY SHARED. Only items the server holds NO row
 *   for are carried up. A colleague who has since set a value on the same item keeps
 *   it — this browser's copy is, by definition, from before the table existed, and
 *   the older of two answers must not win just because it arrived later.
 *
 * ⚠ THE LOCAL COPY IS REMOVED ONLY AFTER THE WRITE SUCCEEDS, so a failure here can be
 *   retried on the next open rather than losing the edits it was meant to rescue.
 *
 * Skipped entirely for a view-only reader: they cannot write, and their old private
 * values are not the team's to publish on their behalf.
 */
export async function adoptLocalOverrides(forUid: string, userId: string): Promise<number> {
  const local = cleanMap(readRaw(keyFor(forUid, "overrides")) ?? readRaw(LEGACY.overrides), false);
  const entries = Object.entries(local);
  if (entries.length === 0) {
    // Nothing to carry, but a stale empty key would keep asking. Clear it.
    try {
      window.localStorage.removeItem(keyFor(forUid, "overrides"));
      window.localStorage.removeItem(LEGACY.overrides);
    } catch { /* nothing was there to begin with */ }
    return 0;
  }

  const taken = await fetchOverrideIds();
  const fresh = entries.filter(([id]) => !taken.has(id));
  if (fresh.length) await upsertOverrides(fresh, userId);

  try {
    window.localStorage.removeItem(keyFor(forUid, "overrides"));
    window.localStorage.removeItem(LEGACY.overrides);
  } catch { /* the write landed; a leftover key is only retried, never re-applied */ }
  return fresh.length;
}

/** True when this browser still holds pre-24-09-2026 edits that have not been carried up. */
export function hasLocalOverrides(forUid: string): boolean {
  const local = readRaw(keyFor(forUid, "overrides")) ?? readRaw(LEGACY.overrides);
  return Object.keys(cleanMap(local, false)).length > 0;
}

/**
 * Record the ids central holds right now. The very first load marks everything
 * as seen — otherwise all 14,000 items would open flagged "New from central".
 * Written only when it changes; a failure here costs only the "New" flags.
 */
export function noteCentralIds(ids: string[]) {
  if (seen !== null) return;
  seen = new Set(ids);
  try { write(keyFor(requireUid(), "seen"), ids); } catch { /* kept in memory for this visit */ }
  notify();
}

export function markAllSeen(ids: string[]) {
  seen = new Set(ids);
  try { write(keyFor(requireUid(), "seen"), ids); } catch { /* kept in memory for this visit */ }
  notify();
}

// ---- unsaved drafts -----------------------------------------------------------

/** The drafts left on this browser, checked — anything malformed is dropped. */
export function loadDrafts(): DraftMap {
  const raw = readRaw(keyFor(requireUid(), "drafts"));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: DraftMap = {};
  for (const [id, d] of Object.entries(raw as Record<string, unknown>)) {
    if (!d || typeof d !== "object" || Array.isArray(d)) continue;
    const row: Partial<Record<EditableKey, string>> = {};
    for (const k of EDITABLE_KEYS) {
      const v = (d as Record<string, unknown>)[k];
      if (typeof v === "string") row[k] = v;
    }
    if (Object.keys(row).length) out[id] = row;
  }
  return out;
}

/** Keep the drafts. False when the browser refused — the page then warns before unload. */
export function saveDrafts(drafts: DraftMap): boolean {
  const key = keyFor(requireUid(), "drafts");
  try {
    if (Object.keys(drafts).length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(drafts));
    return true;
  } catch {
    return false;
  }
}

// ---- JSON backup --------------------------------------------------------------

export function buildBackup(overrides: OverrideMap): string {
  return JSON.stringify(
    { kind: "bushra-central-master-backup", version: 1, savedAt: new Date().toISOString(), overrides },
    null,
    2,
  );
}

/** A backup file, read and checked — nothing is written yet. Throws with a readable reason. */
export function parseBackup(text: string): { overrides: OverrideMap; savedAt: string | null } {
  let parsed: { kind?: unknown; overrides?: unknown; savedAt?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("This file is not a backup — it could not be read.");
  }
  if (parsed?.kind !== "bushra-central-master-backup") {
    throw new Error("This is not a Bushra Central Master backup file.");
  }
  return {
    overrides: cleanMap(parsed.overrides, true),
    savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : null,
  };
}
