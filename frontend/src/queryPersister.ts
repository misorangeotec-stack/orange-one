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

/**
 * Minimum gap between two writes to IndexedDB.
 *
 * Every write structured-clones the WHOLE dehydrated cache — the org's tasks,
 * the activity history, the receivables payload — off the main thread's budget.
 * React Query asks us to persist on every cache mutation, so a burst of writes
 * (ticking a location checklist, say) re-serialised all of it once per click.
 * None of these datasets need second-granularity durability: the worst case for
 * dropping the last few seconds is one cold re-fetch on the next page load.
 */
const PERSIST_THROTTLE_MS = 5_000;

/**
 * The one persister the app uses, created once and shared.
 *
 * ⚠ A SINGLETON SO SIGN-OUT CAN REACH IT. Clearing the on-disk cache means
 *   cancelling any throttled write as well as deleting the record — a bare
 *   `del()` would be undone moments later by a pending flush resurrecting the
 *   cache we had just cleared. Only the persister itself can do both, so the
 *   instance has to be reachable from outside main.tsx.
 */
let sharedPersister: Persister | null = null;

export function getPersister(): Persister {
  if (!sharedPersister) sharedPersister = createIDBPersister();
  return sharedPersister;
}

/**
 * Wipe the persisted cache — call on SIGN-OUT.
 *
 * ⚠ Until this existed nothing ever cleared it, so a signed-out browser kept the
 *   last user's data on disk for the full 24-hour max age, readable through
 *   devtools without logging in. That already covered the receivables payload and
 *   the staff directory; the dispatch catalogue would have added customer names,
 *   GSTINs, phone numbers and email addresses to the pile.
 */
export async function clearPersistedCache(): Promise<void> {
  await getPersister().removeClient();
}

export function createIDBPersister(idbKey = "orange-one-rq-cache"): Persister {
  // Trailing-edge throttle: always writes the LATEST client, never an older
  // snapshot, and never leaves the final state of a burst unwritten.
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: PersistedClient | null = null;
  let lastWriteAt = 0;

  const flush = () => {
    timer = null;
    const client = pending;
    pending = null;
    if (!client) return;
    lastWriteAt = Date.now();
    void set(idbKey, client);
  };

  return {
    persistClient: (client: PersistedClient) => {
      pending = client;
      if (timer) return; // a write is already queued; it will pick up this client
      timer = setTimeout(flush, Math.max(0, PERSIST_THROTTLE_MS - (Date.now() - lastWriteAt)));
    },
    restoreClient: async () => {
      return await get<PersistedClient>(idbKey);
    },
    removeClient: async () => {
      // Cancel any queued write, or it would resurrect the cache we just cleared.
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
      await del(idbKey);
    },
  };
}
