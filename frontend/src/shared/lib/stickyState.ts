import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

/**
 * In-memory sticky UI state. Keeps a list page's filters / sort / page / search
 * alive across SPA navigation (click a row → read the detail → come Back), so the
 * list you return to is the list you left. This is what lets rows open in the SAME
 * tab: before it, leaving the page destroyed every filter, and opening a new tab
 * was the only way to keep them.
 *
 * Deliberately module-level and NOT sessionStorage/localStorage: a hard refresh or
 * a new tab is a clean slate, which is the intended escape hatch.
 *
 * Each list page owns a NAMESPACE. A namespace also records the "seed" that
 * produced its snapshot — the deep-link signature of the URL it was created under.
 * Arriving with a DIFFERENT seed (e.g. drilling in from a Weekly Scorecard number)
 * discards the snapshot, so an explicit link always beats stale state.
 */
interface Scope {
  seed: string;
  values: Map<string, unknown>;
}

/** Bounded so a long session can't grow this without limit; Map is insertion-ordered. */
const MAX_SCOPES = 40;
const store = new Map<string, Scope>();

/** Drop the snapshot if this arrival asks for something different than the last one. */
function reseed(ns: string, seed: string): void {
  const cur = store.get(ns);
  if (cur && cur.seed === seed) return; // same ask → keep the snapshot
  store.set(ns, { seed, values: new Map() }); // new ask → start clean
  if (store.size > MAX_SCOPES) {
    const oldest = store.keys().next();
    if (!oldest.done) store.delete(oldest.value);
  }
}

/**
 * Wipe everything. MUST be called on sign-out: signing out is an SPA navigate, not
 * a page reload, so without this the next user on a shared machine would inherit
 * the previous user's filters and search text.
 */
export function clearAllSticky(): void {
  store.clear();
}

export interface StickyScope {
  /** null = sticky disabled; useStickyState degrades to a plain useState. */
  readonly ns: string | null;
}

/** A scope that persists nothing — for components used outside a sticky page. */
export const NO_STICKY: StickyScope = { ns: null };

/**
 * Open a sticky namespace for this page. MUST be called before any useStickyState
 * that uses it, in the same component: the seed check runs during render, and hook
 * order is what guarantees a discarded snapshot is gone before the state below it
 * initialises.
 *
 * `seed` is evaluated on MOUNT only, matching how these pages already seed
 * themselves from `initialFilters`. A seed change without a remount is ignored.
 */
export function useStickyScope(ns: string, seed = ""): StickyScope {
  const done = useRef(false);
  if (!done.current) {
    done.current = true;
    reseed(ns, seed); // ref-guarded, and idempotent anyway, so StrictMode's double render is safe
  }
  return useMemo(() => ({ ns }), [ns]);
}

/**
 * Drop-in replacement for useState whose value survives leaving and re-entering the
 * page within the same tab. Same signature, and it returns React's own setter, so
 * functional updates and identity stability are unchanged.
 *
 * Keys must be unique within a namespace (a page and a shared child that share one
 * scope must not both use "sort"). There is no compile-time check for this.
 */
export function useStickyState<T>(
  scope: StickyScope,
  key: string,
  initial: T | (() => T)
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (scope.ns) {
      const hit = store.get(scope.ns)?.values.get(key);
      if (hit !== undefined) return hit as T;
    }
    return typeof initial === "function" ? (initial as () => T)() : initial;
  });

  // Mirror on commit rather than wrapping the setter: keeps the setter React's own.
  useEffect(() => {
    if (scope.ns) store.get(scope.ns)?.values.set(key, value);
  }, [scope.ns, key, value]);

  return [value, setValue];
}
