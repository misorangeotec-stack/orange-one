import { formatDate } from "@/shared/lib/time";
import { monthLabel, type Board } from "./data";

/**
 * The viewer's month night by night, and their months side by side.
 *
 * The trend is one point per nightly run (`fms_rank_history`), so it starts on the
 * night the ranking starts and fills in from there — it is never back-filled with a
 * guess.
 */
export default function MonthSoFar({ board }: { board: Board }) {
  const trend = board.my_trend;
  const history = board.my_history;

  return (
    <section className="rounded-card-lg bg-white border border-line shadow-soft p-5 sm:p-6" aria-labelledby="rank-trend-title">
      <h2 id="rank-trend-title" className="text-[17px] font-bold text-ink">
        {board.is_current ? "Your month so far" : `Your ${monthLabel(board.month)}`}
      </h2>

      {trend.length >= 2 ? (
        <Spark points={trend} />
      ) : (
        <p className="mt-3 rounded-xl bg-page px-4 py-4 text-[13.5px] text-grey">
          {trend.length === 1
            ? `One reading so far: ${trend[0].score.toFixed(1)}% on ${formatDate(trend[0].as_of)}. The line draws itself from the next night on.`
            : "Your line starts with the first nightly run and grows a point every night."}
        </p>
      )}

      <h3 className="mt-6 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-grey">Month by month</h3>
      {history.length === 0 ? (
        <p className="mt-2 text-[13.5px] text-grey">Your first month on record appears here.</p>
      ) : (
        <ol className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {history.map((h) => (
            <li
              key={h.month}
              className={
                "rounded-xl border px-3 py-2.5 " + (h.month === board.month ? "border-orange bg-orange-soft/60" : "border-line bg-white")
              }
            >
              <div className="text-[12px] text-grey">
                {monthLabel(h.month, true)}
                {h.frozen && (
                  <span className="ml-1 text-grey-2" title="Final — frozen at the month's end">
                    · final
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[18px] font-bold tabular-nums text-ink">{Number(h.score).toFixed(1)}%</div>
              <div className="text-[12px] text-grey tabular-nums">
                {h.ranked ? `#${h.rank} of ${h.ladder_size ?? "?"}` : `${h.given} step${h.given === 1 ? "" : "s"} · not ranked`}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Spark({ points }: { points: Board["my_trend"] }) {
  const W = 320;
  const H = 96;
  const pad = 8;
  const scores = points.map((p) => Number(p.score));
  const lo = Math.max(0, Math.min(...scores) - 5);
  const hi = Math.min(100, Math.max(...scores) + 5);
  const x = (i: number) => pad + (i / (points.length - 1)) * (W - pad * 2);
  const y = (s: number) => H - pad - ((s - lo) / Math.max(1, hi - lo)) * (H - pad * 2);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(Number(p.score)).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  return (
    <figure className="mt-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`Score by night, ${scores[0].toFixed(1)} to ${scores[scores.length - 1].toFixed(1)}`}>
        <path d={`${d} L${x(points.length - 1)},${H - pad} L${x(0)},${H - pad} Z`} fill="#FFF1E8" />
        <path d={d} fill="none" stroke="#FF6A1F" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(points.length - 1)} cy={y(Number(last.score))} r={4} fill="#FF6A1F" />
      </svg>
      <figcaption className="mt-1 flex justify-between text-[12px] text-grey tabular-nums">
        <span>{formatDate(points[0].as_of)}</span>
        <span>
          {Number(last.score).toFixed(1)}%{last.rank ? ` · #${last.rank}` : ""} on {formatDate(last.as_of)}
        </span>
      </figcaption>
    </figure>
  );
}
