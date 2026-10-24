/**
 * WHOSE reports a reader may open (HRREP-1).
 *
 * This is the only place the question is answered, because it is asked in three places
 * that must never disagree: the person picker on the scorecard, the person picker on
 * the weekly review, and the Settings screen that explains the rule back to an admin.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────
 *   everyone           themselves, always, with no grant of any kind — the app is
 *                      universal for exactly this reason
 *   a head             themselves plus everyone down their reporting chain
 *   a named viewer     everyone, by an admin ticking them on Settings
 *   an admin           everyone
 *
 * "Management" is not a role this platform has — it knows admin / hod / sub_hod /
 * employee and nothing else — so a CFO or a director who heads no department would see
 * only themselves. The named-viewer list exists to answer that without inventing a role,
 * and an admin can change it without a deploy.
 *
 * ⚠ THIS IS UI SCOPING, NOT SECURITY. Every figure behind it is fetched under the
 *   reader's own RLS: `kpi_report` checks the caller itself, and the recruitment tables
 *   refuse a reader who has no business in them. Narrowing the picker keeps people out
 *   of each other's reports by design; it is not what stops them.
 */
import type { Profile } from "@/core/platform/types";
import { computeDownlineIds } from "@/core/platform/store";

export type ReportReach = "self" | "downline" | "everyone";

/** What one reader may reach. `isViewer` comes from the hr_report_viewers table. */
export function reachOf(opts: { isAdmin: boolean; isViewer: boolean; role: string }): ReportReach {
  if (opts.isAdmin || opts.isViewer) return "everyone";
  if (opts.role === "hod" || opts.role === "sub_hod") return "downline";
  return "self";
}

/**
 * The people a reader may choose between, in the order the picker shows them.
 *
 * ⚠ THE READER IS ALWAYS IN THE LIST. A head with nobody under them, a viewer whose
 *   list has not loaded, an employee — every one of them must still find themselves
 *   here, or the page opens on somebody else or on nothing at all. That is the bug this
 *   function exists to make impossible, so it is asserted at the end rather than left
 *   to each caller.
 */
export function peopleInReach(all: Profile[], me: Profile, reach: ReportReach): Profile[] {
  const byRoleThenName = (a: Profile, b: Profile) => a.name.localeCompare(b.name);

  let list: Profile[];
  if (reach === "everyone") {
    // A customer login is not staff and has no report; the reader themselves stays in
    // even if their own row is somehow flagged, so the page always has a subject.
    list = all.filter((p) => !p.isExternal || p.id === me.id);
  } else if (reach === "downline") {
    const ids = new Set([me.id, ...computeDownlineIds(all, me.id)]);
    list = all.filter((p) => ids.has(p.id));
  } else {
    list = all.filter((p) => p.id === me.id);
  }

  if (!list.some((p) => p.id === me.id)) list = [...list, me];
  return list.sort(byRoleThenName);
}

/** One line of plain English for the reader, so the picker never looks broken. */
export function reachNote(reach: ReportReach, n: number): string {
  if (reach === "everyone") return `You can open anyone's report — ${n} people.`;
  if (reach === "downline") {
    return n <= 1
      ? "You can open your own report. Nobody reports to you in the hub, so there is no one else to choose."
      : `You can open your own report and those of the ${n - 1} people who report to you.`;
  }
  return "You can open your own report. Ask an admin if you need to see somebody else's.";
}
