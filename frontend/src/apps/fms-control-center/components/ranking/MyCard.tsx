import type { ReactNode } from "react";
import ScoreDial from "./ScoreDial";
import { MIN_STEPS, monthLabel, moduleName, type Board, type Me } from "./data";

/**
 * The viewer's own month, on the panel's one dark surface.
 *
 * Every figure is theirs and the server's: score, rank, "ahead of", the gap to the
 * next person, and their own split by process (nobody else's split ever reaches the
 * browser). The dial shows a what-if when the viewer ticks steps in "Play it forward".
 */
export default function MyCard({
  board,
  projection,
  onShowSteps,
}: {
  board: Board;
  projection: { score: number; rank: number | null } | null;
  onShowSteps: () => void;
}) {
  const me = board.me;
  const first = (board.me_name ?? "").split(" ")[0] || "You";

  return (
    <section
      className="relative overflow-hidden rounded-card-lg bg-navy text-white p-5 sm:p-6 shadow-card"
      aria-labelledby="rank-me-title"
    >
      {/* A faint registration mark, the only ornament on the panel. */}
      <svg aria-hidden="true" viewBox="0 0 100 100" className="pointer-events-none absolute -right-14 -bottom-14 w-56 h-56 opacity-[0.06]">
        <circle cx="50" cy="50" r="30" fill="none" stroke="#fff" strokeWidth="1.5" />
        <circle cx="50" cy="50" r="12" fill="none" stroke="#fff" strokeWidth="1.5" />
        <path d="M50 4v92M4 50h92" stroke="#fff" strokeWidth="1.5" />
      </svg>

      <div className="flex items-baseline justify-between gap-3">
        <h2 id="rank-me-title" className="text-[13px] font-semibold uppercase tracking-[0.08em] text-white/60">
          Your {board.is_current ? "month so far" : monthLabel(board.month)}
        </h2>
        {me && me.given > 0 && (
          <button
            type="button"
            onClick={onShowSteps}
            className="text-[12.5px] font-semibold text-orange-2 hover:text-white underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange rounded"
          >
            See my {me.given.toLocaleString("en-IN")} steps
          </button>
        )}
      </div>

      {!me ? (
        <Quiet
          title={`Nothing scored for you in ${monthLabel(board.month)} yet`}
          body="The ranking counts FMS steps given to you: steps you close, and overdue steps waiting on you. When the first one arrives, you will see it here the next morning."
        />
      ) : me.not_ranked === "admin" ? (
        <Quiet
          title="Admins are not ranked"
          body="Admins can act on every step, and one admin login is the testing account, so the ladder leaves them out. You see everyone's full standing further down."
          figures={me}
        />
      ) : me.not_ranked === "excluded" ? (
        <Quiet
          title="This login is not on the ladder"
          body={board.excluded_reason ? `An admin left it out: ${board.excluded_reason}.` : "An admin left it out of the ranking."}
          figures={me}
        />
      ) : me.not_ranked === "external" ? (
        <Quiet title="Customer accounts are not ranked" body="The ranking is for the team running the FMS processes." />
      ) : me.not_ranked === "under_minimum" ? (
        <Warmup me={me} name={first} ladderSize={board.ladder_size} />
      ) : (
        <Ranked board={board} me={me} projection={projection} name={first} />
      )}
    </section>
  );
}

