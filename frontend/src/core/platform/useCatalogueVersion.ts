import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { REALTIME_SUBSCRIBE_STATES } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { DISPATCH_MASTERS_QK } from "@/apps/order-to-dispatch/data/dispatchFetch";
import { OCPI_MASTERS_QK } from "@/apps/ocpi/data/ocpiMasters";
import { COMPANIES_QK } from "@/apps/customer-orders/data/orderDesk";

/**
 * PF-17 — ONE realtime subscription that tells every module its copy of the
 * central masters has gone stale.
 *
 * Until this existed, a customer added in Tally took up to 30 more minutes to
 * reach an order form and NO RELOAD SHORTENED IT: the catalogue carries
 * `staleTime: 30 * 60_000` AND sits on the IndexedDB persistence allowlist, so
 * F5 restores the saved copy and React Query calls it fresh. From the user's
 * seat there was no way to force it.
 *
 * ⚠ THE 30 MINUTES IS THE FLOOR, NOT THE BUG, AND NOTHING HERE SHORTENS IT. The
 *   catalogue is ~2 MB and was split onto its own key so that saves stop
 *   dragging it. Push is the fast path; the timer stays as the safety net for a
 *   browser that was closed or asleep, because REALTIME DOES NOT REPLAY what it
 *   missed while the socket was down. Both halves are load-bearing.
 *
 * `public.mst_catalogue_version` holds a single row; statement-level triggers on
 * the six mst_* tables bump it. A Tally pull issues ~70 write statements, so ~70
 * events arrive in BURSTS over 45-70 seconds. Invalidating on each one would
 * re-download the catalogue seventy times, which is worse than not being live at
 * all — so most of this file is about collapsing that stream into one or two.
 *
 * ⚠ THIS FILE IMPORTS FROM `@/apps/*`, WHICH IS DELIBERATE. core/platform owning
 *   the fan-out is the point: one subscription, one debounce, one list of keys.
 *   `session.tsx` already reaches into `@/apps/universal`, and `apps/registry.tsx`
 *   statically imports every app, so nothing here is code-split and the imports
 *   cost no bundle weight.
 */

/**
 * The order desk's stock book, as a PREFIX.
 *
 * The real keys are `["order-desk", "items", <companyId|"all">]`, built by
 * `itemsQueryKey()` — which cannot be used here because we want every book at
 * once, not the one on screen. React Query's `partialMatchKey` compares only the
 * indices present in the FILTER, so this reaches every book and CANNOT touch
 * `["order-desk","orders"]` or `["order-desk","profile"]`, which differ at index
 * 1 and stay on their own timers. Orders are not masters.
 *
 * ⚠ A LITERAL THAT MUST TRACK `itemsQueryKey` IN orderDesk.ts. Same hazard
 *   main.tsx flags for the "dispatchMasters" persistence allowlist: rename one
 *   and the other silently stops working, and the symptom is a stale picker, not
 *   an error.
 */
const ORDER_DESK_ITEMS_PREFIX = ["order-desk", "items"] as const;

/**
 * One company's Tally stock book, as a PREFIX.
 *
 * ⚠ MUST TRACK `COMPANY_ITEMS_QK` IN dispatchFetch.ts, which builds
 *   `["dispatchCompanyItems", companyId]`. That key deliberately sits OUTSIDE
 *   DISPATCH_MASTERS_QK so a write path's `invalidateAll()` cannot drag 8,340
 *   rows behind one item mapping — read the note there before changing either.
 *   This is not that: a Tally pull moving the book is exactly the schedule that
 *   key follows, and the prefix only re-fetches whatever is actually on screen.
 */
const DISPATCH_COMPANY_ITEMS_PREFIX = ["dispatchCompanyItems"] as const;

/**
 * The Admin → Masters screen's own tables.
 *
 * ⚠ A LITERAL BECAUSE THE SCREEN HAS NO CONSTANT — Masters.tsx keys every query
 *   as `["masters", "<thing>"]` inline and invalidates the `["masters"]` root by
 *   hand. Pressing Sync now already refreshed it; a SCHEDULED sync did not, which
 *   is the gap this closes.
 */
const ADMIN_MASTERS_QK = ["masters"] as const;

/** Everything one Tally pull can invalidate. Exported so a devtool can name it. */
export const CATALOGUE_QUERY_KEYS: readonly (readonly unknown[])[] = [
  DISPATCH_MASTERS_QK, // ["dispatchMasters"]        - the ~2 MB catalogue
  DISPATCH_COMPANY_ITEMS_PREFIX, // ["dispatchCompanyItems"]   - prefix, every book
  OCPI_MASTERS_QK, // ["ocpiMasters"]            - 7,960 parties
  COMPANIES_QK, // ["order-desk","companies"]
  ORDER_DESK_ITEMS_PREFIX, // ["order-desk","items"]     - prefix, every book
  ADMIN_MASTERS_QK, // ["masters"]                - the admin screen
];

