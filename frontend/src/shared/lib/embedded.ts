/**
 * My Control Center's work panel — the shared contract between the page and the
 * frame inside it.
 *
 * The panel (core/workspace/WorkPanel.tsx) shows an FMS page in an iframe so a
 * reviewer can approve, reassign or review without leaving the home screen. The
 * page inside is the REAL page — same store, same buttons, same permission checks,
 * same RPCs — so nothing about an action can drift between the panel and the FMS.
 * All it drops is the chrome: the sidebar, the topbar and the announcement strip.
 *
 * ── WHY IT OPENS FAST ─────────────────────────────────────────────────────────
 * A fresh iframe per click booted the whole app every time — parse the bundle,
 * restore the session, load the directory, then fetch the FMS's whole dataset —
 * which took seconds. Now:
 *
 *  1. ONE frame, started in the background the first time the reader moves toward
 *     the work list, and kept for the life of the tab. A click only changes its
 *     route (postMessage), so the boot is paid once, before anybody clicks.
 *  2. THE FRAME STARTS FROM A COPY OF THE PAGE'S CACHE (`seedFromParent`). My
 *     Control Center has already fetched every FMS dataset it lists, under the
 *     very query keys the FMS stores use, so the page inside opens on data that
 *     is already there. It is re-seeded on every open, so it is never older than
 *     the list behind it.
 *  3. WHAT THE FRAME FETCHES, THE PAGE REFETCHES. When a query in the frame lands
 *     new data (an approval, a reassign, a refresh), the frame names its key and
 *     the page invalidates that key — the list behind the panel updates by itself.
 *
 * ⚠ A COPY, NOT THE SAME CLIENT. Sharing one QueryClient across the two windows
 *   was tried first and is faster still, but it leaves the frame's query functions
 *   and observers inside the page's cache: reload the frame (its error screen has a
 *   Reload button) and a later refetch in the page calls into a dead window and can
 *   hang. A copy holds only data, so nothing the frame does can break the page.
 *
 * ⚠ SAME BUILD ONLY. A tab opened before a deploy keeps the old code; the frame,
 *   loaded later, gets the new. Seeding new code with old-shaped data could crash
 *   it, so the copy is skipped when the two builds differ (`BUILD_ID`) — the frame
 *   then simply fetches its own.
 *
 * Decided once per page load, from the frame's name rather than a URL flag: the
 * app navigates inside the panel, and a query flag would be lost on the first link.
 */
import { dehydrate, hydrate, type QueryClient } from "@tanstack/react-query";

export const MCC_FRAME_NAME = "orangeone-mcc-panel";
/** The frame's resting route: renders nothing, so no FMS stays mounted when closed. */
export const MCC_IDLE_PATH = "/mcc-frame";

/** Page → frame. */
export type ToFrame = { type: "mcc:navigate"; to: string };
/** Frame → page. */
export type FromFrame =
  | { type: "mcc:ready" }
  | { type: "mcc:navigated"; to: string }
  /** A query in the frame landed new data — the page should refetch this key. */
  | { type: "mcc:changed"; queryKey: unknown[] }
  /** Esc pressed inside the frame. */
  | { type: "mcc:close" };

export const isEmbedded: boolean = (() => {
  try {
    return window.self !== window.top && window.name === MCC_FRAME_NAME;
  } catch {
    // A cross-origin parent throws on access — that is not our panel.
    return false;
  }
})();

const CLIENT_KEY = "__orangeOneQueryClient";
const BUILD_KEY = "__orangeOneBuild";

/**
 * Which build this window is running. In production this module is bundled into
 * a content-hashed chunk, so its URL changes with every deploy.
 */
export const BUILD_ID: string = import.meta.url;

/** The top window publishes its client so the panel frame can copy from it. */
export function publishQueryClient(client: QueryClient): void {
  const w = window as unknown as Record<string, unknown>;
  w[CLIENT_KEY] = client;
  w[BUILD_KEY] = BUILD_ID;
}

/** The page's client, when this is the panel frame AND both run the same build. */
export function parentQueryClient(): QueryClient | null {
  if (!isEmbedded) return null;
  try {
    const p = window.parent as unknown as Record<string, unknown>;
    if (p[BUILD_KEY] !== BUILD_ID) return null;
    return (p[CLIENT_KEY] as QueryClient) ?? null;
  } catch {
    return null;
  }
}

/**
 * Copy the page's loaded data into the frame's own client. Data only — no query
 * functions, no observers cross the boundary. `hydrate` never overwrites a query
 * the frame holds newer data for.
 */
export function seedFromParent(client: QueryClient): void {
  const parent = parentQueryClient();
  if (!parent) return;
  try {
    hydrate(client, dehydrate(parent, { shouldDehydrateQuery: (q) => q.state.status === "success" }));
  } catch {
    /* a copy is an optimisation — the frame fetches for itself without it */
  }
}
