import { useSyncExternalStore } from "react";
import type { ItemType, MasterItem } from "@/core/platform/liveMasters";

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
 * Browser storage only, the same decision as Ink IMS: no shared table, and
 * nothing here is seen by anyone else. The Excel round trip and the JSON backup
 * are the ways to move it between browsers.
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

const OVERRIDES_KEY = "bushra-central-master:overrides:v1";
const SEEN_KEY = "bushra-central-master:seen:v1";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or blocked storage: the in-memory copy still holds the edit for this session.
  }
}

// ---- tiny external store ----------------------------------------------------

let overrides: OverrideMap = readJson<OverrideMap>(OVERRIDES_KEY, {});
/** Null until the first load has recorded what already existed. */
let seen: Set<string> | null = (() => {
  const list = readJson<string[] | null>(SEEN_KEY, null);
  return list ? new Set(list) : null;
})();
let version = 0;
const listeners = new Set<() => void>();

/**
 * ⚠ WRITES ARE COALESCED. An Excel import saves row by row through MasterCrud's
 *   onSubmit; serialising the whole map on each of thousands of rows would be
 *   quadratic. The in-memory map is updated at once, disk and listeners once the
 *   burst is over.
 */
let flushTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleFlush() {
  version++;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    writeJson(OVERRIDES_KEY, overrides);
    if (seen) writeJson(SEEN_KEY, [...seen]);
    listeners.forEach((l) => l());
  }, 0);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useMirrorStore() {
  useSyncExternalStore(subscribe, () => version);
  return { overrides, seen };
}

const norm = (v: string | null | undefined) => (v ?? "").trim() || null;

/** The value central holds for an editable field; groupName is resolved by the caller. */
function centralValue(item: MasterItem, key: EditableKey, centralGroupName: string | null): string | null {
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
  active?: boolean;
}

/** What one row's override becomes, given the edits over it. Nothing is written here. */
function nextOverride({ item, centralGroupName, values, active }: MirrorEdit): MirrorOverride | null {
  const current = overrides[item.id] ?? {};
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
  const wantActive = active ?? current.active ?? item.active;
  if (wantActive !== item.active) next.active = wantActive;

  return Object.keys(next).length === 0 ? null : { ...next, updatedAt: new Date().toISOString() };
}

/** Save one row. */
export function saveOverride(
  item: MasterItem,
  centralGroupName: string | null,
  values: Partial<Record<EditableKey, string>>,
  active?: boolean,
) {
  saveMany([{ item, centralGroupName, values, active }]);
}

/**
 * Save many rows at once — what the grid's single Save button calls.
 *
 * ⚠ ONE FLUSH FOR THE WHOLE BATCH. Writing row by row would re-serialise the
 *   entire map per row, which is quadratic on a master this size.
 */
export function saveMany(edits: MirrorEdit[]): number {
  if (edits.length === 0) return 0;
  const next = { ...overrides };
  for (const edit of edits) {
    const row = nextOverride(edit);
    if (row) next[edit.item.id] = row;
    else delete next[edit.item.id];
  }
  overrides = next;
  scheduleFlush();
  return edits.length;
}

export function resetOverride(id: string) {
  if (!overrides[id]) return;
  const { [id]: _gone, ...rest } = overrides;
  overrides = rest;
  scheduleFlush();
}

export function resetAllOverrides() {
  overrides = {};
  scheduleFlush();
}

/**
 * Record the ids central holds right now. The very first load marks everything
 * as seen — otherwise all 14,000 items would open flagged "New from central".
 */
export function noteCentralIds(ids: string[]) {
  if (seen === null) {
    seen = new Set(ids);
    scheduleFlush();
  }
}

export function markAllSeen(ids: string[]) {
  seen = new Set(ids);
  scheduleFlush();
}

// ---- JSON backup ------------------------------------------------------------

export function buildBackup(): string {
  return JSON.stringify(
    { kind: "bushra-central-master-backup", version: 1, savedAt: new Date().toISOString(), overrides },
    null,
    2,
  );
}

/** Replaces every override with the file's. Returns how many items it carried. */
export function applyBackup(text: string): number {
  const parsed = JSON.parse(text) as { kind?: string; overrides?: OverrideMap };
  if (parsed?.kind !== "bushra-central-master-backup" || typeof parsed.overrides !== "object" || !parsed.overrides) {
    throw new Error("This is not a Bushra Central Master backup file.");
  }
  overrides = { ...parsed.overrides };
  scheduleFlush();
  return Object.keys(overrides).length;
}