function Ranked({
  board,
  me,
  projection,
  name,
}: {
  board: Board;
  me: Me;
  projection: { score: number; rank: number | null } | null;
  name: string;
}) {
  const rank = me.rank!;
  const shownRank = projection?.rank ?? rank;
  const gap = me.gap;

  let gapLine: ReactNode;
  if (!gap) {
    gapLine = <>Nobody in the company is ahead of you. Keep every step on time to stay there.</>;
  } else if (gap.draw_level_only) {
    // Someone above is on a perfect 100%: they can be drawn level with, never passed.
    // The exact count can run to thousands, which reads as a taunt, so it is given
    // only while it is a number a person could actually close.
    gapLine =
      gap.steps <= 60 ? (
        <>
          #{gap.above_rank} is on a perfect 100%. <strong className="text-white">{gap.steps} more on-time steps</strong>, none
          late, draws you level.
        </>
      ) : (
        <>#{gap.above_rank} is on a perfect 100%. A perfect rest of the month keeps closing the gap.</>
      );
  } else {
    gapLine = (
      <>
        <strong className="text-white">
          {gap.steps.toLocaleString("en-IN")} more on-time step{gap.steps === 1 ? "" : "s"}
        </strong>{" "}
        to pass #{gap.above_rank} ({gap.above_score.toFixed(1)}%).
      </>
    );
  }

  return (
    <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-[minmax(0,236px)_minmax(0,1fr)] sm:items-center">
      <div>
        <ScoreDial
          score={me.score}
          projected={projection?.score ?? null}
          marker={gap ? { score: gap.above_score } : null}
          caption={`of ${me.given.toLocaleString("en-IN")} steps`}
        />
        {gap && (
          <p className="-mt-3 text-center text-[12px] text-white/60">
            <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-white align-middle" aria-hidden="true" />
            #{gap.above_rank} is on {gap.above_score.toFixed(1)}%
          </p>
        )}
      </div>

      <div className="min-w-0">
        <p className="text-[15px] text-white/80">
          {name}, you are
        </p>
        <p className="mt-0.5 flex items-baseline gap-2 flex-wrap">
          <span className="text-[40px] font-bold leading-none tabular-nums">#{shownRank}</span>
          <span className="text-[15px] text-white/70">
            of {board.ladder_size} on the ladder
            {projection?.rank != null && projection.rank !== rank && (
              <span className="ml-1.5 text-orange-2 font-semibold">(now #{rank})</span>
            )}
          </span>
        </p>
        {me.ahead_pct != null && board.ladder_size > 1 && (
          <p className="mt-2 text-[14px] text-white/80">
            Ahead of <strong className="text-white">{me.ahead_pct}%</strong> of the company.
          </p>
        )}
        {board.is_current && <p className="mt-1 text-[14px] text-white/80 leading-snug">{gapLine}</p>}

        <Counts me={me} />
        <Badges board={board} me={me} />
      </div>

      <BySplit me={me} className="sm:col-span-2" />
    </div>
  );
}

/** Under the minimum: how close they are, as ten slots. */
function Warmup({ me, name, ladderSize }: { me: Me; name: string; ladderSize: number }) {
  const left = MIN_STEPS - me.given;
  return (
    <div className="mt-5">
      <p className="text-[22px] font-bold leading-tight">
        {name}, {me.given} of {MIN_STEPS} steps.
      </p>
      <p className="mt-1 text-[14px] text-white/75">
        {left} more step{left === 1 ? "" : "s"} this month and you are on the ladder. Until then your score is
        yours to see and nobody else's.
      </p>
      <ol className="mt-4 grid grid-cols-10 gap-1.5" aria-label={`${me.given} of ${MIN_STEPS} steps`}>
        {Array.from({ length: MIN_STEPS }, (_, i) => (
          <li
            key={i}
            className={
              "h-2.5 rounded-pill " + (i < me.given ? "bg-orange" : "bg-white/15")
            }
          />
        ))}
      </ol>
      <p className="mt-4 text-[14px] text-white/80">
        So far <strong className="text-white tabular-nums">{me.score.toFixed(1)}%</strong>
        {me.provisional_rank != null && (
          <>
            {" "}
            — if the ladder closed today you would be{" "}
            <strong className="text-white tabular-nums">#{me.provisional_rank}</strong> of {ladderSize + 1}. Provisional until
            you reach {MIN_STEPS} steps.
          </>
        )}
        {me.provisional_rank == null && "."}
      </p>
      <Counts me={me} />
      <BySplit me={me} className="mt-4" />
    </div>
  );
}

function Quiet({ title, body, figures }: { title: string; body: string; figures?: Me }) {
  return (
    <div className="mt-5 max-w-[560px]">
      <p className="text-[20px] font-bold leading-snug">{title}</p>
      <p className="mt-1.5 text-[14px] text-white/75 leading-relaxed">{body}</p>
      {figures && figures.given > 0 && (
        <p className="mt-3 text-[13px] text-white/60 tabular-nums">
          For the record: {figures.given} steps, {figures.score.toFixed(1)}%.
        </p>
      )}
    </div>
  );
}

function Counts({ me }: { me: Me }) {
  const items = [
    { label: "On time", value: me.on_time, dot: "bg-ryg-green" },
    { label: "Late", value: me.late, dot: "bg-ryg-yellow" },
    { label: "Missed", value: me.missed, dot: "bg-ryg-red" },
  ];
  return (
    <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${it.dot}`} aria-hidden="true" />
          <dt className="text-[12.5px] text-white/65">{it.label}</dt>
          <dd className="text-[14px] font-semibold tabular-nums">{it.value.toLocaleString("en-IN")}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The viewer's own split by process — never anyone else's. */
function BySplit({ me, className = "" }: { me: Me; className?: string }) {
  const rows = Object.entries(me.by_module).sort((a, b) => b[1].given - a[1].given);
  if (rows.length < 1) return null;
  return (
    <div className={className}>
      <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-white/50">By process</h3>
      <ul className="mt-2 space-y-2">
        {rows.map(([key, s]) => (
          <li key={key} className="grid grid-cols-[minmax(0,9.5rem)_1fr_3.2rem] items-center gap-3">
            <span className="text-[13px] text-white/85 truncate" title={moduleName(key)}>
              {moduleName(key)}
            </span>
            <span className="flex h-2 rounded-pill overflow-hidden bg-white/10" aria-hidden="true">
              <span className="bg-ryg-green" style={{ width: `${(s.on_time / s.given) * 100}%` }} />
              <span className="bg-ryg-yellow" style={{ width: `${(s.late / s.given) * 100}%` }} />
              <span className="bg-ryg-red" style={{ width: `${(s.missed / s.given) * 100}%` }} />
            </span>
            <span className="text-right text-[13px] font-semibold tabular-nums" title={`${s.given} steps`}>
              {Number(s.score).toFixed(1)}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[12px] text-white/45">
        A missed step shared by several owners counts against each of them.
      </p>
    </div>
  );
}

/** Earned from the viewer's own figures only. */
function Badges({ board, me }: { board: Board; me: Me }) {
  const earned: { key: string; label: string; icon: ReactNode }[] = [];
  if (me.ranked && me.score >= 100) earned.push({ key: "perfect", label: board.is_current ? "Perfect so far" : "Perfect month", icon: <IconStar /> });
  if (me.ranked && me.rank! <= 3) earned.push({ key: "podium", label: "On the podium", icon: <IconMedal /> });
  if (me.given >= MIN_STEPS && me.missed === 0) earned.push({ key: "clean", label: "Nothing missed", icon: <IconCheck /> });
  const prev = [...board.my_history].filter((h) => h.month < board.month && h.ranked).pop();
  if (me.ranked && prev && me.score - prev.score >= 5) {
    earned.push({
      key: "climb",
      label: `Up ${(me.score - prev.score).toFixed(1)} on ${monthLabel(prev.month, true)}`,
      icon: <IconUp />,
    });
  }
  if (board.eotm?.podium.some((p) => p.is_me)) {
    earned.push({ key: "eotm", label: `Employee of the month, ${monthLabel(board.eotm.month, true)}`, icon: <IconMedal /> });
  }
  if (!earned.length) return null;
  return (
    <ul className="mt-4 flex flex-wrap gap-2" aria-label="Badges">
      {earned.map((b) => (
        <li
          key={b.key}
          className="inline-flex items-center gap-1.5 rounded-pill bg-white/10 border border-white/15 px-2.5 py-1 text-[12px] font-semibold"
        >
          <span className="text-orange-2">{b.icon}</span>
          {b.label}
        </li>
      ))}
    </ul>
  );
}

const svgProps = { viewBox: "0 0 24 24", width: 14, height: 14, fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
const IconStar = () => (
  <svg {...svgProps}>
    <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />
  </svg>
);
const IconMedal = () => (
  <svg {...svgProps}>
    <circle cx="12" cy="15" r="5" />
    <path d="M8.5 11 6 3h4l2 5 2-5h4l-2.5 8" />
  </svg>
);
const IconCheck = () => (
  <svg {...svgProps}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
const IconUp = () => (
  <svg {...svgProps}>
    <path d="M4 17l6-6 4 4 6-7" />
    <path d="M14 8h6v6" />
  </svg>
);
