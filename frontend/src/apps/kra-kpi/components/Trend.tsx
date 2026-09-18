import { useState } from "react";
import { cn } from "@/shared/lib/cn";
import type { TrendWeek } from "../data/report";
import { fmtScore, scoreOf } from "../facts/score";
import { rangeLabel, shortRangeLabel } from "../lib/period";

/**
 * The score, week by week — the trailing eight weeks for a week, else every ISO week
 * the range touches. One series on a fixed 0–100 scale, so no legend: the heading names
 * it. A week with nothing due has no bar at all rather than a zero, which would read as
 * "did nothing".
 *
 * ── Every bar is a WHOLE week, Monday to Sunday ──
 * Months do not start on Mondays: August 2026's first week is ISO week 31, 27 Jul–2 Aug.
 * The user asked on 18-09-2026 for the proper week in the trend, not the two August days
 * of it (kpi_report stopped cutting weeks to the period in 20261128122000). So the first
 * and last bars of a month reach into the months either side, each bar is labelled with
 * its own dates, and one sentence says so. The month's headline figures are unaffected:
 * they still come from its own dates.
 *
 * ── It stops at the CURRENT week ──
 * A week that has not started has no score. It used to get a bar anyway, built only from
 * steps finished ahead of their due date — a "100" for a week nobody had worked yet
 * (20261128123000 ends the series at the as-of date). The running week is marked "so far".
 *
 * Every week's figures are also in the screen-reader table under the chart.
 */
const H = 120; // plot height, px

export default function Trend({
  weeks,
  highlight,
  periodFrom,
  periodTo,
  asOf,
  scoreOnly = false,
}: {
  weeks: TrendWeek[];
  /** Week mode: the report's own week, drawn in orange and labelled with its score. */
  highlight?: string;
  /** The report's period, to say when the first or last week reaches outside it. */
  periodFrom: string;
  periodTo: string;
  /** The figures' as-of day: the week containing it is still running. */
  asOf: string;
  /** The readout gives the score alone — the Team page, where team-wide counts read as noise. */
  scoreOnly?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (!weeks.length) return null;
  const scored = weeks.map((w) => ({ ...w, score: scoreOf({ given: w.given, done: w.done, onTime: w.on_time }) }));
  const shown = hover ?? scored.length - 1;
  const tip = scored[shown];
  // Dates fit under up to six bars even on a phone; past that, week numbers only.
  const datesOnAxis = !highlight && scored.length <= 6;
  const first = scored[0];
  const last = scored[scored.length - 1];
  const spills = !highlight && (first.from < periodFrom || last.to > periodTo);

  return (
    <div>
      <div className="relative" style={{ height: H + (datesOnAxis ? 44 : 22) }}>
        {/* Recessive gridlines at 50 and 100: hairline, solid. */}
        {[100, 50].map((v) => (
          <div key={v} className="absolute left-7 right-0 border-t border-line" style={{ top: H - (v / 100) * H }}>
            <span className="absolute -left-7 -top-2 w-6 text-right text-[10px] text-grey-2 tabular-nums">{v}</span>
          </div>
        ))}
        <div className="absolute left-7 right-0 border-t border-line/80" style={{ top: H }}>
          <span className="absolute -left-7 -top-2 w-6 text-right text-[10px] text-grey-2 tabular-nums">0</span>
        </div>

        <div className="absolute left-7 right-0 top-0 flex items-end gap-0.5" style={{ height: H }}>
          {scored.map((w, i) => {
            const isHighlight = highlight === w.week_start;
            const h = w.score === null ? 0 : Math.max(2, (w.score / 100) * H);
            return (
              <button
                key={w.week_start}
                type="button"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                aria-label={`${rangeLabel(w.from, w.to)}: ${w.score === null ? "nothing due" : `score ${fmtScore(w.score)}`}`}
                className="group relative flex h-full flex-1 items-end justify-center outline-none"
              >
                {w.score !== null && (
                  <span
                    className={cn(
                      "block w-full max-w-[24px] rounded-t-[4px] transition-opacity",
                      isHighlight ? "bg-orange" : "bg-navy/70",
                      hover !== null && hover !== i && "opacity-50",
                    )}
                    style={{ height: h }}
                  />
                )}
                {/* The one direct label: the week the report is about. */}
                {isHighlight && w.score !== null && (
                  <span className="absolute text-[11px] font-semibold text-navy tabular-nums" style={{ bottom: h + 3 }}>
                    {fmtScore(w.score)}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="absolute left-7 right-0 flex gap-0.5" style={{ top: H + 5 }}>
          {scored.map((w) => (
            <span key={w.week_start} className="flex-1 text-center tabular-nums leading-tight">
              {datesOnAxis ? (
                <>
                  {/* A break is allowed after the dash, so "27 Jul–2 Aug" wraps rather than collides on a phone. */}
                  <span className="block text-[10px] font-medium text-grey">{shortRangeLabel(w.from, w.to).replace("–", "–\u200b")}</span>
                  <span className="block text-[9.5px] text-grey-2">W{w.iso_week}</span>
                </>
              ) : (
                <span className="text-[10px] text-grey-2">W{w.iso_week}</span>
              )}
            </span>
          ))}
        </div>
      </div>

      <p className="mt-2 min-h-[18px] text-[11.5px] text-grey tabular-nums" aria-live="polite">
        <span className="font-semibold text-navy">Week {tip.iso_week}</span> · {rangeLabel(tip.from, tip.to)}
        {tip.from <= asOf && asOf <= tip.to && " (so far)"} ·{" "}
        {tip.score === null
          ? "nothing due"
          : scoreOnly
            ? `score ${fmtScore(tip.score)}`
            : `score ${fmtScore(tip.score)} · ${tip.on_time} on time, ${tip.done - tip.on_time} late, ${tip.given - tip.done} not done of ${tip.given}`}
      </p>
      {spills && (
        <p className="mt-1 text-[11px] leading-snug text-grey">
          Each bar is a whole week, Monday to Sunday, so the first and last can include days just outside the period. The figures above
          count only {rangeLabel(periodFrom, periodTo)}.
        </p>
      )}

      {/* sr-only on a <table> does not shrink it (a table sizes to its content), so it
          widened the page on a phone by 59px; the wrapper is what hides it. */}
      <div className="sr-only">
        <table>
          <caption>Score by week</caption>
          <thead>
            <tr><th>Dates</th><th>Week</th><th>Given</th><th>Done</th><th>On time</th><th>Score</th></tr>
          </thead>
          <tbody>
            {scored.map((w) => (
              <tr key={w.week_start}>
                <td>{rangeLabel(w.from, w.to)}</td>
                <td>{w.iso_week}</td>
                <td>{w.given}</td>
                <td>{w.done}</td>
                <td>{w.on_time}</td>
                <td>{fmtScore(w.score)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
