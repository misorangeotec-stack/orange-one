import { monthLabel, type Placing } from "./data";

/**
 * The top of the ladder as a podium: 2nd · 1st · 3rd on plinths, then 4th and 5th.
 * Equal scores share a rank, so the "top five" can hold six people — every one of
 * them is shown rather than cutting a tie in half.
 */

/** Plinth tones, muted so they sit with the portal's navy and orange. */
export const MEDAL: Record<number, { fill: string; text: string; label: string }> = {
  // `fill` is the metal; `text` is the same hue darkened to pass 4.5:1 on white,
  // for any number or word written in it.
  1: { fill: "#E0A526", text: "#8A6100", label: "Gold" },
  2: { fill: "#A7B1C2", text: "#56617A", label: "Silver" },
  3: { fill: "#C27C4A", text: "#8C4F23", label: "Bronze" },
};

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

export default function Podium({
  top,
  month,
  isCurrent,
  ladderSize,
}: {
  top: Placing[];
  month: string;
  isCurrent: boolean;
  ladderSize: number;
}) {
  const podium = top.slice(0, 3);
  const rest = top.slice(3);
  // Visual order: 2nd, 1st, 3rd. An empty plinth stays empty rather than collapsing.
  const slots = [podium[1], podium[0], podium[2]];
  const heights = ["h-[76px] sm:h-[92px]", "h-[104px] sm:h-[124px]", "h-[58px] sm:h-[70px]"];

  return (
    <section className="rounded-card-lg bg-white border border-line shadow-soft p-5 sm:p-6" aria-labelledby="rank-top-title">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="rank-top-title" className="text-[13px] font-semibold uppercase tracking-[0.08em] text-grey">
          Top five · {monthLabel(month)}
        </h2>
        <span className="text-[12px] text-grey-2">{ladderSize} on the ladder</span>
      </div>

      {top.length === 0 ? (
        <p className="mt-10 mb-8 text-center text-[14px] text-grey">
          Nobody has reached 10 steps yet{isCurrent ? " this month" : ""}. The first to get there opens the podium.
        </p>
      ) : (
        <>
          <ol className="mt-6 grid grid-cols-3 items-end gap-2 sm:gap-3" aria-label="Podium">
            {slots.map((p, i) => {
              const place = [2, 1, 3][i];
              return (
                <li key={place} className="flex flex-col items-center min-w-0">
                  {p ? (
                    <>
                      <span
                        className={
                          "grid place-items-center rounded-full font-bold text-white " +
                          (place === 1 ? "h-14 w-14 text-[17px]" : "h-11 w-11 text-[14px]") +
                          (p.is_me ? " ring-[3px] ring-orange ring-offset-2" : "")
                        }
                        style={{ background: "#0B1B40", boxShadow: `inset 0 0 0 3px ${MEDAL[place].fill}` }}
                        aria-hidden="true"
                      >
                        {initials(p.name)}
                      </span>
                      <span className="mt-2 w-full truncate text-center text-[13.5px] font-semibold text-ink" title={p.name}>
                        {p.is_me ? "You" : titleCase(p.name)}
                      </span>
                      <span className="text-[13px] font-bold tabular-nums text-ink">{p.score.toFixed(1)}%</span>
                      <span className="text-[11.5px] text-grey-2 tabular-nums">{p.given.toLocaleString("en-IN")} steps</span>
                    </>
                  ) : (
                    <span className="text-[12px] text-grey-2 mb-2">open</span>
                  )}
                  <div
                    className={`mt-2 w-full rounded-t-[10px] ${heights[i]} grid place-items-start justify-center pt-2`}
                    style={{
                      background: p ? `linear-gradient(180deg, ${MEDAL[place].fill}33 0%, ${MEDAL[place].fill}14 100%)` : "#F6F9FD",
                      borderTop: `3px solid ${p ? MEDAL[place].fill : "#E9EEF6"}`,
                    }}
                  >
                    <span className="text-[22px] font-bold tabular-nums" style={{ color: p ? MEDAL[place].text : "#64748B" }}>
                      {p ? p.rank : place}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>

          {rest.length > 0 && (
            <ol className="mt-3 divide-y divide-line border-t border-line">
              {rest.map((p) => (
                <li
                  key={`${p.rank}-${p.name}`}
                  className={"flex items-center gap-3 py-2.5 px-1 " + (p.is_me ? "bg-orange-soft/70 rounded-lg" : "")}
                >
                  <span className="w-6 text-right text-[14px] font-bold tabular-nums text-grey">{p.rank}</span>
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-page text-[12px] font-bold text-ink border border-line" aria-hidden="true">
                    {initials(p.name)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink" title={p.name}>
                    {p.is_me ? "You" : titleCase(p.name)}
                  </span>
                  <span className="text-[12px] text-grey-2 tabular-nums hidden sm:inline">{p.given.toLocaleString("en-IN")} steps</span>
                  <span className="w-14 text-right text-[14px] font-bold tabular-nums text-ink">{p.score.toFixed(1)}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}

/** Some profiles are stored in capitals ("LALIT SHARMA"); show every name the same way. */
export function titleCase(name: string): string {
  return name
    .toLowerCase()
    .split(/(\s+)/)
    .map((w) => (w.trim() ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join("");
}
