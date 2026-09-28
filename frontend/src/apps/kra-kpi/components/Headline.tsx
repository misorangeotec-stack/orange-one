/**
 * The headline pieces of a KRA / KPI report — the score, the work as a tree, the two KPIs.
 * Moved out of Consolidated (the person's own scorecard) so the Team summary (KPI-2) shows
 * the same figures in the same shapes: a director must never have to learn two layouts.
 */
import { cn } from "@/shared/lib/cn";
import { fmtPct, fmtScore } from "../facts/score";
import type { Totals } from "../lib/rows";

export const LABEL = "text-[10.5px] font-semibold uppercase tracking-wide text-grey-2";

export type BreakdownPart = "given" | "done" | "on_time" | "missed" | "late";

/** The big number, with last period's beside it. */
export function ScoreCard({ score, lastScore, w }: { score: number | null; lastScore: number | null; w: string }) {
  return (
    <div className="rounded-xl bg-orange/[0.07] px-4 py-3 ring-1 ring-orange/20">
      <div className={LABEL}>Score out of 100</div>
      <div className="mt-0.5 text-[48px] font-bold leading-none text-navy tabular-nums">{fmtScore(score)}</div>
      <div className="mt-1 text-[11px] text-grey">{lastScore === null ? `No work due last ${w}` : `Last ${w}: ${fmtScore(lastScore)}`}</div>
    </div>
  );
}

/** One line of the breakdown: an optional swatch, a name, and its count. Opens the work behind it when it can. */
function Line({
  label,
  value,
  dot,
  size,
  onClick,
}: {
  label: string;
  value: number;
  dot?: string;
  size: "lg" | "md" | "sm";
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className={cn("inline-flex items-center gap-1.5", size === "sm" ? "text-[12.5px] text-grey" : LABEL)}>
        {dot && <span className={cn("h-2 w-2 shrink-0 rounded-full", dot)} />}
        {label}
      </span>
      <span
        className={cn(
          "font-bold text-navy tabular-nums",
          size === "lg" ? "text-[24px] leading-tight" : size === "md" ? "text-[19px] leading-tight" : "text-[14px]",
        )}
      >
        {value}
      </span>
    </>
  );
  const cls = "flex w-full items-baseline justify-between gap-3 rounded-md px-1.5 py-0.5 text-left";
  if (!onClick) return <div className={cls}>{body}</div>;
  return (
    <button type="button" onClick={onClick} disabled={value === 0} className={cn(cls, "transition enabled:hover:bg-page disabled:cursor-default")}>
      {body}
    </button>
  );
}

/**
 * The period's work as the tree it is — the user asked for it read this way (18-09-2026):
 *
 *   Given ─┬─ Done ─┬─ On time
 *          │        └─ Late
 *          └─ Not done
 *
 * The bar draws the same split to scale, left to right: on time, late, not done. Every
 * segment is also named and counted beside it, so no colour carries meaning alone.
 */
export function Breakdown({
  totals,
  onDrill,
}: {
  totals: Pick<Totals, "given" | "done" | "onTime" | "late" | "missed">;
  onDrill?: (what: BreakdownPart) => void;
}) {
  const { given, done, onTime, late, missed } = totals;
  const seg = (n: number, cls: string, name: string) =>
    n > 0 ? <span key={name} className={cls} style={{ flexGrow: n, flexBasis: 0 }} title={`${name}: ${n}`} /> : null;
  const click = (what: BreakdownPart) => (onDrill ? () => onDrill(what) : undefined);
  return (
    <div className="min-w-[250px] flex-1">
      <Line label="Given" value={given} size="lg" onClick={click("given")} />
      <div className="mx-1.5 mt-1.5 flex h-2.5 gap-0.5 overflow-hidden rounded-[4px] bg-page" aria-hidden>
        {seg(onTime, "bg-ryg-green", "On time")}
        {seg(late, "bg-ryg-yellow", "Late")}
        {seg(missed, "bg-ryg-red", "Not done")}
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-x-4">
        <div>
          <Line label="Done" value={done} size="md" onClick={click("done")} />
          <div className="ml-2.5 mt-0.5 border-l-2 border-line pl-1.5">
            <Line label="On time" value={onTime} dot="bg-ryg-green" size="sm" onClick={click("on_time")} />
            <Line label="Late" value={late} dot="bg-ryg-yellow" size="sm" onClick={click("late")} />
          </div>
        </div>
        <div>
          <Line label="Not done" value={missed} dot="bg-ryg-red" size="md" onClick={click("missed")} />
        </div>
      </div>
    </div>
  );
}

/** The client's two KPIs, with last period's. */
export function KpiTiles({ totals, w }: { totals: Pick<Totals, "pct1" | "pct2" | "last1" | "last2">; w: string }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-lg border border-line px-3 py-2">
        <div className={LABEL}>% work not done</div>
        <div className="text-[18px] font-bold text-navy tabular-nums">{fmtPct(totals.pct1)}</div>
        <div className="text-[11px] text-grey">Last {w}: {fmtPct(totals.last1)}</div>
      </div>
      <div className="rounded-lg border border-line px-3 py-2">
        <div className={LABEL}>% work not done on time</div>
        <div className="text-[18px] font-bold text-navy tabular-nums">{fmtPct(totals.pct2)}</div>
        <div className="text-[11px] text-grey">Last {w}: {fmtPct(totals.last2)}</div>
      </div>
    </div>
  );
}
