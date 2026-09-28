/**
 * The ranking panel's data (CC-1): what `fms_rank_board` returns, and the hooks
 * that read and change it.
 *
 * The panel computes NOTHING about anyone's steps. Every figure is the server's —
 * written nightly by the `fms-ranking` edge function from the modules' own code, and
 * cut by `fms_rank_board` to what the viewer may see: the whole ladder (rank, name,
 * score, steps) — opened to everyone by the user on 18-09-2026 — but nobody's split
 * by process and nobody's step-by-step detail except the viewer's own (admins: anyone's).
 * The one piece of arithmetic here is the what-if, which only ever moves the
 * VIEWER's own numbers (see projectScore).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/core/platform/supabase";
import { appName } from "@/apps/appInfo";

// The fms_rank_* RPCs are not in database.types.ts; same untyped-client idiom as
// the other modules' newer RPCs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type Outcome = "on_time" | "late" | "missed";
export type NotRanked = "admin" | "excluded" | "external" | "under_minimum";

export interface Split {
  given: number;
  on_time: number;
  late: number;
  missed: number;
  score: number;
}

export interface Placing {
  rank: number;
  name: string;
  score: number;
  given: number;
  on_time?: number;
  late?: number;
  missed?: number;
  is_me: boolean;
}

export interface Me {
  given: number;
  on_time: number;
  late: number;
  missed: number;
  points: number;
  score: number;
  rank: number | null;
  ranked: boolean;
  not_ranked: NotRanked | null;
  by_module: Record<string, Split>;
  ahead_pct: number | null;
  gap: { above_rank: number; above_score: number; steps: number; draw_level_only: boolean } | null;
  /** Under 10 steps: where they would sit today, shown as provisional. */
  provisional_rank: number | null;
}

export interface OpenStep {
  module: string;
  step: string;
  ref: string;
  due_date: string | null;
  outcome: "missed" | "upcoming";
}

export interface LadderRow {
  user_id: string;
  name: string;
  rank: number | null;
  score: number;
  given: number;
  on_time: number;
  late: number;
  missed: number;
  points: number;
  ranked: boolean;
  not_ranked: NotRanked | null;
  by_module: Record<string, Split>;
}

export interface Board {
  month: string;
  current_month: string;
  is_current: boolean;
  frozen: boolean;
  frozen_at: string | null;
  computed_at: string | null;
  ladder_size: number;
  is_admin: boolean;
  /** The signed-in viewer is an admin — true even while previewing someone else. */
  viewer_is_admin: boolean;
  /** Set while an admin previews exactly what this person sees. */
  previewing: string | null;
  months: { month: string; frozen: boolean }[];
  modules: { module: string; active: boolean }[];
  top: Placing[];
  /** Everyone ranked: rank, name, score, steps. Nothing more about anyone else. */
  ladder: { rank: number; name: string; score: number; given: number; is_me: boolean }[];
  ladder_scores: number[];
  me: Me | null;
  me_name: string | null;
  excluded_reason: string | null;
  my_open: OpenStep[];
  my_trend: { as_of: string; score: number; rank: number | null; given: number }[];
  my_history: { month: string; score: number; rank: number | null; ranked: boolean; given: number; ladder_size: number | null; frozen: boolean }[];
  eotm: { month: string; podium: Placing[] } | null;
  admin?: {
    ladder: LadderRow[];
    exclusions: { user_id: string; name: string; reason: string; added_by: string | null; added_at: string }[];
    modules: { module: string; active: boolean; note: string | null; changed_by: string | null; changed_at: string }[];
    people: { user_id: string; name: string }[];
    run: Record<string, { rows?: number; at?: string; scoredClosed?: number; missedCharges?: number; dropped?: Record<string, number> }>;
  };
}

export interface WallMonth {
  month: string;
  ladder_size: number | null;
  podium: Placing[];
}

export interface MyStep {
  module: string;
  step: string;
  ref: string;
  round: number;
  outcome: Outcome;
  due_date: string | null;
  done_at: string | null;
  days_late: number | null;
  basis: "closed" | "open" | "closed_after";
}

