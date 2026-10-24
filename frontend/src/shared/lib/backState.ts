import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/**
 * State that comes back with the browser's Back button.
 *
 * Search a list, open a row, press Back: the list used to remount empty, so it
 * looked like Back had dropped you on the FMS (or My Control Center) home rather
 * than on the search you left. A value held here is saved against the exact
 * HISTORY ENTRY it was typed on (react-router's `location.key`), so:
 *
 *   - Back / Forward onto that entry   → the search, filters and page come back;
 *   - opening the page fresh (menu, link, a new visit) → a new entry, a clean list.
 *
 * That is the difference from stickyState, which restores on ANY return to a page.
 *
 * In memory, like stickyState: a hard refresh or a new tab is a clean slate.
 * Wiped on sign-out (clearAllBackState) so the next user on a shared machine does
 * not inherit the last one's search text.
 *
 * A list that rewrites its own URL with `replace` (a tab in ?view=) gets a NEW
 * location key for the same history entry, so the value is re-saved whenever the
 * key changes, not only when the value does.
 *
 * ⚠ RESTORES ONLY ON ARRIVAL BY BACK / FORWARD, and only the first time each value
 *   mounts on that arrival. Several screens remount a table on purpose when you
 *   switch tabs (`<QueueTable key={tab}>`, Radix tab panels) "so a filter set on one
 *   list does not silently narrow the next" — and two tabs with the same columns
 *   share a key here. Any mount that is not that first one after Back starts clean,
 *   exactly as it did before this file existed.
 */
const MAX_ENTRIES = 300;
const store = new Map<string, unknown>();
/** Per arrival (location object), the values that have already been handed back once. */
const restored = new WeakMap<object, Set<string>>();

export function clearAllBackState(): void {
  store.clear();
  lastOpened.clear();
}

function save(id: string, value: unknown): void {
  store.delete(id); // re-insert so the Map's order is most-recently-written last
  store.set(id, value);
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
}

/**
 * Drop-in replacement for useState. `key` must be unique among the back-state
 * values on one page (two search boxes on one screen need two keys).
 */
export function useBackState<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const location = useLocation();
  const navType = useNavigationType();
  const id = `${location.key}|${location.pathname}|${key}`;
  // The arrival this value first mounted on. React Router hands out a new location
  // object on every navigation, so the object itself identifies one arrival.
  const mountedOn = useRef(location);

  const [value, setValue] = useState<T>(() => {
    if (navType === "POP" && store.has(id) && !restored.get(location)?.has(id)) return store.get(id) as T;
    return typeof initial === "function" ? (initial as () => T)() : initial;
  });

  // Marked after commit (not in the initialiser, which StrictMode runs twice), so a
  // later remount on the same arrival — a tab switch — no longer restores.
  useEffect(() => {
    const at = mountedOn.current;
    let done = restored.get(at);
    if (!done) restored.set(at, (done = new Set()));
    done.add(`${at.key}|${at.pathname}|${key}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    save(id, value);
  }, [id, value]);

  return [value, setValue];
}

/**
 * The row you last opened in a list, per list. That row stays highlighted when
 * you come back, so you can see where you were — until you open another one.
 *
 * Keyed by the LIST, not by the history entry: it is a "you were here" marker, so
 * it stays even when you reach the list again from the menu. Same lifetime as the
 * rest of this file — in memory, wiped on sign-out.
 */
const lastOpened = new Map<string, string>();

export function useLastOpened(listKey: string): [string | null, (rowKey: string) => void] {
  const [value, setValue] = useState<string | null>(() => lastOpened.get(listKey) ?? null);
  const mark = (rowKey: string) => {
    lastOpened.set(listKey, rowKey);
    setValue(rowKey);
  };
  return [value, mark];
}

/** Classes for the highlighted row: a soft orange fill and an orange bar on its left edge. */
export const LAST_OPENED_ROW = "!bg-orange-soft [&>td:first-child]:shadow-[inset_3px_0_0_0_#FF6A1F]";
