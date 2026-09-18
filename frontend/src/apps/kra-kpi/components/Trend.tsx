import { useState } from "react";
import { cn } from "@/shared/lib/cn";
import type { TrendWeek } from "../data/report";
import { fmtScore, scoreOf } from "../facts/score";
import { rangeLabel } from "../lib/period";

/**
 * The score, week by week — the trailing eight weeks for a week, else every ISO week
 * the range touches. One series on a fixed 0–100 scale, so no legend: the heading
 * names it. A week the range only partly covers is drawn hatched and starred, because
 * its score rests on fewer days. A week with nothing due has no bar at all rather than
 * a zero, which would read as "did nothing".
 *
 * Every week's figures are also in the screen-reader table under the chart.
 */
const H = 120; // plot height, px

export default function Trend({ weeks, highlight }: { weeks: TrendWeek[]; highlight?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!weeks.length) return null;
  const scored = weeks.map((w) => ({ ...w, score: scoreOf({ given: w.given, done: w.done, onTime: w.on_time }) }));
  const shown = hover ?? scored.length - 1;
  const tip = scored[shown];

  return (
    <div>
      <div className="relative" style={{ height: H + 22 }}>
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
                aria-label={`Week ${w.iso_week}: ${w.score === null ? "nothing due" : `score ${fmtScore(w.score)}`}${w.partial ? ", partial week" : ""}`}
                className="group relative flex h-full flex-1 items-end justify-center outline-none"
              >
                {w.score !== null && (
                  <span
                    className={cn(
                      "block w-full max-w-[24px] rounded-t-[4px] transition-opacity",
                      isHighlight ? "bg-orange" : "bg-navy/70",
                      hover !== null && hover !== i && "opacity-50",
                    )}
                    style={{
                      height: h,
                      backgroundImage: w.partial
                        ? "repeating-linear-gradient(45deg, rgba(255,255,255,0.55) 0 3px, transparent 3px 7px)"
                        : undefined,
                    }}
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
            <span key={w.week_start} className="flex-1 text-center text-[10px] text-grey-2 tabular-nums">
              W{w.iso_week}
              {w.partial ? "*" : ""}
            </span>
          ))}
        </div>
      </div>

      <p className="mt-2 min-h-[18px] text-[11.5px] text-grey tabular-nums" aria-live="polite">
        <span className="font-semibold text-navy">Week {tip.iso_week}</span> · {rangeLabel(tip.from, tip.to)}
        {tip.partial && " (partial)"} ·{" "}
        {tip.score === null ? "nothing due" : `score ${fmtScore(tip.score)} · ${tip.on_time} on time, ${tip.done - tip.on_time} late, ${tip.given - tip.done} not done of ${tip.given}`}
      </p>
      {scored.some((w) => w.partial) && <p className="text-[11px] text-grey-2">* Partial week — only the days inside the range are counted.</p>}

      {/* sr-only on a <table> does not shrink it (a table sizes to its content), so it
          widened the page on a phone by 59px; the wrapper is what hides it. */}
      <div className="sr-only">
      <table>
        <caption>Score by week</caption>
        <thead>
          <tr><th>Week</th><th>Dates</th><th>Given</th><th>Done</th><th>On time</th><th>Score</th></tr>
        </thead>
        <tbody>
          {scored.map((w) => (
            <tr key={w.week_start}>
              <td>{w.iso_week}{w.partial ? " (partial)" : ""}</td>
              <td>{rangeLabel(w.from, w.to)}</td>
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
