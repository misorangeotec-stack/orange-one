import { titleCase } from "./Podium";
import { MIN_STEPS, useRankBoard } from "./data";

/**
 * The viewer's rank in the home screen's greeting banner (CC-1): a small ring with
 * their score, their place, and the distance to the next one. A button — it opens the
 * home screen's Ranking tab.
 *
 * Renders nothing until the ranking has data, so the banner never grows an empty box.
 */
export default function HomeRankChip({ onOpen }: { onOpen: () => void }) {
  const { data: b } = useRankBoard(null);
  if (!b || !b.computed_at) return null;
  const me = b.me;

  let title: string;
  let line: string;
  let score: number | null = null;
  if (me?.ranked) {
    score = Number(me.score);
    title = `#${me.rank} of ${b.ladder_size}`;
    line = !me.gap
      ? "Top of the company"
      : me.gap.draw_level_only
        ? `#${me.gap.above_rank} is on 100%`
        : `${me.gap.steps} on-time step${me.gap.steps === 1 ? "" : "s"} to pass #${me.gap.above_rank}`;
  } else if (me?.not_ranked === "under_minimum") {
    score = Number(me.score);
    title = `${me.given} of ${MIN_STEPS} steps`;
    line = me.provisional_rank != null ? `Provisional #${me.provisional_rank} of ${b.ladder_size + 1}` : "Not on the ladder yet";
  } else {
    // An admin, an excluded login, or nobody with steps yet: show the race instead.
    const lead = b.top[0];
    title = "This month's ranking";
    line = lead ? `#1 ${titleCase(lead.name)} · ${Number(lead.score).toFixed(1)}%` : "See the ladder";
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex items-center gap-3 rounded-2xl border border-white/15 bg-white/[0.07] px-3 py-2 text-left backdrop-blur transition-colors hover:bg-white/[0.13] focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange"
      aria-label={`Your ranking: ${title}. ${line}. Open the ranking.`}
    >
      <MiniRing score={score} />
      <span className="min-w-0">
        <span className="block text-[15px] font-bold leading-tight tabular-nums">{title}</span>
        <span className="block text-[12px] text-white/65 leading-tight mt-0.5">{line}</span>
      </span>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="text-white/50 transition-transform group-hover:translate-x-0.5" aria-hidden="true">
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
  );
}

/** The dial's little sibling: the same 270° sweep, as one arc. */
function MiniRing({ score }: { score: number | null }) {
  const r = 17;
  const circ = 2 * Math.PI * r;
  const track = circ * 0.75;
  const fill = score == null ? 0 : track * Math.max(0, Math.min(100, score)) / 100;
  return (
    <span className="relative grid h-11 w-11 shrink-0 place-items-center">
      <svg viewBox="0 0 44 44" className="absolute inset-0 h-full w-full rotate-[135deg]" aria-hidden="true">
        <circle cx="22" cy="22" r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="4" strokeDasharray={`${track} ${circ}`} strokeLinecap="round" />
        {score != null && (
          <circle cx="22" cy="22" r={r} fill="none" stroke="#FF6A1F" strokeWidth="4" strokeDasharray={`${fill} ${circ}`} strokeLinecap="round" />
        )}
      </svg>
      <span className="relative text-[11.5px] font-bold tabular-nums">
        {score == null ? (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" />
            <path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" />
          </svg>
        ) : (
          Math.round(score)
        )}
      </span>
    </span>
  );
}
