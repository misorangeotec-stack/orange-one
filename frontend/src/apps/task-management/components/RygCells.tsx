import { Link } from "react-router-dom";
import { cn } from "@/shared/lib/cn";
import { countsTowardMetrics, type PersonReport, type RygPct } from "../mock/selectors";
import type { Task } from "../types";
import RygBar from "./RygBar";

export type RedCounts = { pending: number; inProgress: number; shifted: number; total: number };
export type RygCount = { green: number; yellow: number; red: number; total: number };

/** Task counts behind the RYG split: green = completed, yellow = revised, red = the rest.
 *  These tie back to the columns — green === Done, and green + yellow + red === Planned. */
export function rygCounts(r: PersonReport): RygCount {
  return { green: r.completed, yellow: r.revised, red: r.pending + r.shifted, total: r.planned };
}

/**
 * What the "Red" slice is actually made of, for a set of people's tasks this week.
 * The three buckets are the real task statuses behind Red and sum to the Red column:
 *   pending    = still pending
 *   inProgress = being worked on
 *   shifted    = moved to another week
 * N/A and personal tasks are excluded, matching reportFor so the breakdown ties to the Red count.
 */
export function redCounts(tasks: Task[], ids: Set<string>): RedCounts {
  let pending = 0, inProgress = 0, shifted = 0;
  for (const t of tasks) {
    if (!t.assignedTo || !ids.has(t.assignedTo) || !countsTowardMetrics(t)) continue;
    if (t.status === "pending") pending++;
    else if (t.status === "in_progress") inProgress++;
    else if (t.status === "shifted") shifted++;
  }
  return { pending, inProgress, shifted, total: pending + inProgress + shifted };
}

/** One Green/Yellow/Red column cell: the task count (bold, coloured) with its % beneath.
 *  When `to` is set the count drills into a filtered task list; `stopPropagation`
 *  keeps the enclosing row's own click (e.g. open scorecard) intact. */
export function RygNumCell({ count, pct, tone, has, strong, to }: { count: number; pct: number; tone: string; has: boolean; strong?: boolean; to?: string }) {
  const num = <div className={cn("tabular-nums leading-none", tone, strong ? "font-bold text-[15px]" : "font-semibold text-[13.5px]")}>{count}</div>;
  return (
    <td className="px-3 py-2.5 text-center align-middle">
      {to ? (
        <Link to={to} onClick={(e) => e.stopPropagation()} className="block hover:underline" title="View these tasks">{num}</Link>
      ) : num}
      <div className="mt-1 text-[9.5px] tabular-nums text-grey-2">{has ? `${pct}%` : "—"}</div>
    </td>
  );
}

/** Thin proportion bar, plus a full breakdown of what the Red column is made of.
 *  All three buckets are shown (including zeros) whenever there's any Red, so the
 *  split is always explicit rather than implying the only states are the non-zero ones. */
export function PerfCell({ ryg, red }: { ryg: RygPct; red?: RedCounts }) {
  return (
    <div className="max-w-[200px] space-y-1">
      <RygBar red={ryg.red} yellow={ryg.yellow} green={ryg.green} showLegend={false} />
      {red && red.total > 0 && (
        <div className="text-[10px] text-grey-2">
          <span className="font-semibold text-[#c0392b]/70">Red</span> = {red.pending} pending · {red.inProgress} in-progress · {red.shifted} shifted
        </div>
      )}
    </div>
  );
}
