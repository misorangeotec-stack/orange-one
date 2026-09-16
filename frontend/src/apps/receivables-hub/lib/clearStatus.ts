import { useMemo } from "react";
import { useSession } from "@/core/platform/session";
import { useHubMenuAccess } from "@hub/lib/menus";

/**
 * "Cleared" — the settled-case status shared by the hand-kept masters (RC-12).
 *
 * A Red Mark is CLEARED when the case is closed: the customer stops counting as red-marked
 * everywhere, and the record stays with who closed it, when and why. It is not a delete, and it is
 * not `checked` (which means "a steward verified this row" — see musterApi.RedMarkRow).
 *
 * ── Why this is a module and not three copies ──
 * RC-13 (disputed bills) was specced to share every one of these decisions: the default view, the
 * three-way toggle, the required note, and who may clear. Implementing them twice is how the two
 * screens end up behaving differently — so the rule, the view vocabulary and the wording live here,
 * and both screens import them. The server mirrors the same rule in supabase/functions/muster-write
 * (authorizeClear), which is the one that actually decides.
 */

/** The four columns every clearable master carries. */
export interface ClearFields {
  cleared: boolean;
  cleared_at: string | null;
  cleared_by: string | null;
  /** ⚠ Survives a reopen — it then describes the LAST clearing. Read it with `cleared`, not alone. */
  clear_note: string | null;
}

/**
 * Which cases a screen is showing.
 *
 * ⚠ THE DEFAULT IS "uncleared", EVERYWHERE. The client asked for it and it is the honest default:
 *   a master that opens on every case ever closed buries the ones still open, which is the only
 *   reason anybody opens these screens.
 */
export type ClearView = "uncleared" | "cleared" | "all";

export const CLEAR_VIEW_DEFAULT: ClearView = "uncleared";

/** Toggle options, in display order. `label` is what the button says. */
export const CLEAR_VIEWS: { value: ClearView; label: string }[] = [
  { value: "uncleared", label: "Uncleared" },
  { value: "cleared", label: "Cleared" },
  { value: "all", label: "All" },
];

export function matchesClearView(row: Pick<ClearFields, "cleared">, view: ClearView): boolean {
  if (view === "all") return true;
  return view === "cleared" ? row.cleared === true : row.cleared !== true;
}

/** Counts for the toggle's chips, so a reader can see what the other views hold before switching. */
export function countByClearView<T extends Pick<ClearFields, "cleared">>(
  rows: T[],
): Record<ClearView, number> {
  let cleared = 0;
  for (const r of rows) if (r.cleared === true) cleared++;
  return { cleared, uncleared: rows.length - cleared, all: rows.length };
}

/** dd-mm-yyyy from an ISO/timestamptz string; "" when unparseable (never "Invalid Date"). */
function dmy(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
}

/**
 * One line describing the row's clear status, for a tooltip or a cell.
 *
 * A reopened row says so and still names the last clearing: "how it ended, and that it came back"
 * is the history these masters exist to hold, and hiding half of it would make a reopened case look
 * like one that was never closed.
 */
export function describeClear(row: ClearFields): string {
  const when = dmy(row.cleared_at);
  const who = row.cleared_by ?? "";
  const note = (row.clear_note ?? "").trim();
  if (row.cleared) {
    const head = `Cleared${when ? ` on ${when}` : ""}${who ? ` by ${who}` : ""}`;
    return note ? `${head} — ${note}` : head;
  }
  if (!when && !who && !note) return "Not cleared";
  const head = `Not cleared. Last cleared${when ? ` on ${when}` : ""}${who ? ` by ${who}` : ""}`;
  return note ? `${head} — ${note}, then reopened` : `${head}, then reopened`;
}

/**
 * May the signed-in user clear/reopen a case on a customer owned by `collectionTeam`?
 *
 * The rule, decided 03-09-2026 and enforced by the server:
 *   an admin, or a Settings full-access user, on anyone —
 *   or a collector whose own collection teams contain that customer's team.
 *
 * ⚠ IT IS A DRAWING DECISION ONLY. The server re-derives all of this with the service role
 *   (muster-write → authorizeClear); this exists so a button is not offered where the write would
 *   be refused. Never treat it as the access control.
 *
 * ⚠ `canEdit` IS A CEILING. A view-only grant on the module reads every screen and has no buttons,
 *   and the server refuses those callers too.
 *
 * ⚠ AN UNSET TEAM ("") IS NOBODY'S, NOT EVERYBODY'S. Matching is exact and case-sensitive, like
 *   every other scope here (see lib/scopeParties.ts): a near-miss must refuse, never pass.
 */
export function useCanClear(): (collectionTeam: string | null | undefined) => boolean {
  const { isAdmin, user } = useSession();
  const { hasFullAccess, canEdit } = useHubMenuAccess();
  const settingsFull = hasFullAccess("settings");
  const teams = user?.receivablesCollectionTeams ?? [];

  return useMemo(() => {
    const mine = new Set(teams);
    return (collectionTeam: string | null | undefined) => {
      if (!canEdit) return false;
      if (isAdmin || settingsFull) return true;
      const team = (collectionTeam ?? "").trim();
      return team !== "" && mine.has(team);
    };
    // `teams` is a fresh array from the `?? []` fallback each render, so key on its contents.
  }, [isAdmin, settingsFull, canEdit, JSON.stringify(teams)]);
}
