/**
 * Decides WHEN each work source is allowed to fetch.
 *
 * The home screen aggregates up to seven modules. Letting them all fetch on mount
 * would fire seven multi-table payloads at once, block the main thread parsing
 * them in parallel, and make the one screen everybody opens first the slowest one
 * in the portal. So activation is staged:
 *
 *   1. ALREADY CACHED  → active immediately. Warm navigation from another app, or
 *      a persisted `taskData` from last visit, costs nothing and must not be
 *      artificially delayed.
 *   2. TIER 1          → active on mount. Small, single-table sources.
 *   3. TIER 2          → activated after first paint, at most MAX_IN_FLIGHT at a
 *      time: as each settles, the next in line starts.
 *
 *      It used to be ONE at a time. That was right for seven sources; at seventeen
 *      (03-10-2026) an admin's screen waited for the SUM of every FMS's load,
 *      one after another, and "loading takes too long" was the result. A few in
 *      parallel keeps the network and the main thread from being flooded while
 *      cutting the wait to roughly the slowest few rather than all of them added.
 *
 * Access gating happens before this (a provider the user can't open is never
 * rendered at all), which for most staff removes four or five sources outright.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { MyWorkProvider } from "./types";

/** Fire `cb` when the browser is next idle; falls back where rIC is missing. */
function onIdle(cb: () => void): () => void {
  const w = window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (h: number) => void;
  };
  if (typeof w.requestIdleCallback === "function") {
    const h = w.requestIdleCallback(cb, { timeout: 1200 });
    return () => w.cancelIdleCallback?.(h);
  }
  const t = window.setTimeout(cb, 0);
  return () => window.clearTimeout(t);
}

export interface Activation {
  isActive: (key: string) => boolean;
  /** A provider calls this once its own load settles, releasing the next in line. */
  notifySettled: (key: string) => void;
}

/** Heavy (tier-2) sources allowed to load at the same time. */
const MAX_IN_FLIGHT = 4;

export function useDeferredActivation(providers: MyWorkProvider[]): Activation {
  const queryClient = useQueryClient();

  // Warm sources start active — the point is to not delay what costs nothing.
  const initiallyActive = useMemo(() => {
    const set = new Set<string>();
    for (const p of providers) {
      if (p.tier === 1) set.add(p.key);
    }
    // A source whose data react-query already holds (in memory, or rehydrated from
    // IndexedDB) is free to read, whatever its tier.
    for (const p of providers) {
      const cached = queryClient
        .getQueryCache()
        .getAll()
        .some((q) => q.queryKey[0] === cacheRootOf(p.key) && q.state.status === "success");
      if (cached) set.add(p.key);
    }
    return set;
    // Deliberately mount-only: this is a starting position, not a subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [active, setActive] = useState<Set<string>>(initiallyActive);
  const settled = useRef<Set<string>>(new Set());

  // The tier-2 queue, in registry order, minus anything already active.
  const queue = useMemo(
    () => providers.filter((p) => p.tier === 2 && !initiallyActive.has(p.key)).map((p) => p.key),
    [providers, initiallyActive]
  );
  // How many of the queue have been started, and how many of those have settled.
  // In flight = started − done; it never exceeds MAX_IN_FLIGHT.
  const [started, setStarted] = useState(0);
  const [done, setDone] = useState(0);

  useEffect(() => {
    const upTo = Math.min(queue.length, done + MAX_IN_FLIGHT);
    if (started >= upTo) return;
    // After paint, not during it.
    return onIdle(() => {
      const batch = queue.slice(started, upTo);
      setActive((prev) => {
        const next = new Set(prev);
        batch.forEach((k) => next.add(k));
        return next;
      });
      setStarted(upTo);
    });
  }, [started, done, queue]);

  return {
    isActive: (key: string) => active.has(key),
    notifySettled: (key: string) => {
      if (settled.current.has(key)) return;
      settled.current.add(key);
      // Frees a slot for the next heavy source in line.
      if (queue.includes(key)) setDone((d) => d + 1);
    },
  };
}

/**
 * The react-query key root each provider reads, for the warm-cache check.
 * Kept beside the providers rather than on the contract because it is an
 * optimisation detail — a wrong entry costs a slightly later fetch, never
 * incorrect data.
 */
function cacheRootOf(providerKey: string): string {
  switch (providerKey) {
    case "tasks":
      return "taskData";
    case "followups":
      return "receivablesFollowups";
    case "purchase":
      return "procurementData";
    case "import":
      return "importData";
    case "hr":
      return "hrRecruitmentData";
    case "hr-exit":
      return "hrExitData";
    case "office-supplies":
      return "officeSuppliesData";
    // The rest were missing, so their warm cache was never noticed and they always
    // queued behind the others. Each root is that app's `*_QK` in data/*Fetch.ts.
    case "sampling":
      return "samplingData";
    case "production-entry":
      return "productionData";
    case "order-to-dispatch":
      return "orderToDispatchData";
    case "asset-maintenance":
      return "assetMaintenanceData";
    case "travel-desk":
      return "travelDeskData";
    case "learning-development":
      return "learningDevelopmentData";
    case "help-desk":
      return "helpDeskData";
    case "customer-onboarding":
      return "customerOnboarding";
    case "complaint":
      return "complaintData";
    case "ocpi":
      return "ocpiData";
    default:
      return providerKey;
  }
}
