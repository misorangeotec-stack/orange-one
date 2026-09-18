import Card from "@/shared/components/ui/Card";
import { cn } from "@/shared/lib/cn";
import type { KpiReport } from "../data/report";
import { fmtPct, fmtScore } from "../facts/score";
import { formatDate } from "@/shared/lib/time";
import { periodWord, type Period } from "../lib/period";
import type { ModuleSplit, Totals } from "../lib/rows";
import Trend from "./Trend";

const LABEL = "text-[10.5px] font-semibold uppercase tracking-wide text-grey-2";

/** One line of the breakdown: an optional swatch, a name, and its count. Opens the work behind it. */
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
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={value === 0}
      className="flex w-full items-baseline justify-between gap-3 rounded-md px-1.5 py-0.5 text-left transition enabled:hover:bg-page disabled:cursor-default"
    >
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
function Breakdown({ totals, onDrill }: { totals: Totals; onDrill: (what: "given" | "done" | "on_time" | "missed" | "late") => void }) {
  const { given, done, onTime, late, missed } = totals;
  const seg = (n: number, cls: string, name: string) =>
    n > 0 ? <span key={name} className={cls} style={{ flexGrow: n, flexBasis: 0 }} title={`${name}: ${n}`} /> : null;
  return (
    <div className="min-w-[250px] flex-1">
      <Line label="Given" value={given} size="lg" onClick={() => onDrill("given")} />
      <div className="mx-1.5 mt-1.5 flex h-2.5 gap-0.5 overflow-hidden rounded-[4px] bg-page" aria-hidden>
        {seg(onTime, "bg-ryg-green", "On time")}
        {seg(late, "bg-ryg-yellow", "Late")}
        {seg(missed, "bg-ryg-red", "Not done")}
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-x-4">
        <div>
          <Line label="Done" value={done} size="md" onClick={() => onDrill("done")} />
          <div className="ml-2.5 mt-0.5 border-l-2 border-line pl-1.5">
            <Line label="On time" value={onTime} dot="bg-ryg-green" size="sm" onClick={() => onDrill("on_time")} />
            <Line label="Late" value={late} dot="bg-ryg-yellow" size="sm" onClick={() => onDrill("late")} />
          </div>
        </div>
        <div>
          <Line label="Not done" value={missed} dot="bg-ryg-red" size="md" onClick={() => onDrill("missed")} />
        </div>
      </div>
    </div>
  );
}

/**
 * The head of the report: the totals, the two KPIs, the score out of 100, the same per
 * module, and the score week by week. Every figure is POOLED — added up over every row,
 * volume-weighted — never an average of per-row figures.
 */
export default function Consolidated({
  period,
  report,
  totals,
  modules,
  onDrill,
}: {
  period: Period;
  report: KpiReport;
  totals: Totals;
  modules: ModuleSplit[];
  onDrill: (what: "given" | "done" | "on_time" | "missed" | "late" | "still", module?: string) => void;
}) {
  const w = periodWord(period.mode).toLowerCase();
  const scoreHint =
    totals.lastScore === null ? `No work due last ${w}` : `Last ${w}: ${fmtScore(totals.lastScore)}`;

  return (
    <Card className="p-4 sm:p-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
        <div>
          <h3 className="text-[15px] font-bold text-navy">This {w}, all work</h3>
          <div className="mt-3 flex flex-wrap items-stretch gap-3">
            <div className="rounded-xl bg-orange/[0.07] px-4 py-3 ring-1 ring-orange/20">
              <div className={LABEL}>Score out of 100</div>
              <div className="mt-0.5 text-[48px] font-bold leading-none text-navy tabular-nums">{fmtScore(totals.score)}</div>
              <div className="mt-1 text-[11px] text-grey">{scoreHint}</div>
            </div>
            <Breakdown totals={totals} onDrill={onDrill} />
          </div>
          {/* Not a KPI: work whose due date has not come yet is not held against anyone, so
              it has no place among the score's figures. It is only "what is still to come". */}
          {totals.stillDue > 0 && (
            <p className="mt-2 text-[12px] text-grey">
              Not counted yet:{" "}
              <button type="button" onClick={() => onDrill("still")} className="font-semibold text-navy underline decoration-line underline-offset-2 hover:text-orange">
                {totals.stillDue} more
              </button>{" "}
              due later this {w} (not yet due on {formatDate(report.as_of_date)}). Each joins <em>Given</em> on its due date.
            </p>
          )}
          <div className="mt-3 grid grid-cols-2 gap-3">
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

          {modules.length > 0 && (
            <>
              <h4 className={cn(LABEL, "mt-5")}>By module</h4>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {modules.map((m) => (
                  <button
                    key={m.module}
                    type="button"
                    onClick={() => onDrill("given", m.module)}
                    className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-left transition hover:border-orange/40"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold text-navy">{m.moduleName}</span>
                      <span className="block text-[11.5px] text-grey tabular-nums">
                        {m.given} given · {m.done} done ({m.onTime} on time, {m.late} late) · {m.missed} not done
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[18px] font-bold text-navy tabular-nums">{fmtScore(m.score)}</span>
                      <span className="block text-[10px] text-grey-2">score</span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div>
          <h3 className="text-[15px] font-bold text-navy">Score by week</h3>
          <p className="text-[11.5px] text-grey-2">
            {period.mode === "week"
              ? "The last eight weeks, this one in orange."
              : period.mode === "month"
                ? "Every week of the month."
                : "Every week in the range."}
          </p>
          <div className="mt-3">
            <Trend
              weeks={report.trend}
              highlight={period.mode === "week" ? period.from : undefined}
              periodFrom={period.from}
              periodTo={period.to}
              asOf={report.as_of_date}
            />
          </div>
        </div>
      </div>
    </Card>
  );
}
