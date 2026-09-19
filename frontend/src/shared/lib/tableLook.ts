/**
 * PF-20 — the table look: every column drags wider or narrower, and every row is one clean line.
 *
 * ── Rolled out ONE MODULE AT A TIME ──
 *
 * The user checks each module on localhost, then live, before the next is switched on, so the
 * look is gated here rather than turned on everywhere at once. `TABLE_LOOK_ON` is the rollout's
 * progress bar: adding "procurement" can change nothing in Dispatch, because every table asks
 * THIS list, keyed by the module that owns the current URL.
 *
 * A table in a module that is not listed renders exactly as it did before PF-20 — same markup,
 * same widths. That is what makes the list safe to grow one id at a time.
 *
 * "core" stands for the screens no module owns — the launcher, Admin, My Account, the
 * announcements page — where `currentAppId` returns null.
 *
 * ⚠ Imported only by table components. Never import this from a pure `shared/lib` file: the Edge
 *   Function bundles (work-snapshot, fms-ranking, kpi-facts) pull those in and refuse React.
 */

import { useLocation } from "react-router-dom";
import { currentAppId } from "@/apps/currentApp";

/** Modules whose tables have the look. The last phase of PF-20 deletes this list. */
export const TABLE_LOOK_ON: readonly string[] = ["kra-kpi"];

/** Whether the tables on this URL have the look. */
export function tableLookOn(pathname: string): boolean {
  return TABLE_LOOK_ON.includes(currentAppId(pathname) ?? "core");
}

/**
 * The switch as a hook. `resizable` (drag handles) and `oneLine` (one line per row, long text
 * cut) move together today; they are two flags because the Outstanding Dashboard keeps its own
 * tighter rows when its turn comes.
 */
export function useTableLook(): { resizable: boolean; oneLine: boolean } {
  const on = tableLookOn(useLocation().pathname);
  return { resizable: on, oneLine: on };
}

/** Sizes, in content px (padding excluded). */
export const FIT = {
  /** Where long text is cut with "…" until someone drags the column wider (the user, 19-09-2026). */
  CUT: 300,
  /** The narrowest a drag goes — still room for a filter dropdown's "All". */
  MIN: 80,
  MAX: 900,
  /** One arrow-key press on a focused edge. */
  STEP: 20,
  /** Pointer travel before a press on the edge counts as a drag, so a plain click saves nothing. */
  SLOP: 3,
} as const;

/**
 * The URL with its ids folded, so every order shares one set of widths: `/order-to-dispatch/orders/9f3c…`
 * → `/order-to-dispatch/orders/:id`. Every route segment in the app is lowercase kebab-case with no
 * digits, so anything else — a uuid, a number, an encoded customer name — is an id.
 */
export function normalisePath(pathname: string): string {
  const parts = pathname.replace(/\/+$/, "").split("/");
  return parts.map((s) => (s === "" || /^[a-z]+(-[a-z]+)*$/.test(s) ? s : ":id")).join("/") || "/";
}

/** FNV-1a, base 36 — short and stable, for keying on a column set. */
function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * The automatic key a table's widths are remembered under: which kind of table, on which screen,
 * with which columns. The screen keeps one stage queue's widths apart from the next stage's (one
 * component, five routes); the column set keeps two tables on one screen apart. Pass a table's
 * own `resizeKey` where two tables on one screen have the very same columns.
 */
export function widthsKey(kind: "qt" | "mc" | "tb", pathname: string, ids: readonly string[]): string {
  return `${kind}:${normalisePath(pathname)}#${hash([...ids].sort().join("|"))}`;
}
