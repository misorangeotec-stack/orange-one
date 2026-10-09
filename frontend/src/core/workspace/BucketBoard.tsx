/**
 * "My FMS buckets" — every FMS the reader has work in, and every bucket (step)
 * inside it, on one board.
 *
 * The tiles above answer "what is due when?". This answers the other question
 * people open each FMS to ask: "what is sitting in my queues?" — undated work,
 * parked work and work due next month included. Each chip is a filter on the list
 * below (FMS + step); clicking the FMS name selects the whole FMS.
 *
 * Built from the same `WorkItem`s as the list, so the board and the list can never
 * disagree about a count.
 */
import { useMemo } from "react";
import { bucketOf } from "@/shared/lib/dueBuckets";
import { cn } from "@/shared/lib/cn";
import type { WorkItem } from "./mywork/types";

interface StageCell {
  stage: string;
  live: number;
  held: number;
  overdue: number;
}
interface SourceCell {
  source: string;
  label: string;
  live: number;
  held: number;
  overdue: number;
  stages: StageCell[];
}

const NO_STAGE = "—";

export default function BucketBoard({
  items,
  today,
  settling,
  selectedSource,
  selectedStage,
  onPick,
}: {
  items: WorkItem[];
  today: string;
  settling: boolean;
  selectedSource: string | null;
  selectedStage: string | null;
  /** `stage` null = the whole FMS. `held` = every row in the pick is parked. */
  onPick: (source: string, stage: string | null, held: boolean) => void;
}) {
  const board = useMemo<SourceCell[]>(() => {
    const bySource = new Map<string, SourceCell & { stageMap: Map<string, StageCell> }>();
    for (const i of items) {
      let s = bySource.get(i.source);
      if (!s) {
        s = { source: i.source, label: i.sourceLabel, live: 0, held: 0, overdue: 0, stages: [], stageMap: new Map() };
        bySource.set(i.source, s);
      }
      const key = i.stage ?? NO_STAGE;
      let st = s.stageMap.get(key);
      if (!st) {
        st = { stage: key, live: 0, held: 0, overdue: 0 };
        s.stageMap.set(key, st);
      }
      if (i.isHeld) {
        s.held++;
        st.held++;
      } else {
        s.live++;
        st.live++;
        if (bucketOf(i.dueIso, today) === "delayed") {
          s.overdue++;
          st.overdue++;
        }
      }
    }
    return [...bySource.values()]
      .map(({ stageMap, ...s }) => ({
        ...s,
        stages: [...stageMap.values()].sort((a, b) => b.overdue - a.overdue || b.live + b.held - (a.live + a.held) || a.stage.localeCompare(b.stage)),
      }))
      .sort((a, b) => b.overdue - a.overdue || b.live - a.live || a.label.localeCompare(b.label));
  }, [items, today]);

  if (board.length === 0) {
    if (!settling) return null;
    return (
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        {[0, 1, 2].map((k) => (
          <div key={k} className="h-[104px] rounded-card border border-line bg-white animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <section>
      <div className="flex flex-wrap items-baseline gap-x-2 mb-2 px-0.5">
        <h2 className="text-[13px] font-semibold text-navy">My FMS buckets</h2>
        <span className="text-[11px] text-grey-2">
          Click an FMS or a bucket to list it below.
          {settling && " Still loading some FMS…"}
        </span>
      </div>
      {/* The same tile, grid and spacing as the Overdue / Due today row above, so the
          two rows read as one dashboard. */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        {board.map((s) => {
          const fmsSelected = selectedSource === s.source && selectedStage == null;
          const anySelected = selectedSource === s.source;
          const late = s.overdue > 0;
          const pickFms = () => onPick(s.source, null, s.live === 0 && s.held > 0);
          return (
            <div
              key={s.source}
              role="button"
              tabIndex={0}
              aria-pressed={fmsSelected}
              onClick={pickFms}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  pickFms();
                }
              }}
              title={`List everything in ${s.label}`}
              className={cn(
                "group relative overflow-hidden cursor-pointer text-left rounded-card border bg-white px-4 py-3.5 transition-all outline-none",
                "hover:-translate-y-0.5 hover:shadow-card focus-visible:ring-2 focus-visible:ring-orange/40",
                anySelected ? "border-transparent ring-2 ring-orange/45 shadow-card" : "border-line"
              )}
            >
              <div
                className={cn(
                  "pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent",
                  late ? "from-ryg-red/10" : s.live > 0 ? "from-navy/[0.06]" : "from-teal/10"
                )}
              />
              <div className="relative flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-grey-2 truncate" title={s.label}>
                    {s.label}
                  </div>
                  <div className={cn("mt-1 text-[30px] leading-none font-bold tabular-nums", late ? "text-ryg-red" : s.live > 0 ? "text-navy" : "text-teal")}>
                    {s.live > 0 ? s.live : s.held}
                  </div>
                  <div className="mt-1.5 text-[11px] text-grey truncate">
                    {late ? `${s.overdue} overdue` : s.live > 0 ? "Open items" : "Parked — not due"}
                    {s.live > 0 && s.held > 0 && <span className="text-teal"> · {s.held} parked</span>}
                  </div>
                </div>
                <span
                  className={cn(
                    "shrink-0 w-8 h-8 rounded-[10px] flex items-center justify-center",
                    late ? "bg-[#FDECEC] text-ryg-red" : s.live > 0 ? "bg-[#EAF0FA] text-navy" : "bg-[#E6F8F6] text-teal"
                  )}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
                  </svg>
                </span>
              </div>

              {/* The buckets (steps) inside this FMS. */}
              <div className="relative mt-2.5 flex flex-wrap gap-1">
                {s.stages.map((st) => {
                  const active = selectedSource === s.source && selectedStage === st.stage;
                  return (
                    <button
                      key={st.stage}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPick(s.source, st.stage, st.live === 0 && st.held > 0);
                      }}
                      aria-pressed={active}
                      title={`${st.stage}: ${st.live} open${st.overdue ? `, ${st.overdue} overdue` : ""}${st.held ? `, ${st.held} parked` : ""}`}
                      className={cn(
                        "max-w-full inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-[11px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-orange/40",
                        active
                          ? "border-orange bg-orange text-white"
                          : st.overdue > 0
                            ? "border-ryg-red/25 bg-white text-navy hover:border-orange"
                            : "border-line bg-white text-navy hover:border-orange"
                      )}
                    >
                      <span className="truncate font-medium">{st.stage}</span>
                      <span className={cn("font-bold tabular-nums", active ? "text-white" : st.overdue > 0 ? "text-ryg-red" : "text-grey")}>
                        {st.live || (st.held ? `+${st.held}` : 0)}
                      </span>
                    </button>
                  );
                })}
              </div>
              {fmsSelected && <div className="absolute bottom-0 inset-x-0 h-[3px] bg-orange" />}
            </div>
          );
        })}
      </div>
    </section>
  );
}
