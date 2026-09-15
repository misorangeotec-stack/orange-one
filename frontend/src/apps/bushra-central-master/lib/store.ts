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

/** The fields that can be changed here. `groupName` and `color` have no central column to write to. */
export interface MirrorOverride {
  itemType?: ItemType | null;
  category?: string | null;
  inkType?: string | null;
  groupName?: string | null;
  color?: string | null;
  note?: string | null;
  active?: boolean;
  updatedAt?: string;
}

export type OverrideMap = Record<string, MirrorOverride>;

export const EDITABLE_KEYS = ["itemType", "category", "inkType", "groupName", "color", "note"] as const;
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
    case "color": return null;
    case "note": return null;
  }
}

/** Save the form's values, keeping only what differs from central. */
export function saveOverride(
  item: MasterItem,
  centralGroupName: string | null,
  values: Partial<Record<EditableKey, string>>,
  active: boolean,
) {
  const next: MirrorOverride = {};
  for (const key of EDITABLE_KEYS) {
    if (!(key in values)) {
      if (overrides[item.id]?.[key] !== undefined) (next as Record<string, unknown>)[key] = overrides[item.id][key];
      continue;
    }
    const mine = norm(values[key]);
    if (mine !== norm(centralValue(item, key, centralGroupName))) (next as Record<string, unknown>)[key] = mine;
  }
  if (active !== item.active) next.active = active;

  if (Object.keys(next).length === 0) delete overrides[item.id];
  else overrides[item.id] = { ...next, updatedAt: new Date().toISOString() };
  overrides = { ...overrides };
  scheduleFlush();
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
