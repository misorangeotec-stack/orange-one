/**
 * Remembers the exact URL (path + query) a list was last viewed at, keyed by the
 * list's route. A detail page's "Back to <list>" link resolves through this, so
 * Back returns you to the list you actually left.
 *
 * This is load-bearing for sticky filters, not a nicety. Sticky snapshots are keyed
 * on the deep-link signature of the URL that created them, so a Back link to the
 * BARE route would flip the signature (e.g. "status=completed" → "") and discard
 * the snapshot — losing filters the user set by hand after arriving from a
 * scorecard drill-down. Returning to the remembered href keeps the signature
 * matched and the snapshot restores.
 *
 * Falls back to the bare route when the list was never visited in this tab — which
 * is exactly the ctrl-clicked-into-a-new-tab case.
 */
const lastHref = new Map<string, string>();

export function rememberReturnTo(route: string, href: string): void {
  lastHref.set(route, href);
}

export function returnToFor(route: string): string {
  return lastHref.get(route) ?? route;
}

/** Wipe everything. Call on sign-out, alongside clearAllSticky. */
export function clearAllReturnTo(): void {
  lastHref.clear();
}
