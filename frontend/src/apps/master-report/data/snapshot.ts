/**
 * The Master Report's one and only data call.
 *
 * WHY THIS IS AN RPC AND NOT A SET OF CLIENT-SIDE QUERIES
 *   The FMS Control Center answers "what is due today" by re-running each app's
 *   own fetch in the browser — nine apps, ~25 table reads each — because its
 *   counts must match those apps' queue predicates exactly.
 *
 *   This report asks a different question ("is this module alive?") and has a
 *   second consumer the browser cannot serve: a pg_cron job at 08:00 IST that
 *   mails the same numbers. Computing them in SQL is the only way the screen and
 *   the email cannot drift apart, and it is one round trip instead of hundreds.
 *
 * The shape below mirrors public.master_report_snapshot exactly. Adding a module
 * is an INSERT into master_report_modules — no change here.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/core/platform/supabase";

/**
 * `tracking` exists only for read-only modules (see `usageFromVisits`) whose
 * opens counter has not yet run for a full dormancy window. You cannot assert
 * "nothing in 7 days" after watching for three, and calling such a module
 * dormant on the morning tracking ships would be a lie the report can't take back.
 */
export type ModuleState = "active" | "quiet" | "dormant" | "tracking" | "error";

export interface ModuleSnapshot {
  appId: string;
  label: string;
  detailPath: string | null;
  state: ModuleState;
  /**
   * False for modules with no workflow status (Leads, receivables follow-ups).
   * Their `open` and `ageing` are structurally meaningless rather than zero, and
   * the UI must print an em dash — a "0" there reads as "nothing pending".
   */
  tracksStatus: boolean;
  /**
   * True where the head table stores a REAL due date (tasks, asset jobs), so
   * `overdue` is a genuine count. False for the FMS modules, whose due dates are
   * derived per step in TypeScript and never stored — there `overdue` is 0 and
   * meaningless, and `ageingOpenGt7d` is the honest substitute.
   */
  tracksDue: boolean;
  /** True where some rows are machine-generated, so the split below is real. */
  hasSystem: boolean;
  /**
   * True for modules people OPEN but never write to — the Outstanding Dashboard
   * being the case that forced this: its data lives in a different Supabase
   * project and no portal row is ever created, so a row count could only ever
   * say zero and the report called it Dormant while it was in daily use. Its
   * state comes from `visitors7d` / `lastVisitAt` instead.
   */
  usageFromVisits: boolean;
  total: number;
  open: number;
  /** Open items past their stored due date. Only meaningful when tracksDue. */
  overdue: number;
  /** Entered by a PERSON today. Machine-generated rows are counted separately. */
  newToday: number;
  newTodaySystem: number;
  new7d: number;
  new7dSystem: number;
  newWindow: number;
  /** Open items created over 7 days ago. NOT lateness — see tracksDue. */
  ageingOpenGt7d: number;
  oldestOpenDays: number;
  /** Most recent ENTRY. Null for a module nobody has ever written to. */
  lastActivityAt: string | null;
  activeUsers7d: number;
  /** People who opened the module today (IST). */
  visitorsToday: number;
  /** Distinct people who opened it in the last 7 IST days. */
  visitors7d: number;
  /** Opens in the last 7 days — repeat visits included, unlike `visitors7d`. */
  opens7d: number;
  lastVisitAt: string | null;
  /** The later of `lastActivityAt` and `lastVisitAt` — "someone was in here". */
  lastSignalAt: string | null;
  /** Set only when that module's own aggregate failed; the rest still render. */
  error?: string;
}