/**
 * TRAILING QUIET WINDOW. Every event resets it, so a burst of 29 upsert
 * statements collapses into one call 5 s after the burst stops.
 */
const QUIET_MS = 5_000;

/**
 * FLOOR between two actual invalidations. Signals arriving inside the cool-down
 * do not each get a call; they ride along and get ONE at the end of it.
 *
 * ⚠ NOT REDUNDANT WITH THE QUIET WINDOW. On the measured burst profile — 20 s of
 *   reads, a 9 s items burst, 15 s of reads, then parties and pairs back to back
 *   — the quiet window alone already gives two, because the 15 s gap splits them.
 *   The floor is what holds a WORSE shape in line: bursts separated by 8 s would
 *   be six invalidations without it, and six is six re-downloads of ~2 MB.
 */
const FLOOR_MS = 60_000;

/**
 * ⚠ A UNIQUE TOPIC PER EFFECT RUN, AND THIS IS NOT COSMETIC.
 *
 *   `RealtimeClient.channel(topic)` DE-DUPLICATES BY TOPIC and hands back the
 *   existing instance. If this effect re-runs while the channel is joined — Vite
 *   Fast Refresh on this file is the everyday case — the cleanup's `leave()` puts
 *   the channel into state `leaving` but does NOT remove it from the registry
 *   until the server acks. The re-run then gets that dying instance back,
 *   `subscribe()` is guarded by `isClosed()` and `leaving` is not closed so it is
 *   a SILENT NO-OP, and when the ack lands the instance is removed — leaving a
 *   live reference to a channel that will never deliver an event and will never
 *   error. A fresh topic makes the lookup miss, so a real channel is always built.
 */
let channelSeq = 0;

/**
 * Subscribe once per signed-in session and invalidate the central-master query
 * keys when a Tally pull, or a portal master write, moves them.
 *
 * Mounted in SessionProvider, which renders on EVERY route including `/` and
 * `/login` — the `authId` guard is what keeps it silent there. HomeLayout would
 * have covered `/home` alone and unmounted the moment anyone opened a module.
 *
 * ⚠ KEYED ON `authId`, A STRING — NEVER ON THE SESSION OBJECT. supabase-js hands
 *   out a NEW session object on every TOKEN_REFRESHED, roughly hourly. A
 *   `[session]` dependency would tear down and rebuild this channel every hour,
 *   and the reconnect rule below would then re-download the whole catalogue every
 *   hour for nothing.
 */
