import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useLocation } from "react-router-dom";

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
 */
const MAX_ENTRIES = 300;
const store = new Map<string, unknown>();

export function clearAllBackState(): void {
  store.clear();
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
  const id = `${location.key}|${location.pathname}|${key}`;

  const [value, setValue] = useState<T>(() => {
    if (store.has(id)) return store.get(id) as T;
    return typeof initial === "function" ? (initial as () => T)() : initial;
  });

  useEffect(() => {
    save(id, value);
  }, [id, value]);

  return [value, setValue];
}
