/**
 * "My Work Today" — the home screen.
 *
 * This replaced a grid of app cards. The cards told a user which apps existed;
 * they never told them what to do. The one question this screen has to answer,
 * within a second of opening, is "what do I owe today?" — with every row a link
 * straight to the thing itself.
 *
 * WHERE THE NUMBERS COME FROM: each module contributes a provider
 * (mywork/registry.ts) returning its own open work for THIS user. Providers hand
 * back raw `dueIso` values and never bucket; bucketing happens here, once, using
 * `todayLocalIso` — the local-time definition of today. The other definition in
 * the codebase (`shared/lib/time.ts#todayIso`) is UTC, which in IST reports every
 * due-today item as overdue until 05:30. Do not use it here.
 *
 * ON THE TOTALS: FMS sources count (step, entity) work-items — one PO genuinely
 * sitting in two queues is two things to do — while tasks and follow-ups count
 * records. The tiles say "work items" and the per-source strip stays visible so
 * the mix is legible. Deduping across sources would be wrong AND would make this
 * screen disagree with the FMS Control Center.
 *
 * ON THE KPI TILES: they are FILTERS, not just readouts. Their counts therefore
 * reflect every filter EXCEPT the bucket selection itself — otherwise clicking
 * "Overdue" would zero the other three tiles and you could never get back.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import EmptyState from "@/shared/components/ui/EmptyState";
import DueCell from "@/shared/components/ui/DueCell";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import ActiveFilters, { type ActiveFilter } from "@/shared/components/ui/ActiveFilters";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import Pagination from "@/shared/components/ui/Pagination";
import { usePagination } from "@/shared/lib/usePagination";
import { matchesSearch } from "@/shared/lib/search";
import { bucketOf, todayLocalIso, type Bucket } from "@/shared/lib/dueBuckets";
import { useSession } from "@/core/platform/session";
import { cn } from "@/shared/lib/cn";
import { useMyWork, type AggregateState } from "./mywork/MyWorkAggregator";
import type { WorkItem } from "./mywork/types";

/** Sort weight per bucket: most urgent first, undated last. */
const BUCKET_RANK: Record<Bucket, number> = { delayed: 0, today: 1, tomorrow: 2, dayAfter: 3, noDate: 4 };
const LATER_RANK = 3.5; // bucketOf() returns null beyond the day after — real work, just not in a tile

type SortKey = "urgency" | "ref" | "source" | "stage" | "due";
type SortDir = "asc" | "desc";

const GROUP_KEY = "orangeone.home.groupBySource";
const EXPANDED_KEY = "orangeone.home.expandedSources";
const SCOPE_KEY = "orangeone.home.scope";

function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota — a view preference is never load-bearing */
  }
}

const SORTS: { value: SortKey; label: string }[] = [
  { value: "urgency", label: "Urgency" },
  { value: "due", label: "Due date" },
  { value: "ref", label: "Reference" },
  { value: "source", label: "Source" },
  { value: "stage", label: "Stage" },
];

interface Tile {
  bucket: Bucket;
  label: string;
  hint: string;
  tone: "red" | "amber" | "blue" | "grey";
  icon: React.ReactNode;
}

const TILES: Tile[] = [
  { bucket: "delayed", label: "Overdue", hint: "Past its due date", tone: "red", icon: <IconAlert /> },
  { bucket: "today", label: "Due today", hint: "Needs closing today", tone: "amber", icon: <IconClock /> },
  { bucket: "tomorrow", label: "Next 2 days", hint: "Tomorrow + day after", tone: "blue", icon: <IconHorizon /> },
  { bucket: "noDate", label: "No date set", hint: "Untimed work", tone: "grey", icon: <IconInfinity /> },
];

const TONE: Record<Tile["tone"], { ring: string; chip: string; value: string; glow: string }> = {
  red: { ring: "ring-ryg-red/45", chip: "bg-[#FDECEC] text-ryg-red", value: "text-ryg-red", glow: "from-ryg-red/10" },
  amber: { ring: "ring-yellow/45", chip: "bg-[#FFF7E6] text-yellow", value: "text-navy", glow: "from-yellow/10" },
  blue: { ring: "ring-navy/25", chip: "bg-[#EAF0FA] text-navy", value: "text-navy", glow: "from-navy/[0.07]" },
  grey: { ring: "ring-grey-2/30", chip: "bg-page text-grey-2", value: "text-grey", glow: "from-grey-2/[0.07]" },
};

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

