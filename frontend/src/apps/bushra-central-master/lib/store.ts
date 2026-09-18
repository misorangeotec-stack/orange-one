import { useSyncExternalStore } from "react";
import { ITEM_TYPES, type ItemType, type MasterItem } from "@/core/platform/liveMasters";

/**
 * BUSHRA CENTRAL MASTER — a private mirror of Central Masters' items.
 *
 * ⚠ THE CENTRAL MASTER IS NEVER WRITTEN. Every row comes live from `mst_items`
 *   through the same loader and the same query key (`["masters", "items"]`) the
 *   admin screen uses, so the PF-17 realtime signal refreshes both at once: an
 *   item added centrally — by a sync or by hand — appears here with no action.
 *
 * ⚠ ONLY WHAT DIFFERS IS STORED. An override holds a field only while it
 *   disagrees with central. Change a field back to central's value and the key is
 *   dropped, so central's later corrections to fields you have NOT changed keep
 *   flowing through. A field you HAVE changed stays yours until you reset it.
 *
 * Browser storage only, the same decision as Ink IMS (kept on 18-09-2026): no
 * shared table, and nothing here is seen by anyone else. The Excel round trip and
 * the JSON backup are the ways to move it between browsers. Because the browser is
 * the only copy, the store is written defensively:
 *
 *   PER USER       every key carries the signed-in user's id, so a second person on
 *                  the same PC neither sees nor overwrites the first one's work.
 *   LOUD FAILURES  a write the browser refuses (storage full or blocked) throws
 *                  StorageFullError, and the page says so — never "Saved".
 *   TAB-SAFE       every write re-reads what is stored and applies only its own
 *                  change on top, and a `storage` event from another tab refreshes
 *                  this one, so two open tabs cannot wipe each other's saves.
 *   LAZY           nothing is read until the page asks, so the rest of the portal
 *                  never pays for this app's storage.
 */

/**
 * The fields that can be changed here.
 *
 * `groupName`, `color` and `description` have no central column behind them at
 * all — Central Masters holds an item's group as a per-company id, and carries
 * neither a colour nor a description (MS-1). They are mine outright. The rest
 * mirror a central column and are stored only while they disagree with it.
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
 * it on render — on every reload, since it would be stored.
 */
function cleanOverride(v: unknown): MirrorOverride | null | undefined {
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
 * first bad entry; otherwise (our own storage) a bad entry is dropped, never crashes.
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

// ---- tiny external store ------------------------------------------------------

let uid: string | null = null;
let overrides: OverrideMap = {};
/** Null until the first load has recorded what already existed. */
let seen: Set<string> | null = null;
let version = 0;
const listeners = new Set<() => void>();
const notify = () => {
  version++;
  listeners.forEach((l) => l());
};

/** Another tab saved: take its copy, so this tab neither shows stale values nor writes them back. */
function onStorage(e: StorageEvent) {
  if (!uid || !e.key) return;
  if (e.key === keyFor(uid, "overrides")) {
    overrides = cleanMap(readRaw(e.key), false);
    notify();
  } else if (e.key === keyFor(uid, "seen")) {
    seen = cleanIds(readRaw(e.key)) ?? seen;
    notify();
  }
}
let listening = false;

/** Load the signed-in user's data, once per user. Silent: it runs during render. */
function ensureLoaded(forUid: string) {
  if (uid === forUid) return;
  uid = forUid;
  let ov = readRaw(keyFor(forUid, "overrides"));
  let sn = readRaw(keyFor(forUid, "seen"));
  // The first open after keys became per-user: adopt what this browser held before.
  if (ov === null && sn === null) {
    const legacyOv = readRaw(LEGACY.overrides);
    const legacySeen = readRaw(LEGACY.seen);
    if (legacyOv !== null || legacySeen !== null) {
      ov = legacyOv;
      sn = legacySeen;
      try {
        write(keyFor(forUid, "overrides"), cleanMap(ov, false));
        if (cleanIds(sn)) write(keyFor(forUid, "seen"), sn);
        window.localStorage.removeItem(LEGACY.overrides);
        window.localStorage.removeItem(LEGACY.seen);
      } catch {
        // Left where it was; the next load tries again.
      }
    }
  }
  overrides = cleanMap(ov, false);
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

export function useMirrorStore(forUid: string) {
  ensureLoaded(forUid);
  useSyncExternalStore(subscribe, () => version);
  return { overrides, seen };
}

function requireUid(): string {
  if (!uid) throw new Error("The mirror store was used before it was loaded.");
  return uid;
}

/**
 * What is stored NOW — re-read before every write, so a save from another tab since
 * this one loaded is kept rather than overwritten. Falls back to memory when nothing
 * is stored yet.
 */
function storedOverrides(): OverrideMap {
  const raw = readRaw(keyFor(requireUid(), "overrides"));
  return raw === null ? overrides : cleanMap(raw, false);
}

function commit(next: OverrideMap) {
  write(keyFor(requireUid(), "overrides"), next); // throws before memory changes
  overrides = next;
  notify();
}

const norm = (v: string | null | undefined) => (v ?? "").trim() || null;

/** The value central holds for an editable field; groupName is resolved by the caller. */
export function centralValue(item: MasterItem, key: EditableKey, centralGroupName: string | null): string | null {
  switch (key) {
    case "itemType": return item.itemType;
    case "category": return item.category;
    case "inkType": return item.inkType;
    case "groupName": return centralGroupName;
    case "code": return item.code;
    case "color": return null;
    case "description": return null;
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
 * call. ONE write for the whole batch; writing row by row would re-serialise the
 * entire map per row. Throws StorageFullError, leaving everything as it was.
 */
export function saveMany(edits: MirrorEdit[]): number {
  if (edits.length === 0) return 0;
  const next = { ...storedOverrides() };
  for (const edit of edits) {
    const row = nextOverride(edit, next[edit.item.id]);
    if (row) next[edit.item.id] = row;
    else delete next[edit.item.id];
  }
  commit(next);
  return edits.length;
}

export function resetOverride(id: string) {
  const current = storedOverrides();
  if (!current[id]) return;
  const { [id]: _gone, ...rest } = current;
  commit(rest);
}

export function resetAllOverrides() {
  commit({});
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

export function buildBackup(): string {
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

/** Replace every saved change with a checked backup's. Throws StorageFullError. */
export function replaceAllOverrides(map: OverrideMap) {
  commit({ ...map });
}