export interface MasterSnapshot {
  generatedAt: string;
  windowDays: number;
  dormantAfterDays: number;
  /**
   * When per-module open tracking began. Null on a database that predates it.
   * Needed to distinguish "nobody opens this" from "we only started counting
   * yesterday" — see the `tracking` state.
   */
  visitsSince: string | null;
  modules: ModuleSnapshot[];
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function mapModule(raw: Record<string, unknown>): ModuleSnapshot {
  const state = str(raw.state);
  return {
    appId: str(raw.app_id),
    label: str(raw.label) || str(raw.app_id),
    detailPath: str(raw.detail_path) || null,
    state: (["active", "quiet", "dormant", "tracking", "error"].includes(state)
      ? state
      : "error") as ModuleState,
    tracksStatus: raw.tracks_status !== false,
    tracksDue: raw.tracks_due === true,
    hasSystem: raw.has_system === true,
    usageFromVisits: raw.usage_from_visits === true,
    total: num(raw.total),
    open: num(raw.open),
    overdue: num(raw.overdue),
    newToday: num(raw.new_today),
    newTodaySystem: num(raw.new_today_system),
    new7d: num(raw.new_7d),
    new7dSystem: num(raw.new_7d_system),
    newWindow: num(raw.new_window),
    ageingOpenGt7d: num(raw.ageing_open_gt_7d),
    oldestOpenDays: num(raw.oldest_open_days),
    lastActivityAt: str(raw.last_activity_at) || null,
    activeUsers7d: num(raw.active_users_7d),
    visitorsToday: num(raw.visitors_today),
    visitors7d: num(raw.visitors_7d),
    opens7d: num(raw.opens_7d),
    lastVisitAt: str(raw.last_visit_at) || null,
    lastSignalAt: str(raw.last_signal_at) || str(raw.last_activity_at) || null,
    error: typeof raw.error === "string" ? raw.error : undefined,
  };
}

export async function fetchMasterSnapshot(days = 30): Promise<MasterSnapshot> {
  const { data, error } = await supabase.rpc("master_report_snapshot", { p_days: days });
  if (error) throw new Error(error.message);

  const root = (data ?? {}) as Record<string, unknown>;
  const mods = Array.isArray(root.modules) ? (root.modules as Record<string, unknown>[]) : [];
  return {
    generatedAt: str(root.generated_at),
    windowDays: num(root.window_days) || days,
    dormantAfterDays: num(root.dormant_after_days) || 7,
    visitsSince: str(root.visits_since) || null,
    modules: mods.map(mapModule),
  };
}

export const masterSnapshotKey = (days: number) => ["master-report", "snapshot", days] as const;

export function useMasterSnapshot(days = 30) {
  return useQuery({
    queryKey: masterSnapshotKey(days),
    queryFn: () => fetchMasterSnapshot(days),
    // The underlying counts move all day; a director refreshing at 11:00 should
    // not be served the 08:00 figures from cache.
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Derived reads used by both the page and the PDF, so the two cannot disagree.
// ---------------------------------------------------------------------------

export interface SnapshotTotals {
  active: number;
  quiet: number;
  dormant: number;
  tracking: number;
  errored: number;
  /** Modules at least one person opened today — the adoption headline. */
  openedToday: number;
  /** People-entered only — the headline, because it is the adoption signal. */
  newToday: number;
  newTodaySystem: number;
  open: number;
  overdue: number;
}

export function totalsOf(modules: ModuleSnapshot[]): SnapshotTotals {
  return modules.reduce<SnapshotTotals>(
    (acc, m) => {
      if (m.state === "active") acc.active += 1;
      else if (m.state === "quiet") acc.quiet += 1;
      else if (m.state === "dormant") acc.dormant += 1;
      else if (m.state === "tracking") acc.tracking += 1;
      else acc.errored += 1;
      if (m.visitorsToday > 0) acc.openedToday += 1;
      acc.newToday += m.newToday;
      acc.newTodaySystem += m.newTodaySystem;
      if (m.tracksStatus) acc.open += m.open;
      // Only modules with a stored due date contribute; summing the others'
      // zeros would imply "nothing is late" rather than "not measurable here".
      if (m.tracksDue) acc.overdue += m.overdue;
      return acc;
    },
    {
      active: 0, quiet: 0, dormant: 0, tracking: 0, errored: 0, openedToday: 0,
      newToday: 0, newTodaySystem: 0, open: 0, overdue: 0,
    }
  );
}

/** "2h", "3d", "never" — freshness reads better than a timestamp on this screen. */
export function sinceLabel(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "never";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

/**
 * Sort key for "last activity" — never is oldest, so it sinks to the bottom.
 * Uses the combined signal: for a read-only module the only thing that ever
 * happens IS an open, and sorting it by its last entry would strand it at the
 * bottom no matter how heavily it is used.
 */
export function lastActivitySort(m: ModuleSnapshot): number {
  const iso = m.lastSignalAt ?? m.lastActivityAt;
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

export const STATE_LABEL: Record<ModuleState, string> = {
  active: "Active",
  quiet: "Quiet",
  dormant: "Dormant",
  tracking: "Tracking",
  error: "Error",
};
