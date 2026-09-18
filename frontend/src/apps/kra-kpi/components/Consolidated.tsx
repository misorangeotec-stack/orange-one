import Card from "@/shared/components/ui/Card";
import { cn } from "@/shared/lib/cn";
import type { KpiReport } from "../data/report";
import { fmtPct, fmtScore } from "../facts/score";
import { periodWord, type Period } from "../lib/period";
import type { ModuleSplit, Totals } from "../lib/rows";
import Trend from "./Trend";

const LABEL = "text-[10.5px] font-semibold uppercase tracking-wide text-grey-2";

function Figure({ label, value, hint, onClick }: { label: string; value: string | number; hint?: string; onClick?: () => void }) {
  const body = (
    <>
      <div className={LABEL}>{label}</div>
      <div className="mt-0.5 text-[20px] font-bold leading-tight text-navy tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] leading-snug text-grey">{hint}</div>}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="rounded-lg px-2 py-1.5 text-left transition hover:bg-page">
      {body}
    </button>
  ) : (
    <div className="px-2 py-1.5">{body}</div>
  );
}

/**
 * The foot of the report: the totals, the two KPIs, the score out of 100, the same per
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
  onDrill: (what: "given" | "done" | "on_time" | "missed" | "late", module?: string) => void;
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
            <div className="grid flex-1 grid-cols-2 gap-1 sm:grid-cols-3">
              <Figure label="Given" value={totals.given} onClick={() => onDrill("given")} />
              <Figure label="Done" value={totals.done} onClick={() => onDrill("done")} />
              <Figure label="On time" value={totals.onTime} onClick={() => onDrill("on_time")} />
              <Figure label="Late" value={totals.late} onClick={() => onDrill("late")} />
              <Figure label="Not done" value={totals.missed} onClick={() => onDrill("missed")} />
              <Figure label="Still due" value={totals.stillDue} hint="Due later — not counted yet" />
            </div>
          </div>
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
                        {m.onTime} on time · {m.late} late · {m.missed} not done of {m.given}
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
            {period.mode === "week" ? "The last eight weeks, this one in orange." : "Every week in the range."}
          </p>
          <div className="mt-3">
            <Trend weeks={report.trend} highlight={period.mode === "week" ? period.from : undefined} />
          </div>
        </div>
      </div>
    </Card>
  );
}
