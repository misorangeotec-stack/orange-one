import { cn } from "@/shared/lib/cn";
import type { PersonReport, RygPct } from "../mock/selectors";
import type { Task } from "../types";
import RygBar from "./RygBar";

export type RedCounts = { pending: number; inProgress: number; shifted: number; total: number };
export type RygCount = { green: number; yellow: number; red: number; total: number };

/** Task counts behind the RYG split: green = completed, yellow = revised, red = the rest.
 *  These tie back to the columns — green === Done, and green + yellow + red === Planned. */
export function rygCounts(r: PersonReport): RygCount {
  return { green: r.completed, yellow: r.revised, red: r.pending + r.shifted, total: r.planned };
}

/** What the "Red" slice is actually made of, for a set of people's tasks this week. */
export function redCounts(tasks: Task[], ids: Set<string>): RedCounts {
  let pending = 0, inProgress = 0, shifted = 0;
  for (const t of tasks) {
    if (!t.assignedTo || !ids.has(t.assignedTo)) continue;
    if (t.status === "pending") pending++;
    else if (t.status === "in_progress") inProgress++;
    else if (t.status === "shifted") shifted++;
  }
  return { pending, inProgress, shifted, total: pending + inProgress + shifted };
}

/** One Green/Yellow/Red column cell: the task count (bold, coloured) with its % beneath. */
export function RygNumCell({ count, pct, tone, has, strong }: { count: number; pct: number; tone: string; has: boolean; strong?: boolean }) {
  return (
    <td className="px-3 py-2.5 text-center align-middle">
      <div className={cn("tabular-nums leading-none", tone, strong ? "font-bold text-[15px]" : "font-semibold text-[13.5px]")}>{count}</div>
      <div className="mt-1 text-[9.5px] tabular-nums text-grey-2">{has ? `${pct}%` : "—"}</div>
    </td>
  );
}

/** Thin proportion bar, plus a subtle breakdown of what the Red column is made of. */
export function PerfCell({ ryg, red }: { ryg: RygPct; red?: RedCounts }) {
  const parts = red
    ? [red.pending && `${red.pending} pending`, red.inProgress && `${red.inProgress} in-progress`, red.shifted && `${red.shifted} shifted`].filter(Boolean)
    : [];
  return (
    <div className="max-w-[200px] space-y-1">
      <RygBar red={ryg.red} yellow={ryg.yellow} green={ryg.green} showLegend={false} />
      {parts.length > 0 && (
        <div className="text-[10px] text-grey-2">
          <span className="font-semibold text-[#c0392b]/70">Red</span> = {parts.join(" · ")}
        </div>
      )}
    </div>
  );
}
