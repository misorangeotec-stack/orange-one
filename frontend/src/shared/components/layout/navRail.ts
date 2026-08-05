import { useEffect } from "react";

/**
 * Lets a PAGE ask the sidebar to collapse to its icon rail while that page is open.
 *
 * WHY THIS IS NOT JUST WRITING THE RAIL SETTING
 *   The rail is a user preference stored in localStorage. A page that flipped that
 *   setting would be editing the user's choice — collapse the nav for one screen and
 *   it would stay collapsed everywhere afterwards, with no clue why. This request is
 *   TRANSIENT: nothing is persisted, and the moment the page unmounts the sidebar
 *   goes back to whatever the user had chosen.
 *
 * WHY A MODULE STORE AND NOT CONTEXT
 *   The sidebar lives in AppShell, several levels above any app's routes, so a page
 *   deep inside one cannot reach it through a provider without threading a context
 *   through every app shell. This is the same subscribe/notify shape React's own
 *   `useSyncExternalStore` expects, kept deliberately tiny.
 *
 * ⚠ A MANUAL TOGGLE ALWAYS WINS. Once the user expands or collapses the nav
 *   themselves, `overrideRail()` latches for the rest of the page load and requests
 *   are ignored — otherwise opening the next candidate would slam the nav shut again
 *   on someone who had just deliberately opened it.
 */

let requests = 0;
let overridden = false;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((fn) => fn());

/** True when some open page wants the rail AND the user has not overruled it. */
export const railRequested = () => requests > 0 && !overridden;

export function subscribeRail(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The user reached for the toggle — stop auto-collapsing for the rest of the session. */
export function overrideRail(): void {
  if (overridden) return;
  overridden = true;
  notify();
}

/**
 * Collapse the nav to a rail for as long as the calling component is mounted.
 *
 * Counted rather than boolean so two such pages overlapping during a route
 * transition cannot leave the nav stuck collapsed — the rail lifts only when the
 * last of them has gone.
 */
export function useRailWhileMounted(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    requests += 1;
    notify();
    return () => {
      requests = Math.max(0, requests - 1);
      notify();
    };
  }, [enabled]);
}
