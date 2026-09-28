import Card from "@/shared/components/ui/Card";
import { cn } from "@/shared/lib/cn";
import type { KpiReport } from "../data/report";
import { fmtScore } from "../facts/score";
import { formatDate } from "@/shared/lib/time";
import { periodWord, type Period } from "../lib/period";
import type { ModuleSplit, Totals } from "../lib/rows";
import { Breakdown, KpiTiles, LABEL, ScoreCard } from "./Headline";
import Trend from "./Trend";

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

  return (
    <Card className="p-4 sm:p-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
        <div>
          <h3 className="text-[15px] font-bold text-navy">This {w}, all work</h3>
          <div className="mt-3 flex flex-wrap items-stretch gap-3">
            <ScoreCard score={totals.score} lastScore={totals.lastScore} w={w} />
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
          <div className="mt-3">
            <KpiTiles totals={totals} w={w} />
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
