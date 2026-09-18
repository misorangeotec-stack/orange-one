import { useRef } from "react";
import { MEDAL, initials, titleCase } from "./Podium";
import { monthLabel, useRankWall } from "./data";

/**
 * Every frozen month's top three, newest first — the employees of the month. A
 * frozen month never changes, so a name on this wall stays on it.
 */
export default function EmployeesWall() {
  const { data, isLoading, error } = useRankWall(true);
  const strip = useRef<HTMLOListElement>(null);
  const scroll = (dir: -1 | 1) => strip.current?.scrollBy({ left: dir * 300, behavior: "smooth" });
  const months = data ?? [];

  return (
    <section className="rounded-card-lg bg-white border border-line shadow-soft p-5 sm:p-6" aria-labelledby="rank-wall-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="rank-wall-title" className="text-[17px] font-bold text-ink">Employees of the month</h2>
        {months.length > 2 && (
          <div className="flex gap-1.5">
            <WallArrow dir={-1} onClick={() => scroll(-1)} />
            <WallArrow dir={1} onClick={() => scroll(1)} />
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="mt-4 h-[164px] rounded-xl bg-page animate-pulse" />
      ) : error ? (
        <p className="mt-4 text-[13.5px] text-ryg-red">Could not load the wall: {(error as Error).message}</p>
      ) : months.length === 0 ? (
        <p className="mt-3 text-[13.5px] text-grey">
          The first employees of the month are named when this month closes. The top three at midnight on the last
          day take the wall.
        </p>
      ) : (
        <ol ref={strip} className="mt-4 flex gap-3 overflow-x-auto snap-x snap-mandatory pb-1 [scrollbar-width:thin]">
          {months.map((m, idx) => (
            <li
              key={m.month}
              className={
                "snap-start shrink-0 rounded-xl border p-4 sm:p-5 " +
                (idx === 0 ? "w-full sm:w-[560px] border-line bg-page/60" : "w-[85%] sm:w-[420px] border-line bg-white")
              }
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[15px] font-bold text-ink">{monthLabel(m.month)}</span>
                <span className="text-[11.5px] text-grey-2">top 3 of {m.ladder_size ?? 0} ranked</span>
              </div>
              <ol className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
                {m.podium.map((p) => {
                  const medal = MEDAL[Math.min(p.rank, 3)];
                  return (
                    <li key={`${p.rank}-${p.name}`} className="min-w-0 flex flex-col items-center text-center">
                      <span
                        className={
                          "grid shrink-0 place-items-center rounded-full font-bold text-white " +
                          (p.rank === 1 ? "h-12 w-12 text-[15px]" : "h-10 w-10 text-[13px]") +
                          (p.is_me ? " ring-[3px] ring-orange ring-offset-2" : "")
                        }
                        style={{ background: "#0B1B40", boxShadow: `inset 0 0 0 3px ${medal.fill}` }}
                        aria-hidden="true"
                      >
                        {initials(p.name)}
                      </span>
                      <span className={"mt-2 w-full truncate text-[13.5px] font-semibold " + (p.is_me ? "text-orange" : "text-ink")} title={p.name}>
                        {p.is_me ? "You" : titleCase(p.name)}
                      </span>
                      <span className="text-[12.5px] font-bold tabular-nums text-ink">{p.score.toFixed(1)}%</span>
                      <span
                        className="mt-2 w-full rounded-t-md pt-1 text-[11px] font-semibold uppercase tracking-[0.06em]"
                        style={{ color: medal.text, borderTop: `3px solid ${medal.fill}`, background: `${medal.fill}14` }}
                      >
                        {medal.label}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function WallArrow({ dir, onClick }: { dir: -1 | 1; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={dir < 0 ? "Earlier months" : "Later months"}
      className="grid h-9 w-9 place-items-center rounded-full border border-line bg-white text-ink hover:border-orange hover:text-orange focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
        <path d={dir < 0 ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
      </svg>
    </button>
  );
}