/** The minimum the user set: 10 steps in a month to be ranked. Mirrors fms_rank_rescore. */
export const MIN_STEPS = 10;

/** Ranking module key → registry app id, for display names. Two keys differ. */
const MODULE_APP: Record<string, string> = { purchase: "procurement", hr: "hr-recruitment" };
export const moduleName = (key: string): string => appName(MODULE_APP[key] ?? key);

const call = async <T,>(fn: string, args?: Record<string, unknown>): Promise<T> => {
  const { data, error } = await db.rpc(fn, args ?? {});
  if (error) throw new Error(error.message);
  return data as T;
};

export const boardKey = (month: string | null, as: string | null = null) =>
  ["fms-rank-board", month ?? "current", as ?? "self"] as const;

/** `as` = an admin previewing exactly what that person sees. The server refuses it for anyone else. */
export function useRankBoard(month: string | null, as: string | null = null) {
  return useQuery({
    queryKey: boardKey(month, as),
    queryFn: () => call<Board>("fms_rank_board", { p_month: month, p_as: as }),
    staleTime: 5 * 60_000,
  });
}

export function useRankWall(enabled: boolean) {
  return useQuery({
    queryKey: ["fms-rank-wall"],
    queryFn: () => call<WallMonth[]>("fms_rank_wall"),
    enabled,
    staleTime: 30 * 60_000,
  });
}

export function useMySteps(month: string, enabled: boolean, user: string | null = null) {
  return useQuery({
    queryKey: ["fms-rank-my-steps", month, user ?? "self"],
    queryFn: () => call<MyStep[]>("fms_rank_my_steps", { p_month: month, p_user: user }),
    enabled,
  });
}

/** Admin changes re-score the running month on the server; refetch every board. */
export function useRankAdmin() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ["fms-rank-board"] });
  return {
    exclude: useMutation({
      mutationFn: (v: { userId: string; reason: string }) => call<void>("fms_rank_exclude", { p_user: v.userId, p_reason: v.reason }),
      onSuccess: done,
    }),
    include: useMutation({
      mutationFn: (userId: string) => call<void>("fms_rank_include", { p_user: userId }),
      onSuccess: done,
    }),
    setModule: useMutation({
      mutationFn: (v: { module: string; active: boolean }) => call<void>("fms_rank_set_module", { p_module: v.module, p_active: v.active }),
      onSuccess: done,
    }),
  };
}

// ── The what-if ───────────────────────────────────────────────────────────────

/** Score as the server writes it: points ÷ steps, to one decimal. */
export const scoreOf = (points: number, given: number): number =>
  given > 0 ? Math.round((points / given) * 1000) / 10 : 0;

/**
 * The viewer's score and rank if they closed some of their own open steps today.
 *
 *  · an OVERDUE step already counts against them (0 of 1). Closed now it is late:
 *    +½ point, same number of steps.
 *  · a step NOT YET DUE is not counted yet. Closed on time it adds a step and a
 *    point: +1 / +1.
 *
 * Rank comes from everyone else's scores with no names attached (`ladder_scores`),
 * ranked the way the server ranks: one plus the number of people strictly above.
 */
export function projectScore(
  me: Pick<Me, "given" | "points" | "score" | "ranked">,
  ladderScores: number[],
  closeOverdue: number,
  closeUpcoming: number,
): { given: number; points: number; score: number; rank: number; provisional: boolean } {
  const given = me.given + closeUpcoming;
  const points = me.points + closeOverdue * 0.5 + closeUpcoming;
  const score = scoreOf(points, given);
  // Take the viewer's own current score out of the field once, if they are in it.
  const others = [...ladderScores];
  if (me.ranked) {
    const i = others.indexOf(me.score);
    if (i >= 0) others.splice(i, 1);
  }
  // Under the minimum the rank is where they WOULD sit: provisional, as the card says.
  return { given, points, score, rank: 1 + others.filter((s) => s > score).length, provisional: given < MIN_STEPS };
}

/** "Mon YYYY" for a month's first day. */
export const monthLabel = (month: string, short = false): string =>
  new Date(`${month}T00:00:00`).toLocaleDateString("en-GB", { month: short ? "short" : "long", year: "numeric" });
