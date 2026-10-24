import { useMemo, useState } from "react";
import { formatDate } from "@/shared/lib/time";
import { moduleName, projectScore, type Board, type OpenStep } from "./data";

/**
 * "Play it forward" — the viewer ticks their OWN open steps and watches the dial
 * and their rank move before doing the work. The most honest kind of play: every
 * row is real work waiting on them, and nobody else's steps are ever listed.
 *
 *  · Overdue: already counted as missed (0). Closed now it is late: +½.
 *  · Due later this month: not counted yet. Closed on time: +1 step, +1 point.
 */
const PAGE = 8;

export default function WhatIf({
  board,
  onProjection,
}: {
  board: Board;
  onProjection: (p: { score: number; rank: number | null } | null) => void;
}) {
  const me = board.me!;
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [showAll, setShowAll] = useState<{ missed: boolean; upcoming: boolean }>({ missed: false, upcoming: false });

  const steps = board.my_open;
  const overdue = useMemo(() => steps.map((s, i) => ({ s, i })).filter((x) => x.s.outcome === "missed"), [steps]);
  const upcoming = useMemo(() => steps.map((s, i) => ({ s, i })).filter((x) => x.s.outcome === "upcoming"), [steps]);

  const counts = useMemo(() => {
    let o = 0;
    let u = 0;
    for (const i of picked) (steps[i]?.outcome === "missed" ? o++ : u++);
    return { o, u };
  }, [picked, steps]);

  const proj = picked.size ? projectScore(me, board.ladder_scores, counts.o, counts.u) : null;

  const update = (next: Set<number>) => {
    setPicked(next);
    if (!next.size) {
      onProjection(null);
      return;
    }
    let o = 0;
    let u = 0;
    for (const i of next) (steps[i]?.outcome === "missed" ? o++ : u++);
    const p = projectScore(me, board.ladder_scores, o, u);
    onProjection({ score: p.score, rank: p.rank });
  };
  const toggle = (i: number) => {
    const next = new Set(picked);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    update(next);
  };
  const pickAll = (ids: number[]) => update(new Set([...picked, ...ids]));

  const delta = proj ? proj.score - me.score : 0;

  return (
    <section className="rounded-card-lg bg-white border border-line shadow-soft p-5 sm:p-6" aria-labelledby="rank-whatif-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="rank-whatif-title" className="text-[17px] font-bold text-ink">Play it forward</h2>
          <p className="mt-0.5 text-[13.5px] text-grey max-w-[52ch]">
            Tick the steps you could close today and watch your dial move. These are your own open steps, and only yours.
          </p>
        </div>
        <div
          className={
            "rounded-xl px-3 py-2 text-right tabular-nums transition-colors " +
            (proj ? "bg-orange-soft text-ink" : "bg-page text-grey")
          }
          aria-live="polite"
        >
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-grey-2">What-if</div>
          {proj ? (
            <>
              <div className="text-[18px] font-bold leading-none">
                {me.score.toFixed(1)} → {proj.score.toFixed(1)}
                <span className="ml-1 text-[12px] font-semibold text-orange">
                  {delta >= 0 ? "+" : ""}
                  {delta.toFixed(1)}
                </span>
              </div>
              <div className="mt-1 text-[12px] font-semibold">
                {proj.provisional
                  ? `#${proj.rank} provisional · ${proj.given} of 10 steps`
                  : me.ranked && proj.rank !== me.rank
                    ? `#${me.rank} → #${proj.rank}`
                    : `#${proj.rank}`}
              </div>
            </>
          ) : (
            <div className="max-w-[11rem] text-[12.5px] font-semibold leading-tight">Tick a step to see your score move</div>
          )}
        </div>
      </div>

      {steps.length === 0 ? (
        <p className="mt-6 rounded-xl bg-page px-4 py-5 text-[14px] text-grey">
          Nothing is waiting on you this month: every step you were given has been closed. The dial can only
          move now as new steps arrive.
        </p>
      ) : (
        <div className="mt-4 space-y-5">
          <Group
            title="Overdue"
            hint="counting 0 now · closed today earns ½"
            tone="red"
            rows={overdue}
            picked={picked}
            toggle={toggle}
            expanded={showAll.missed}
            onExpand={() => setShowAll((v) => ({ ...v, missed: true }))}
            onPickAll={() => pickAll(overdue.map((x) => x.i))}
          />
          <Group
            title="Due later this month"
            hint="closed on time earns 1"
            tone="green"
            rows={upcoming}
            picked={picked}
            toggle={toggle}
            expanded={showAll.upcoming}
            onExpand={() => setShowAll((v) => ({ ...v, upcoming: true }))}
            onPickAll={() => pickAll(upcoming.map((x) => x.i))}
          />
          {picked.size > 0 && (
            <button
              type="button"
              onClick={() => update(new Set())}
              className="text-[13px] font-semibold text-grey hover:text-ink underline underline-offset-4"
            >
              Clear the what-if
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function Group({
  title,
  hint,
  tone,
  rows,
  picked,
  toggle,
  expanded,
  onExpand,
  onPickAll,
}: {
  title: string;
  hint: string;
  tone: "red" | "green";
  rows: { s: OpenStep; i: number }[];
  picked: Set<number>;
  toggle: (i: number) => void;
  expanded: boolean;
  onExpand: () => void;
  onPickAll: () => void;
}) {
  if (!rows.length) return null;
  const visible = expanded ? rows : rows.slice(0, PAGE);
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-ink">
          <span className={"mr-1.5 inline-block h-2 w-2 rounded-full " + (tone === "red" ? "bg-ryg-red" : "bg-ryg-green")} aria-hidden="true" />
          {title} <span className="text-grey-2 font-normal tabular-nums">({rows.length})</span>
          <span className="ml-2 text-[12px] font-normal text-grey-2">{hint}</span>
        </h3>
        <button type="button" onClick={onPickAll} className="text-[12.5px] font-semibold text-orange hover:underline underline-offset-4">
          Tick all {rows.length}
        </button>
      </div>
      <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
        {visible.map(({ s, i }) => (
          <li key={i}>
            <label className="flex min-h-[44px] cursor-pointer items-center gap-3 px-3 py-2 hover:bg-page">
              <input
                type="checkbox"
                checked={picked.has(i)}
                onChange={() => toggle(i)}
                className="h-4 w-4 shrink-0 accent-[#FF6A1F]"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold text-ink">
                  {s.step} <span className="font-normal text-grey">· {s.ref}</span>
                </span>
                <span className="block truncate text-[12px] text-grey-2">{moduleName(s.module)}</span>
              </span>
              <span className={"shrink-0 text-[12px] tabular-nums " + (tone === "red" ? "text-ryg-red" : "text-grey")}>
                due {formatDate(s.due_date)}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {!expanded && rows.length > PAGE && (
        <button type="button" onClick={onExpand} className="mt-2 text-[12.5px] font-semibold text-grey hover:text-ink underline underline-offset-4">
          Show all {rows.length}
        </button>
      )}
    </div>
  );
}
