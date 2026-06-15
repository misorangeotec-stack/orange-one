/**
 * queryPersister.ts — IndexedDB-backed persister for the React Query cache.
 *
 * Why: the receivables dataset (`["appData", fySuffix]`) is fetched whole on the
 * first app load and kept in React Query's *in-memory* cache, so navigating
 * inside one tab is instant. But a brand-new browser tab is a fresh JS context
 * with an empty cache, so it cold-fetches the entire dataset again (the
 * "Loading customer data…" screen). Opening a customer in a new tab from the
 * Risk Register hit exactly this.
 *
 * Persisting the cache to IndexedDB lets a new tab — and full page reloads —
 * hydrate instantly from what an earlier tab already loaded, then revalidate in
 * the background if the data is stale. IndexedDB (not localStorage) because the
 * dataset can exceed localStorage's ~5MB quota.
 *
 * Note: this only persists the *raw* receivables payload, which already reaches
 * every signed-in browser today (per-salesperson scoping is applied downstream
 * in `useAppData`, UI-level only) — so it doesn't change the data-exposure
 * posture, it just avoids re-downloading.
 */
import { get, set, del } from "idb-keyval";
import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";

/** Bump when the persisted shape changes, to invalidate stale on-disk caches. */
export const PERSIST_BUSTER = "v1";

/** How long a persisted cache is allowed to be restored before it's discarded. */
export const PERSIST_MAX_AGE = 24 * 60 * 60 * 1000; // 24h

export function createIDBPersister(idbKey = "orange-one-rq-cache"): Persister {
  return {
    persistClient: async (client: PersistedClient) => {
      await set(idbKey, client);
    },
    restoreClient: async () => {
      return await get<PersistedClient>(idbKey);
    },
    removeClient: async () => {
      await del(idbKey);
    },
  };
}