export function useCatalogueVersion(authId: string | null): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!authId) return;

    /**
     * ⚠ EVERYTHING BELOW MUST DIE WITH THE EFFECT. Sign-out calls
     *   `queryClient.clear()` and `clearPersistedCache()`; a cool-down timer that
     *   outlived this effect would fire up to 60 s into the NEXT user's session.
     *
     * ⚠ AND IT MUST STAY `invalidateQueries`, NEVER `refetchQueries` OR
     *   `prefetchQuery`. Invalidating a cleared cache matches nothing and CREATES
     *   nothing, so the sign-out race is harmless. Those two repopulate it — and
     *   the persister would then write the resurrection straight back to
     *   IndexedDB, undoing the half of sign-out that exists to stop exactly that.
     */
    let disposed = false;
    let quiet: ReturnType<typeof setTimeout> | null = null;
    let cooldown: ReturnType<typeof setTimeout> | null = null;
    let everSubscribed = false;

    /**
     * TWO TIMESTAMPS, NOT A `pending` FLAG.
     *
     * "Is there unfired work?" is exactly `lastSignalAt > lastRunAt`, and it
     * clears itself the moment we run. A separate boolean gets this wrong in one
     * specific way: a quiet timer armed by an event that arrived DURING the
     * cool-down still fires a few seconds AFTER the cool-down's invalidation and
     * sets the flag again — buying a second, wholly redundant ~2 MB re-fetch 60 s
     * later for an event the first one already covered. Reachable on a 70-second
     * sync, which happens. The comparison cannot: that event's stamp is older
     * than the run that covered it.
     *
     * Safe because the event IS the commit. A re-fetch starting at T reads a
     * snapshot including everything committed before T.
     */
    let lastRunAt = 0;
    let lastSignalAt = 0;

    const run = () => {
      lastRunAt = Date.now();
      if (disposed) return;
      if (import.meta.env.DEV) {
        console.debug("[catalogue] invalidating", CATALOGUE_QUERY_KEYS.length, "keys");
      }
      /**
       * ⚠ NOT AWAITED, AND ONE CALL PER KEY. `invalidateQueries` resolves only
       *   once the query has REFETCHED — see the long note in
       *   order-to-dispatch/store.tsx — so awaiting six of these would serialise
       *   ~2 MB plus 7,960 parties for a caller that does not exist. The `.catch`
       *   is not optional either: nobody is awaiting, so a failed background
       *   re-fetch would otherwise surface as an unhandled rejection.
       *
       * Inactive queries (OCPI's masters while you are in Order to Dispatch) are
       * only MARKED stale and cost no network; `isInvalidated` even survives into
       * IndexedDB, so a signal heard in another app is not lost by closing the tab.
       */
      for (const queryKey of CATALOGUE_QUERY_KEYS) {
        void queryClient.invalidateQueries({ queryKey }).catch(() => {});
      }
    };

    /** One event, or one reconnect. Restarts the quiet window; respects the floor. */
    const schedule = () => {
      if (disposed) return;
      lastSignalAt = Date.now();
      if (quiet !== null) clearTimeout(quiet);
      quiet = setTimeout(() => {
        quiet = null;
        if (disposed) return;
        // Already covered by an invalidation that ran after this signal arrived.
        if (lastSignalAt <= lastRunAt) return;
        const since = Date.now() - lastRunAt;
        // lastRunAt is 0 until we have ever run, so the FIRST real change is not
        // made to sit out the floor. Deliberate: the floor exists to stop seventy
        // re-fetches, not the first one.
        if (since >= FLOOR_MS) {
          run();
          return;
        }
        // Inside the cool-down. Arm it ONCE — later signals must not extend a
        // floor that is measured from the last run, they just ride along.
        if (cooldown === null) {
          cooldown = setTimeout(() => {
            cooldown = null;
            if (disposed || lastSignalAt <= lastRunAt) return;
            run();
          }, FLOOR_MS - since);
        }
      }, QUIET_MS);
    };

    const channel = supabase
      .channel(`catalogue-version:${authId}:${++channelSeq}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "mst_catalogue_version" },
        () => schedule()
      )
      .subscribe((status, err) => {
        if (disposed) return;
        if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
          /**
           * RECONNECT, NOT FIRST CONNECT.
           *
           * Realtime does not replay what was missed while the socket was down,
           * so a rejoin has to assume it lost something. But the FIRST subscribe
           * has lost nothing, and invalidating there would throw away the ~2 MB
           * catalogue that PersistQueryClientProvider had just restored from
           * IndexedDB — on every single page load.
           *
           * A rejoin genuinely re-delivers SUBSCRIBED: phoenix's `Push.resend()`
           * resets the response but KEEPS its receive hooks, so the join's `ok`
           * handler runs again. One SUBSCRIBED per join makes this boolean an
           * exact detector. Routed through schedule(), not run(), so a flapping
           * socket is capped by the same 5 s / 60 s machinery as a Tally burst.
           *
           * ⚠ NO setAuth() HERE, AND DO NOT ADD ONE. supabase-js wires realtime
           *   to the auth client itself and refreshes the token on
           *   TOKEN_REFRESHED, on socket open, and again after every successful
           *   join. Calling `realtime.setAuth(token)` by hand would make it
           *   WORSE: an explicitly passed token sets `_manuallySetToken`, which
           *   permanently ignores the auto-refresh callback. Realtime would work
           *   for exactly one token lifetime and then go quiet.
           */
          if (!everSubscribed) {
            everSubscribed = true;
            return;
          }
          schedule();
          return;
        }
        // CHANNEL_ERROR / TIMED_OUT / CLOSED are NOT triggers: invalidating while
        // the socket is down only queues a doomed fetch, and the SUBSCRIBED that
        // follows a successful rejoin is the unambiguous edge. Surfaced in dev
        // because a permanent binding mismatch would otherwise stop the catalogue
        // updating for ever, silently — which is the failure mode this whole
        // feature exists to remove.
        if (import.meta.env.DEV && status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR) {
          console.warn("[catalogue] channel error", err);
        }
      });

    return () => {
      disposed = true;
      if (quiet !== null) clearTimeout(quiet);
      if (cooldown !== null) clearTimeout(cooldown);
      quiet = null;
      cooldown = null;
      void supabase.removeChannel(channel);
    };
  }, [authId, queryClient]);
}