const longDate = () =>
  new Date().toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "short", year: "numeric" });

/** "Next 2 days" is one tile covering two buckets. */
const inTile = (bucket: Bucket | null, tile: Bucket) =>
  tile === "tomorrow" ? bucket === "tomorrow" || bucket === "dayAfter" : bucket === tile;

export default function MyWorkToday() {
  const { state, probes } = useMyWork();
  return (
    <>
      {/* Probes render nothing — they are what actually fetch each source. */}
      {probes}
      <MyWorkView state={state} />
    </>
  );
}

/**
 * The screen itself, given already-aggregated work. Split from the data fetch so
 * it can be rendered against fixed input — the layout has enough branching
 * (loading, empty, filtered-empty, admin) that it is worth being able to see each
 * state without arranging live data to produce it.
 */
export function MyWorkView({ state }: { state: AggregateState }) {
  const { user, isAdmin } = useSession();
  const today = todayLocalIso();

  const [bucketFilter, setBucketFilter] = useState<Bucket | null>(null);
  const [sources, setSources] = useState<string[]>([]);
  const [stages, setStages] = useState<string[]>([]);
  const [assignment, setAssignment] = useState<string[]>([]);
  const [q, setQ] = useState("");

  // Admins receive the whole book (they own no workflow steps, so a strict
  // personal filter would otherwise leave them empty). This tab lets them narrow
  // to just what is theirs — the default — and switch back to the full view.
  // Non-admins are already scoped to their own work by each provider, so the tab
  // is hidden for them and scope is pinned to "all" (a no-op on their data).
  const [scope, setScope] = useState<"mine" | "all">(() =>
    isAdmin ? readPref(SCOPE_KEY, "mine") : "all"
  );
  const setScopePref = (s: "mine" | "all") => {
    setScope(s);
    writePref(SCOPE_KEY, s);
    if (s === "mine") setAssignment([]); // drop any stale You/Team chip
  };
  const [sort, setSort] = useState<SortKey>("urgency");
  const [dir, setDir] = useState<SortDir>("asc");

  // Grouping is a persisted preference: which sources you care to see open is a
  // stable habit, not a per-visit decision.
  const [groupBySource, setGroupBySource] = useState<boolean>(() => readPref(GROUP_KEY, true));
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(readPref<string[]>(EXPANDED_KEY, [])));

  const setGrouping = (on: boolean) => {
    setGroupBySource(on);
    writePref(GROUP_KEY, on);
  };
  const toggleSource = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writePref(EXPANDED_KEY, [...next]);
      return next;
    });

  // Every item, tagged with its bucket once.
  const tagged = useMemo(
    () => state.items.map((item) => ({ item, bucket: bucketOf(item.dueIso, today) })),
    [state.items, today]
  );

  // Everything EXCEPT the bucket filter — this is what the tiles count, so
  // selecting a tile never blanks the others.
  const preBucket = useMemo(
    () =>
      tagged.filter(({ item }) => {
        if (scope === "mine" && item.assignment !== "direct") return false;
        if (sources.length && !sources.includes(item.source)) return false;
        if (stages.length && !stages.includes(item.stage ?? "—")) return false;
        if (assignment.length && !assignment.includes(item.assignment)) return false;
        if (q && !matchesSearch(q, item.ref, item.detail, item.sourceLabel, item.stage)) return false;
        return true;
      }),
    [tagged, scope, sources, stages, assignment, q]
  );

  const counts = useMemo(() => {
    const c: Record<Bucket, number> = { delayed: 0, today: 0, tomorrow: 0, dayAfter: 0, noDate: 0 };
    for (const { bucket } of preBucket) if (bucket) c[bucket]++;
    return c;
  }, [preBucket]);

  const tileCount = (t: Bucket) => (t === "tomorrow" ? counts.tomorrow + counts.dayAfter : counts[t]);

  // In Mine mode the "N of M items" denominator should be the scoped total, not
  // the whole book — otherwise an admin sees "3 of 250".
  const scopedTotal = useMemo(
    () => (scope === "mine" ? tagged.filter((t) => t.item.assignment === "direct").length : state.items.length),
    [tagged, scope, state.items.length]
  );

  const rows = useMemo(() => {
    const filtered = bucketFilter ? preBucket.filter((r) => inTile(r.bucket, bucketFilter)) : preBucket;
    const sign = dir === "asc" ? 1 : -1;
    const rank = (b: Bucket | null) => (b ? BUCKET_RANK[b] : LATER_RANK);

    return [...filtered]
      .sort((a, b) => {
        switch (sort) {
          case "ref":
            return sign * a.item.ref.localeCompare(b.item.ref);
          case "source":
            return sign * a.item.sourceLabel.localeCompare(b.item.sourceLabel);
          case "stage":
            return sign * (a.item.stage ?? "").localeCompare(b.item.stage ?? "");
          case "due":
            // Undated always sinks, whichever direction — "no date" is not "far future".
            if (!a.item.dueIso !== !b.item.dueIso) return a.item.dueIso ? -1 : 1;
            return sign * (a.item.dueIso ?? "").localeCompare(b.item.dueIso ?? "");
          default: {
            const d = rank(a.bucket) - rank(b.bucket);
            if (d) return sign * d;
            // Within a bucket: yours before the team's, then soonest first.
            if (a.item.assignment !== b.item.assignment) return a.item.assignment === "direct" ? -1 : 1;
            return (a.item.dueIso ?? "9999").localeCompare(b.item.dueIso ?? "9999");
          }
        }
      })
      .map((r) => r.item);
  }, [preBucket, bucketFilter, sort, dir]);

  const approvals = useMemo(() => rows.filter((i) => i.isApproval), [rows]);

  const sourceOptions = useMemo(
    () =>
      [...new Map(state.items.map((i) => [i.source, i.sourceLabel])).entries()]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [state.items]
  );
  const stageOptions = useMemo(
    () =>
      [...new Set(state.items.map((i) => i.stage ?? "—"))].sort().map((s) => ({ value: s, label: s })),
    [state.items]
  );

  /**
   * Source groups, worst-first: whichever source is holding the most overdue work
   * sorts to the top, so a collapsed list still leads with the problem.
   */
  const groups = useMemo(() => {
    if (!groupBySource) return [];
    const byKey = new Map<string, { key: string; label: string; items: WorkItem[]; overdue: number }>();
    for (const item of rows) {
      let g = byKey.get(item.source);
      if (!g) {
        g = { key: item.source, label: item.sourceLabel, items: [], overdue: 0 };
        byKey.set(item.source, g);
      }
      g.items.push(item);
      if (bucketOf(item.dueIso, today) === "delayed") g.overdue++;
    }
    return [...byKey.values()].sort(
      (a, b) => b.overdue - a.overdue || b.items.length - a.items.length || a.label.localeCompare(b.label)
    );
  }, [rows, groupBySource, today]);

  // Only EXPANDED groups contribute rows to the page, so pagination still bounds
  // what renders (the 25/page rule) while collapsed groups cost one header each.
  const paginated = useMemo(
    () => (groupBySource ? groups.filter((g) => expanded.has(g.key)).flatMap((g) => g.items) : rows),
    [groupBySource, groups, expanded, rows]
  );

  const pg = usePagination(paginated);
  const pageIds = useMemo(() => new Set(pg.pageItems.map((i) => i.id)), [pg.pageItems]);
  const pending = counts.delayed + counts.today;

  const activeFilters: ActiveFilter[] = [
    ...(bucketFilter
      ? [{ key: "bucket", label: `Due: ${TILES.find((t) => t.bucket === bucketFilter)?.label}`, onClear: () => setBucketFilter(null) }]
      : []),
    ...sources.map((s) => ({
      key: `src-${s}`,
      label: `Source: ${sourceOptions.find((o) => o.value === s)?.label ?? s}`,
      onClear: () => setSources((prev) => prev.filter((x) => x !== s)),
    })),
    ...stages.map((s) => ({
      key: `stg-${s}`,
      label: `Stage: ${s}`,
      onClear: () => setStages((prev) => prev.filter((x) => x !== s)),
    })),
    ...assignment.map((a) => ({
      key: `asg-${a}`,
      label: a === "direct" ? "Assigned: You" : "Assigned: Team",
      onClear: () => setAssignment((prev) => prev.filter((x) => x !== a)),
    })),
    ...(q ? [{ key: "q", label: `Search: ${q}`, onClear: () => setQ("") }] : []),
  ];

  const clearAll = () => {
    setBucketFilter(null);
    setSources([]);
    setStages([]);
    setAssignment([]);
    setQ("");
  };

  const toggleSort = (key: SortKey) => {
    if (sort === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setDir("asc");
    }
  };

  return (
    <div className="space-y-4">
      <Hero
        greeting={greeting()}
        name={(user?.name ?? "").split(" ")[0] || "there"}
        date={longDate()}
        overdue={counts.delayed}
        dueToday={counts.today}
        pending={pending}
        settling={state.isSettling}
        isAdmin={isAdmin}
        scope={scope}
        onScopeChange={setScopePref}
      />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {TILES.map((t) => (
          <KpiTile
            key={t.bucket}
            tile={t}
            count={tileCount(t.bucket)}
            loading={state.isSettling && tileCount(t.bucket) === 0}
            selected={bucketFilter === t.bucket}
            onClick={() => setBucketFilter((cur) => (cur === t.bucket ? null : t.bucket))}
          />
        ))}
      </div>

      {approvals.length > 0 && <ApprovalStrip items={approvals} />}

      <Card className="overflow-hidden">
        <div className="px-4 pt-4 pb-3 border-b border-line space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div>
              <h2 className="text-[15px] font-semibold text-navy leading-tight">My work</h2>
              <p className="text-[11.5px] text-grey-2">
                {rows.length} of {scopedTotal} item{scopedTotal === 1 ? "" : "s"}
                {state.isSettling && " · still loading some sources"}
              </p>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <GroupToggle on={groupBySource} onChange={setGrouping} />
              <SortControl sort={sort} dir={dir} onSort={setSort} onDir={setDir} />
            </div>
          </div>

          <ActiveFilters filters={activeFilters} onClearAll={clearAll} />
        </div>

        <ScrollableTable>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line bg-page/60">
                <Th sortKey="source" active={sort} dir={dir} onSort={toggleSort}>Source</Th>
                <Th sortKey="ref" active={sort} dir={dir} onSort={toggleSort}>Reference</Th>
                <Th sortKey="stage" active={sort} dir={dir} onSort={toggleSort}>Stage</Th>
                <Th sortKey="due" active={sort} dir={dir} onSort={toggleSort}>Due</Th>
                <Th>Assigned</Th>
              </tr>
              {/* Filter row, one control per column so each sits over the data it
                  narrows. Lives inside <thead> rather than in the toolbar above:
                  floated up there nothing lined up with its column. */}
              <tr className="border-b border-line bg-page/30">
                <FilterCell>
                  <MultiSelect
                    values={sources}
                    onChange={setSources}
                    options={sourceOptions}
                    placeholder="All sources"
                    className="w-full"
                  />
                </FilterCell>
                <FilterCell>
                  <SearchBox value={q} onChange={setQ} />
                </FilterCell>
                <FilterCell>
                  <MultiSelect
                    values={stages}
                    onChange={setStages}
                    options={stageOptions}
                    placeholder="All stages"
                    className="w-full"
                  />
                </FilterCell>
                {/* Due is filtered by the KPI tiles above — a second control here
                    would be two ways to set one thing. */}
                <FilterCell />
                <FilterCell>
                  {/* Redundant in Mine mode — everything shown is already yours. */}
                  {scope === "all" && (
                    <MultiSelect
                      values={assignment}
                      onChange={setAssignment}
                      options={[
                        { value: "direct", label: "You" },
                        { value: "team", label: "Your team" },
                      ]}
                      placeholder="Anyone"
                      className="w-full"
                    />
                  )}
                </FilterCell>
              </tr>
            </thead>
            <tbody>
              {rows.length > 0 ? (
                groupBySource ? (
                  groups.map((g) => (
                    <SourceGroup
                      key={g.key}
                      group={g}
                      open={expanded.has(g.key)}
                      onToggle={() => toggleSource(g.key)}
                      pageIds={pageIds}
                      today={today}
                    />
                  ))
                ) : (
                  pg.pageItems.map((item) => <WorkRow key={item.id} item={item} today={today} />)
                )
              ) : (
                // Kept inside the table so the filter row stays on screen — an
                // empty state that hides the filters strands the reader.
                <tr>
                  <td colSpan={5}>
                    {state.isSettling ? (
                      <SkeletonRows />
                    ) : activeFilters.length > 0 ? (
                      <EmptyState
                        title="Nothing matches these filters"
                        message="Try clearing a filter to widen the list."
                        actionLabel="Clear all filters"
                        onAction={clearAll}
                      />
                    ) : scope === "mine" ? (
                      <EmptyState
                        title="Nothing assigned to you personally"
                        message="No tasks, approvals or workflow steps are on your plate right now."
                        actionLabel="Show all work"
                        onAction={() => setScopePref("all")}
                      />
                    ) : (
                      <EmptyState
                        title="Nothing on your plate"
                        message="No open tasks, approvals or workflow steps are assigned to you right now."
                      />
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </ScrollableTable>

        {paginated.length > 0 && (
          <div className="px-4 py-3 border-t border-line">
            <Pagination state={pg} rowsLabel="items" />
          </div>
        )}
      </Card>

      {/* An all-work readout — its raw per-source counts are unscoped, so hide it
          in Mine mode to keep the screen self-consistent. */}
      {scope === "all" && <SourceStrip sources={state.sources} hasStepUnits={state.hasStepUnits} />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Hero({
  greeting,
  name,
  date,
  overdue,
  dueToday,
  pending,
  settling,
  isAdmin,
  scope,
  onScopeChange,
}: {
  greeting: string;
  name: string;
  date: string;
  overdue: number;
  dueToday: number;
  pending: number;
  settling: boolean;
  isAdmin: boolean;
  scope: "mine" | "all";
  onScopeChange: (s: "mine" | "all") => void;
}) {
  return (
    <div className="relative overflow-hidden rounded-card bg-navy text-white px-5 py-5 sm:px-6 sm:py-6">
      {/* Warm corner wash — brand orange, kept subtle so the text stays first. */}
      <div className="pointer-events-none absolute -top-24 -right-16 w-80 h-80 rounded-full bg-orange/25 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-navy via-navy/95 to-transparent" />

      <div className="relative flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12px] font-medium text-white/55">{date}</p>
          <h1 className="text-[24px] sm:text-[27px] font-bold tracking-tight mt-0.5">
            {greeting}, {name}
          </h1>
          <p className="text-[13.5px] text-white/75 mt-1.5">
            {settling ? (
              "Gathering your work…"
            ) : pending === 0 ? (
              "Nothing is due today. You're clear."
            ) : (
              <>
                You have{" "}
                <span className="font-semibold text-white">
                  {pending} thing{pending === 1 ? "" : "s"}
                </span>{" "}
                to deal with today.
              </>
            )}
            {isAdmin && (
              <span className="ml-1.5 text-white/45">
                {scope === "mine" ? "Showing your work." : "Showing all work (admin)."}
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          {isAdmin && <ScopeTabs scope={scope} onChange={onScopeChange} />}
          {!settling && pending > 0 && (
            <div className="flex items-center gap-2">
              {overdue > 0 && <HeroPill tone="red" value={overdue} label={overdue === 1 ? "overdue" : "overdue"} />}
              {dueToday > 0 && <HeroPill tone="amber" value={dueToday} label="due today" />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HeroPill({ tone, value, label }: { tone: "red" | "amber"; value: number; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1.5 rounded-pill px-3 py-1.5 text-[12.5px] font-semibold backdrop-blur",
        tone === "red" ? "bg-ryg-red/20 text-[#ffb4ac]" : "bg-yellow/20 text-[#ffd98a]"
      )}
    >
      <span className="text-[15px] font-bold tabular-nums">{value}</span>
      {label}
    </span>
  );
}

/** Admin-only scope switch in the banner: personal work vs. the whole book. */
function ScopeTabs({ scope, onChange }: { scope: "mine" | "all"; onChange: (s: "mine" | "all") => void }) {
  const tabs: { value: "mine" | "all"; label: string }[] = [
    { value: "mine", label: "My work" },
    { value: "all", label: "All work" },
  ];
  return (
    <div className="inline-flex items-center rounded-pill bg-white/10 p-0.5 backdrop-blur">
      {tabs.map((t) => {
        const active = scope === t.value;
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => onChange(t.value)}
            aria-pressed={active}
            className={cn(
              "rounded-pill px-3 py-1 text-[12px] font-semibold transition-colors",
              active ? "bg-white text-navy" : "text-white/70 hover:text-white"
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function KpiTile({
  tile,
  count,
  loading,
  selected,
  onClick,
}: {
  tile: Tile;
  count: number;
  loading: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  const tone = TONE[tile.tone];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={selected ? `Showing only ${tile.label.toLowerCase()} — click to clear` : `Show only ${tile.label.toLowerCase()}`}
      className={cn(
        "group relative overflow-hidden text-left rounded-card border bg-white px-4 py-3.5 transition-all",
        "hover:-translate-y-0.5 hover:shadow-card",
        selected ? cn("border-transparent ring-2 shadow-card", tone.ring) : "border-line"
      )}
    >
      <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent opacity-0 transition-opacity", tone.glow, (selected || count > 0) && "opacity-100")} />
      <div className="relative flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">{tile.label}</div>
          <div className={cn("mt-1 text-[30px] leading-none font-bold tabular-nums", count > 0 ? tone.value : "text-grey-2/50")}>
            {loading ? <span className="inline-block h-[26px] w-10 rounded bg-line/80 animate-pulse align-middle" /> : count}
          </div>
          <div className="mt-1.5 text-[11px] text-grey truncate">{tile.hint}</div>
        </div>
        <span className={cn("shrink-0 w-8 h-8 rounded-[10px] flex items-center justify-center [&>svg]:w-4 [&>svg]:h-4", tone.chip)}>
          {tile.icon}
        </span>
      </div>
      {selected && <div className="absolute bottom-0 inset-x-0 h-[3px] bg-orange" />}
    </button>
  );
}

/** Approvals are the thing people most often miss, so they sit above the list. */
function ApprovalStrip({ items }: { items: WorkItem[] }) {
  return (
    <Card className="p-4 border-orange/30 bg-orange-soft/25">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="w-6 h-6 rounded-lg bg-orange text-white flex items-center justify-center [&>svg]:w-3.5 [&>svg]:h-3.5">
          <IconStamp />
        </span>
        <h2 className="text-[13.5px] font-semibold text-navy">Waiting for your approval</h2>
        <span className="text-[11px] font-bold text-orange bg-white rounded-full px-2 py-0.5 tabular-nums">
          {items.length}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.slice(0, 8).map((item) => (
          <Link
            key={item.id}
            to={item.to}
            className="group inline-flex items-center gap-2 bg-white border border-line rounded-xl px-3 py-2 hover:border-orange hover:shadow-soft transition"
          >
            <span className="text-[13px] font-semibold text-navy group-hover:text-orange transition-colors">
              {item.ref}
            </span>
            <span className="text-[11px] text-grey-2">{item.sourceLabel}</span>
            <span className="text-[11px]">
              <DueCell dueIso={item.dueIso} />
            </span>
          </Link>
        ))}
        {items.length > 8 && (
          <span className="inline-flex items-center text-[12px] text-grey-2 px-1">+{items.length - 8} more below</span>
        )}
      </div>
    </Card>
  );
}

/** A collapsible source block. Collapsed by default — the header alone tells you
 *  whether it needs opening. */
function SourceGroup({
  group,
  open,
  onToggle,
  pageIds,
  today,
}: {
  group: { key: string; label: string; items: WorkItem[]; overdue: number };
  open: boolean;
  onToggle: () => void;
  pageIds: Set<string>;
  today: string;
}) {
  // Only the slice of this group that landed on the current page renders.
  const visible = open ? group.items.filter((i) => pageIds.has(i.id)) : [];
  return (
    <>
      <tr className="border-b border-line bg-page/50">
        <td colSpan={5} className="px-0 py-0">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-orange-soft/25 transition-colors"
          >
            <svg
              width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
              className={cn("shrink-0 text-grey-2 transition-transform duration-200", open && "rotate-90")}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <span className="text-[13px] font-semibold text-navy">{group.label}</span>
            <span className="text-[11px] font-medium text-grey-2 tabular-nums">
              {group.items.length} item{group.items.length === 1 ? "" : "s"}
            </span>
            {group.overdue > 0 && (
              <span className="text-[10px] font-bold uppercase tracking-wide bg-[#FDECEC] text-ryg-red rounded-full px-2 py-0.5 tabular-nums">
                {group.overdue} overdue
              </span>
            )}
            <span className="ml-auto text-[11px] text-grey-2">{open ? "Hide" : "Show"}</span>
          </button>
        </td>
      </tr>
      {visible.map((item) => (
        <WorkRow key={item.id} item={item} today={today} grouped />
      ))}
      {open && visible.length === 0 && (
        <tr className="border-b border-line">
          <td colSpan={5} className="px-4 py-3 text-[12px] text-grey-2">
            Nothing from this source on this page — check the other pages.
          </td>
        </tr>
      )}
    </>
  );
}

function WorkRow({ item, today, grouped }: { item: WorkItem; today: string; grouped?: boolean }) {
  const bucket = bucketOf(item.dueIso, today);
  const accent =
    bucket === "delayed" ? "before:bg-ryg-red" : bucket === "today" ? "before:bg-yellow" : "before:bg-transparent";
  return (
    <tr
      className={cn(
        "group border-b border-line last:border-0 transition-colors hover:bg-orange-soft/20",
        bucket === "delayed" && "bg-[#FDECEC]/35"
      )}
    >
      <td
        className={cn(
          "relative px-4 py-3 text-[12.5px] text-grey whitespace-nowrap before:absolute before:left-0 before:top-0 before:h-full before:w-[3px]",
          accent
        )}
      >
        {/* Inside a group the source is already on the header — indent instead of
            repeating it on every row. */}
        {grouped ? <span className="pl-4 text-grey-2/70">↳</span> : item.sourceLabel}
      </td>
      <td className="px-4 py-3">
        <Link to={item.to} className="text-[13.5px] font-medium text-navy group-hover:text-orange transition-colors">
          {item.ref}
        </Link>
        {item.detail && <div className="text-[11.5px] text-grey-2 truncate max-w-[340px]">{item.detail}</div>}
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        {item.stage ? (
          <span className="text-[11.5px] font-medium text-navy bg-page border border-line rounded-pill px-2 py-0.5">
            {item.stage}
          </span>
        ) : (
          <span className="text-grey-2">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-[12.5px] whitespace-nowrap">
        <DueCell dueIso={item.dueIso} />
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <span
          className={cn(
            "text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5",
            item.assignment === "direct" ? "bg-orange-soft text-orange" : "bg-page text-grey-2 border border-line"
          )}
        >
          {item.assignment === "direct" ? "You" : "Team"}
        </span>
      </td>
    </tr>
  );
}

/**
 * Which sources have reported in. Visible always, not just while loading: it is
 * also the mixed-unit disclosure — the reader can see that one total is the sum
 * of several differently-counted things.
 */
function SourceStrip({
  sources,
  hasStepUnits,
}: {
  sources: { key: string; label: string; items: unknown[]; isLoading: boolean; error: unknown }[];
  hasStepUnits: boolean;
}) {
  if (sources.length === 0) return null;
  return (
    <Card className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">Sources</span>
        {sources.map((s) => (
          <span key={s.key} className="text-[12px] whitespace-nowrap">
            <span className="text-grey-2">{s.label}</span>{" "}
            {s.error ? (
              <span className="text-ryg-red font-semibold" title={String(s.error)}>
                unavailable
              </span>
            ) : s.isLoading ? (
              <span className="inline-block h-[10px] w-5 rounded bg-line animate-pulse align-middle" />
            ) : (
              <span className="text-navy font-semibold tabular-nums">{s.items.length}</span>
            )}
          </span>
        ))}
      </div>
      {hasStepUnits && (
        <p className="mt-2 text-[11px] leading-snug text-grey-2">
          Workflow sources count steps, so one order can appear at more than one step — each is a separate thing to do.
          Tasks and follow-ups count records.
        </p>
      )}
    </Card>
  );
}

function GroupToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      aria-pressed={on}
      title={on ? "Grouped by source — click for a flat list" : "Flat list — click to group by source"}
      className={cn(
        "h-[34px] inline-flex items-center gap-1.5 rounded-xl border px-2.5 text-[12.5px] font-medium transition-colors",
        on ? "border-orange bg-orange-soft/60 text-orange" : "border-line bg-white text-grey hover:text-navy"
      )}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 6h16M7 12h13M7 18h13" />
        <circle cx="4" cy="12" r="1" fill="currentColor" />
        <circle cx="4" cy="18" r="1" fill="currentColor" />
      </svg>
      Group
    </button>
  );
}

/** One cell of the in-table filter row. */
function FilterCell({ children }: { children?: React.ReactNode }) {
  return <td className="px-4 py-2 align-middle">{children}</td>;
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-grey-2 [&>svg]:w-3.5 [&>svg]:h-3.5">
        <IconSearch />
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search work…"
        className="h-[34px] w-full rounded-xl border border-line bg-white pl-8 pr-7 text-[12.5px] text-navy placeholder:text-grey-2 focus:outline-none focus:border-orange focus:ring-2 focus:ring-orange/15 transition"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-grey-2 hover:text-navy"
          title="Clear search"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      )}
    </div>
  );
}

function SortControl({
  sort,
  dir,
  onSort,
  onDir,
}: {
  sort: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
  onDir: (d: SortDir) => void;
}) {
  return (
    <div className="flex items-center rounded-xl border border-line bg-white overflow-hidden h-[34px]">
      <select
        value={sort}
        onChange={(e) => onSort(e.target.value as SortKey)}
        className="h-full bg-transparent pl-2.5 pr-1 text-[12.5px] text-navy focus:outline-none cursor-pointer"
        title="Sort by"
      >
        {SORTS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => onDir(dir === "asc" ? "desc" : "asc")}
        title={dir === "asc" ? "Ascending — click for descending" : "Descending — click for ascending"}
        className="h-full px-2 border-l border-line text-grey hover:text-orange hover:bg-page transition-colors"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={cn("transition-transform", dir === "desc" && "rotate-180")}>
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      </button>
    </div>
  );
}

function Th({
  children,
  sortKey,
  active,
  dir,
  onSort,
}: {
  children: React.ReactNode;
  sortKey?: SortKey;
  active?: SortKey;
  dir?: SortDir;
  onSort?: (k: SortKey) => void;
}) {
  const isActive = !!sortKey && active === sortKey;
  if (!sortKey || !onSort) {
    return (
      <th className="text-left text-[11.5px] font-semibold text-grey-2 uppercase tracking-wide px-4 py-2.5 whitespace-nowrap">
        {children}
      </th>
    );
  }
  return (
    <th className="text-left px-4 py-2.5 whitespace-nowrap">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 text-[11.5px] font-semibold uppercase tracking-wide transition-colors",
          isActive ? "text-orange" : "text-grey-2 hover:text-navy"
        )}
      >
        {children}
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn("transition-all", isActive ? (dir === "desc" ? "rotate-180" : "") : "opacity-0 group-hover:opacity-40")}
        >
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      </button>
    </th>
  );
}

function SkeletonRows() {
  return (
    <div className="divide-y divide-line">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5">
          <div className="h-3 rounded bg-line/70 animate-pulse" style={{ width: `${120 - i * 12}px` }} />
          <div className="h-3 w-24 rounded bg-line/50 animate-pulse" />
          <div className="h-3 w-16 rounded bg-line/50 animate-pulse ml-auto" />
        </div>
      ))}
    </div>
  );
}

/* ---- icons ---------------------------------------------------------------- */

function IconAlert() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}
function IconClock() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
function IconHorizon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 18h18M7 18a5 5 0 0 1 10 0" />
      <path d="M12 3v3M4.5 7.5l2 2M19.5 7.5l-2 2" />
    </svg>
  );
}
function IconInfinity() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.5 9a3 3 0 1 0 0 6c2.5 0 3.5-6 6-6a3 3 0 1 1 0 6c-2.5 0-3.5-6-6-6Z" />
    </svg>
  );
}
function IconStamp() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
function IconSearch() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
