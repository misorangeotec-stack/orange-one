import { useCallback, useMemo, useState, type ReactNode } from "react";
import Avatar from "@/shared/components/ui/Avatar";
import Card from "@/shared/components/ui/Card";
import DateRangeFilter, { EMPTY_RANGE, dateInRange, isRangeActive, type DateRange } from "@/shared/components/ui/DateRangeFilter";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { cn } from "@/shared/lib/cn";
import { formatDate } from "@/shared/lib/time";
import { appName } from "@/apps/appInfo";
import { useOpenWorkItem } from "@/core/workspace/WorkPanel";
import PersonDrawer from "../components/PersonDrawer";
import { CALL_LIST_APP_IDS, usePeopleWork, type KnownRef, type ModuleStatus, type PersonItem, type PersonWork } from "../data/peopleWork";
import { daysLate } from "../lib/callText";
import { matchedRef, normRef } from "../lib/hubSearch";

/**
 * PENDING & DUE ACTIVITY — the coordinator's one screen for every FMS due.
 *
 * Layout follows the dashboard the user shared on 06-10-2026: filters on the left,
 * five tiles, an FMS-wise and a person-wise summary side by side, then every
 * pending task. What it adds beyond that mock-up:
 *  · the tiles are buttons — click "Overdue" and both summaries and the task list
 *    narrow to overdue work; click again to clear;
 *  · a person row opens the call drawer (phone, WhatsApp reminder, email, every
 *    item they owe) — ringing people is the coordinator's job, so the number is
 *    always one click away;
 *  · each task's "View" opens the FMS's own page in the side panel;
 *  · the "Last follow-up" column of the mock-up is "Late by" here: no FMS records
 *    a follow-up date per step, and an invented column would always be blank.
 *
 * Filters apply as you pick (no Apply button): the counts move with them, which
 * is what tells you a filter did something.
 *
 * The "Hub ID / PO no." search at the top answers "is this one still pending?":
 * it matches a row's own number and every linked number of the same record (see
 * lib/hubSearch.ts), and says plainly when the number exists but has no open step.
 * A search also shows on-hold rows — held work is still pending, and hiding it
 * would answer "not pending" for a PO that is only parked.
 *
 * ⚠ ONE TASK, SEVERAL OWNERS. A shared step (e.g. a Dispatch step owned by three
 *   people) is ONE pending task in the tiles, the FMS summary and the task list,
 *   but it counts once against EACH owner in the person summary — each of them can
 *   close it, so each of them is somebody to ring.
 */

type Quick = "all" | "overdue" | "today" | "soon" | "late7";

/** FMS colour dots — fixed per module so a colour means the same thing everywhere. */
const PALETTE = ["#3B82F6", "#22A06B", "#8B5CF6", "#F59E0B", "#14B8A6", "#EC4899", "#6366F1", "#EF4444", "#0EA5E9", "#84CC16", "#F97316", "#A855F7", "#06B6D4", "#64748B", "#D946EF", "#10B981"];
const colourOf = (appId: string) => PALETTE[Math.max(0, CALL_LIST_APP_IDS.indexOf(appId)) % PALETTE.length];

interface Pair {
  item: PersonItem;
  row: PersonWork;
  /** Days late (positive) or days ahead (negative); null when undated. */
  late: number | null;
}

interface Task {
  item: PersonItem;
  owners: PersonWork[];
  late: number | null;
}

interface Tally {
  pending: number;
  overdue: number;
  today: number;
  soon: number;
  late7: number;
}

const emptyTally = (): Tally => ({ pending: 0, overdue: 0, today: 0, soon: 0, late7: 0 });

function addTo(t: Tally, item: PersonItem, late: number | null) {
  t.pending++;
  if (item.bucket === "overdue") t.overdue++;
  if (item.bucket === "today") t.today++;
  if (late != null && late <= -1 && late >= -3) t.soon++;
  if (item.bucket === "overdue" && late != null && late >= 7) t.late7++;
}

function matchesQuick(q: Quick, item: PersonItem, late: number | null): boolean {
  switch (q) {
    case "all":
      return true;
    case "overdue":
      return item.bucket === "overdue";
    case "today":
      return item.bucket === "today";
    case "soon":
      return late != null && late <= -1 && late >= -3;
    case "late7":
      return item.bucket === "overdue" && late != null && late >= 7;
  }
}

export default function CallList() {
  const { rows, modules, knownRefs, peopleLoading, contactsMissing, todayIso, updatedAt, refreshing, refresh } = usePeopleWork();
  const openItem = useOpenWorkItem();

  const [search, setSearch] = useState("");
  const q = normRef(search);
  const [persons, setPersons] = useState<string[]>([]);
  const [parties, setParties] = useState<string[]>([]);
  const [fms, setFms] = useState<string[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [stages, setStages] = useState<string[]>([]);
  const [range, setRange] = useState<DateRange>(EMPTY_RANGE);
  const [withHold, setWithHold] = useState(false);
  const [quick, setQuick] = useState<Quick>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  /* ---- every (item, person) pair, before any filter ---------------------------- */
  const allPairs = useMemo<Pair[]>(
    () => rows.flatMap((row) => row.items.map((item) => ({ item, row, late: daysLate(item.dueIso, todayIso) }))),
    [rows, todayIso],
  );

  /* ---- filter options, each from the pairs the OTHER filters still allow ------- */
  const pass = useCallback(
    (p: Pair, skip?: "person" | "party" | "fms" | "dept" | "stage") =>
      (withHold || !!q || p.item.bucket !== "hold") &&
      (!q || matchedRef(p.item, q) != null) &&
      (skip === "person" || !persons.length || persons.includes(p.row.person.id)) &&
      (skip === "party" || !parties.length || parties.includes(p.item.detail ?? "—")) &&
      (skip === "fms" || !fms.length || fms.includes(p.item.appId)) &&
      (skip === "dept" || !departments.length || departments.includes(p.row.person.department ?? "—")) &&
      (skip === "stage" || !stages.length || stages.includes(p.item.stage ?? "—")) &&
      (!isRangeActive(range) || (!!p.item.dueIso && dateInRange(p.item.dueIso, range))),
    [q, withHold, persons, parties, fms, departments, stages, range],
  );

  const options = useMemo(() => {
    const collect = (skip: Parameters<typeof pass>[1], key: (p: Pair) => [string, string]) => {
      const m = new Map<string, string>();
      for (const p of allPairs) if (pass(p, skip)) m.set(...key(p));
      return [...m].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
    };
    return {
      person: collect("person", (p) => [p.row.person.id, p.row.person.name]),
      party: collect("party", (p) => [p.item.detail ?? "—", p.item.detail ?? "—"]),
      fms: collect("fms", (p) => [p.item.appId, appName(p.item.appId)]),
      dept: collect("dept", (p) => [p.row.person.department ?? "—", p.row.person.department ?? "—"]),
      stage: collect("stage", (p) => [p.item.stage ?? "—", p.item.stage ?? "—"]),
    };
  }, [allPairs, pass]);

  /* ---- the filtered book ------------------------------------------------------- */
  const base = useMemo(() => allPairs.filter((p) => pass(p)), [allPairs, pass]);
  const pairs = useMemo(() => base.filter((p) => matchesQuick(quick, p.item, p.late)), [base, quick]);

  const toTasks = (list: Pair[]): Task[] => {
    const by = new Map<string, Task>();
    for (const p of list) {
      const t = by.get(p.item.id);
      if (t) t.owners.push(p.row);
      else by.set(p.item.id, { item: p.item, owners: [p.row], late: p.late });
    }
    return [...by.values()];
  };
  const baseTasks = useMemo(() => toTasks(base), [base]);
  /** Every pending row the search hits, ignoring the other filters — the verdict must not say "not pending" because a Person filter hid the row. */
  const searchHits = useMemo(() => (q ? toTasks(allPairs.filter((p) => matchedRef(p.item, q) != null)) : []), [allPairs, q]);
  const tasks = useMemo(() => toTasks(pairs), [pairs]);

  /** The tiles read the book BEFORE the quick filter, so clicking one never zeroes the others. */
  const tiles = useMemo(() => {
    const t = emptyTally();
    let held = 0;
    for (const k of baseTasks) {
      if (k.item.bucket === "hold") held++;
      else addTo(t, k.item, k.late);
    }
    return { ...t, held };
  }, [baseTasks]);

  const byFms = useMemo(() => {
    const m = new Map<string, Tally>();
    for (const k of tasks) {
      if (k.item.bucket === "hold") continue;
      const t = m.get(k.item.appId) ?? emptyTally();
      addTo(t, k.item, k.late);
      m.set(k.item.appId, t);
    }
    return [...m].sort((a, b) => b[1].overdue - a[1].overdue || b[1].pending - a[1].pending);
  }, [tasks]);

  const byPerson = useMemo(() => {
    const m = new Map<string, { row: PersonWork; t: Tally }>();
    for (const p of pairs) {
      if (p.item.bucket === "hold") continue;
      const e = m.get(p.row.person.id) ?? { row: p.row, t: emptyTally() };
      addTo(e.t, p.item, p.late);
      m.set(p.row.person.id, e);
    }
    return [...m.values()].sort((a, b) => b.t.overdue - a.t.overdue || b.t.pending - a.t.pending);
  }, [pairs]);

  const anyFilter =
    !!q ||
    persons.length + parties.length + fms.length + departments.length + stages.length > 0 ||
    isRangeActive(range) ||
    withHold ||
    quick !== "all";
  const clearAll = () => {
    setSearch("");
    setPersons([]);
    setParties([]);
    setFms([]);
    setDepartments([]);
    setStages([]);
    setRange(EMPTY_RANGE);
    setWithHold(false);
    setQuick("all");
  };

  const loading = peopleLoading || modules.some((m) => m.state === "loading");
  const openRow = useMemo(() => rows.find((r) => r.person.id === openId) ?? null, [rows, openId]);
  const close = useCallback(() => setOpenId(null), []);
  const toggleQuick = (q: Quick) => setQuick((cur) => (cur === q ? "all" : q));

  /* ---- the task table ---------------------------------------------------------- */
  const columns: QueueColumn<Task>[] = [
    {
      key: "ref",
      header: "Hub ID",
      alwaysVisible: true,
      cell: (t) => {
        const hit = matchedRef(t.item, q);
        return (
          <div>
            <span className="font-semibold text-navy">{t.item.ref}</span>
            {hit && hit !== t.item.ref ? <div className="whitespace-nowrap text-[11px] text-grey">via {hit}</div> : null}
          </div>
        );
      },
      sortValue: (t) => t.item.ref,
      exportValue: (t) => t.item.ref,
      filter: { kind: "text", get: (t) => [t.item.ref, ...t.item.searchRefs].join(" ") },
    },
    {
      key: "fms",
      header: "FMS",
      cell: (t) => (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <Dot appId={t.item.appId} />
          {appName(t.item.appId)}
        </span>
      ),
      sortValue: (t) => appName(t.item.appId),
      filter: { kind: "select", get: (t) => appName(t.item.appId) },
    },
    {
      key: "stage",
      header: "Stage",
      cell: (t) =>
        t.item.stage ? (
          <span
            className="whitespace-nowrap rounded-md px-2 py-0.5 text-[11.5px] font-semibold"
            style={{ background: `${colourOf(t.item.appId)}1A`, color: colourOf(t.item.appId) }}
          >
            {t.item.stage}
          </span>
        ) : (
          <span className="text-grey-2">—</span>
        ),
      sortValue: (t) => t.item.stage ?? "",
      filter: { kind: "select", get: (t) => t.item.stage ?? "—" },
    },
    {
      key: "party",
      header: "Customer / Detail",
      cell: (t) => <span className="text-grey">{t.item.detail ?? "—"}</span>,
      sortValue: (t) => t.item.detail ?? "",
      filter: { kind: "select", get: (t) => t.item.detail ?? "—" },
    },
    {
      key: "person",
      header: "Person",
      cell: (t) => (
        <div className="flex flex-wrap gap-x-1.5">
          {t.owners.map((o, i) => (
            <button
              key={o.person.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpenId(o.person.id);
              }}
              className="whitespace-nowrap text-navy underline-offset-2 hover:text-orange hover:underline"
            >
              {o.person.name}
              {i < t.owners.length - 1 ? "," : ""}
            </button>
          ))}
        </div>
      ),
      sortValue: (t) => t.owners[0]?.person.name ?? "",
      filter: { kind: "text", get: (t) => t.owners.map((o) => o.person.name).join(", ") },
      exportValue: (t) => t.owners.map((o) => o.person.name).join(", "),
    },
    {
      key: "due",
      header: "Due date",
      cell: (t) => <DuePill item={t.item} />,
      sortValue: (t) => t.item.dueIso ?? "9999-12-31",
      exportValue: (t) => (t.item.dueIso ? formatDate(t.item.dueIso) : ""),
      filter: { kind: "date", get: (t) => t.item.dueIso ?? "" },
    },
    {
      key: "late",
      header: "Late by",
      align: "right",
      cell: (t) =>
        t.item.bucket === "hold" ? (
          <span className="text-[12px] text-grey">{t.item.holdLabel ?? "On hold"}</span>
        ) : t.late != null && t.late > 0 ? (
          <span className={cn("font-semibold tabular-nums", t.late >= 7 ? "text-[#7C3AED]" : "text-ryg-red")}>{t.late}d</span>
        ) : (
          <span className="text-grey-2/50">·</span>
        ),
      sortValue: (t) => t.late ?? -9999,
      exportValue: (t) => (t.late != null && t.late > 0 ? t.late : ""),
      filter: { kind: "number", get: (t) => Math.max(0, t.late ?? 0) },
    },
  ];

  return (
    <div className="space-y-4">
      {/* ── title bar ──────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-navy px-5 py-3.5 text-white">
        <div>
          <h1 className="text-[19px] font-bold">Pending &amp; Due Activity</h1>
          <p className="text-[12.5px] text-white/70">Track · Follow-up · Get it done — every FMS, every person</p>
        </div>
        <div className="flex items-center gap-3 text-[12.5px] text-white/80">
          <span>
            Last updated:{" "}
            {updatedAt
              ? new Date(updatedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
              : "loading…"}
          </span>
          <button
            type="button"
            onClick={refresh}
            title="Refresh every FMS"
            className="rounded-lg bg-white/10 p-2 transition hover:bg-white/20"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={cn(refreshing && "animate-spin")}
            >
              <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
          </button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[230px_minmax(0,1fr)]">
        {/* ── filters ──────────────────────────────────────────────────── */}
        <Card className="h-fit space-y-3.5 p-4 lg:sticky lg:top-4">
          <div className="flex items-center gap-2 text-[15px] font-bold text-navy">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 5h18l-7 8v6l-4-2v-4Z" />
            </svg>
            Filters
          </div>
          <Filter label="Hub ID / PO / document no.">
            <SearchBox value={search} onChange={setSearch} />
            {q ? <SearchVerdict q={q} raw={search.trim()} found={searchHits} knownRefs={knownRefs} loading={loading} /> : null}
          </Filter>
          <Filter label="Person">
            <MultiSelect values={persons} onChange={setPersons} options={options.person} placeholder="Select person" />
          </Filter>
          <Filter label="Customer / Detail">
            <MultiSelect values={parties} onChange={setParties} options={options.party} placeholder="Select customer" />
          </Filter>
          <Filter label="FMS">
            <MultiSelect values={fms} onChange={setFms} options={options.fms} placeholder="Select FMS" />
          </Filter>
          <Filter label="Department">
            <MultiSelect values={departments} onChange={setDepartments} options={options.dept} placeholder="Select department" />
          </Filter>
          <Filter label="Stage">
            <MultiSelect values={stages} onChange={setStages} options={options.stage} placeholder="Select stage" />
          </Filter>
          <Filter label="Due date range">
            <DateRangeFilter value={range} onChange={setRange} placeholder="Select date range" />
          </Filter>
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-navy">
            <input type="checkbox" checked={withHold} onChange={(e) => setWithHold(e.target.checked)} className="accent-orange" />
            Include on-hold work ({tiles.held})
          </label>
          <button
            type="button"
            onClick={clearAll}
            disabled={!anyFilter}
            className="w-full rounded-lg border border-line bg-white py-2 text-[13px] font-semibold text-navy transition hover:border-orange hover:text-orange disabled:cursor-not-allowed disabled:opacity-50"
          >
            Clear filters
          </button>
          <Coverage modules={modules} contactsMissing={contactsMissing} />
        </Card>

        <div className="min-w-0 space-y-4">
          {/* ── tiles ───────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <Tile label="Total pending" value={tiles.pending} tone="blue" active={quick === "all"} onClick={() => setQuick("all")} icon={<IcList />} />
            <Tile label="Overdue" value={tiles.overdue} tone="red" active={quick === "overdue"} onClick={() => toggleQuick("overdue")} icon={<IcAlert />} />
            <Tile label="Due today" value={tiles.today} tone="green" active={quick === "today"} onClick={() => toggleQuick("today")} icon={<IcCal />} />
            <Tile label="Due in 1–3 days" value={tiles.soon} tone="amber" active={quick === "soon"} onClick={() => toggleQuick("soon")} icon={<IcClock />} />
            <Tile label="7+ days overdue" value={tiles.late7} tone="violet" active={quick === "late7"} onClick={() => toggleQuick("late7")} icon={<IcFlag />} />
          </div>

          {/* ── summaries ───────────────────────────────────────────────── */}
          <div className="grid gap-4 xl:grid-cols-2">
            <Summary
              title="FMS-wise summary"
              head="FMS"
              icon={<IcTree />}
              empty="No pending work for these filters."
              rows={byFms.map(([appId, t]) => ({
                key: appId,
                label: (
                  <span className="inline-flex items-center gap-2 font-medium text-navy">
                    <Dot appId={appId} />
                    {appName(appId)}
                  </span>
                ),
                t,
                active: fms.length === 1 && fms[0] === appId,
                onClick: () => setFms((cur) => (cur.length === 1 && cur[0] === appId ? [] : [appId])),
              }))}
            />
            <Summary
              title="Person-wise summary"
              head="Person"
              icon={<IcUser />}
              empty="Nobody has pending work for these filters."
              rows={byPerson.map(({ row, t }) => ({
                key: row.person.id,
                label: (
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <Avatar name={row.person.name} color={row.person.avatarColor} size={22} />
                    <span className="truncate font-medium text-navy">{row.person.name}</span>
                    {row.contact.phone ? (
                      <a
                        href={`tel:${row.contact.phone}`}
                        onClick={(e) => e.stopPropagation()}
                        title={`Call ${row.contact.phone}`}
                        className="text-grey-2 transition hover:text-orange"
                      >
                        <IcPhone />
                      </a>
                    ) : null}
                  </span>
                ),
                t,
                onClick: () => setOpenId(row.person.id),
              }))}
            />
          </div>

          {/* ── every task ──────────────────────────────────────────────── */}
          <Card className="p-4">
            <div className="mb-3 flex items-center gap-2 text-[15px] font-bold text-navy">
              <IcList />
              Pending tasks ({tasks.length})
            </div>
            <QueueTable
              rows={tasks}
              rowKey={(t) => t.item.id}
              columns={columns}
              loading={loading && rows.length === 0}
              onRowClick={(t) => openItem(t.item)}
              rowClassName={(t) => (t.item.bucket === "overdue" ? "bg-[#FDECEC]/25" : "")}
              initialSort={{ key: "due", dir: "asc" }}
              rowsLabel="tasks"
              actions={(t) => (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openItem(t.item);
                  }}
                  className="rounded-md border border-line px-2.5 py-1 text-[12px] font-semibold text-blue transition hover:border-orange hover:text-orange"
                >
                  View
                </button>
              )}
              emptyTitle="Nothing pending"
              emptyMessage="No FMS step is open in the modules you can see."
              exportName="Pending and Due Activity"
              exportTitle="Process Coordinator — Pending & Due Activity"
            />
          </Card>
        </div>
      </div>

      <PersonDrawer row={openRow} todayIso={todayIso} onClose={close} />
    </div>
  );
}

/* ---- pieces ------------------------------------------------------------------- */

function Filter({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[12px] font-semibold text-navy">{label}</div>
      {children}
    </div>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <svg
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-grey-2"
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. PR-1043, PO-0231"
        className="w-full rounded-xl border border-line bg-white py-2.5 pl-9 pr-3 text-[14px] text-ink outline-none transition placeholder:text-grey-2 hover:border-[#d9e2f0] focus:border-orange focus:ring-4 focus:ring-orange/10"
      />
    </div>
  );
}

/**
 * The plain answer to "is it pending?". Reads every pending row, not the filtered
 * book, so a lit tile or a Person filter never makes a pending PO look closed.
 */
function SearchVerdict({
  q,
  raw,
  found,
  knownRefs,
  loading,
}: {
  q: string;
  raw: string;
  found: Task[];
  knownRefs: KnownRef[];
  loading: boolean;
}) {
  if (found.length) {
    const fmsNames = [...new Set(found.map((t) => appName(t.item.appId)))].join(", ");
    return (
      <div className="mt-1.5 rounded-lg bg-[#FFF3DC] px-2.5 py-1.5 text-[11.5px] leading-snug text-[#92400E]">
        <span className="font-semibold">Pending</span> — {found.length} open step{found.length === 1 ? "" : "s"} in {fmsNames}
      </div>
    );
  }
  if (loading) return <div className="mt-1.5 text-[11.5px] text-grey">Still loading — checking every FMS…</div>;
  const known = knownRefs.filter((k) => normRef(k.ref).includes(q));
  if (known.length) {
    const names = [...new Set(known.map((k) => appName(k.appId)))].join(", ");
    const sample = [...new Set(known.map((k) => k.ref))].slice(0, 3).join(", ");
    return (
      <div className="mt-1.5 rounded-lg bg-[#E9F8EF] px-2.5 py-1.5 text-[11.5px] leading-snug text-[#15803D]">
        <span className="font-semibold">Not pending</span> — {sample} is in {names} with no open step (done, closed or cancelled).
      </div>
    );
  }
  return (
    <div className="mt-1.5 rounded-lg bg-page px-2.5 py-1.5 text-[11.5px] leading-snug text-grey">
      No record "{raw}" in the FMS you can see.
    </div>
  );
}

function Dot({ appId }: { appId: string }) {
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colourOf(appId) }} />;
}

const TONES = {
  blue: { bg: "bg-[#EEF4FF]", ring: "ring-[#3B82F6]", text: "text-[#1D4ED8]", icon: "bg-[#DBE7FE] text-[#2563EB]" },
  red: { bg: "bg-[#FFF1F1]", ring: "ring-[#EF4444]", text: "text-ryg-red", icon: "bg-[#FDDCDC] text-[#DC2626]" },
  green: { bg: "bg-[#EEFBF3]", ring: "ring-[#22A06B]", text: "text-[#15803D]", icon: "bg-[#D3F3E0] text-[#16A34A]" },
  amber: { bg: "bg-[#FFF8EC]", ring: "ring-[#F59E0B]", text: "text-[#B45309]", icon: "bg-[#FDEBC8] text-[#D97706]" },
  violet: { bg: "bg-[#F5F1FF]", ring: "ring-[#8B5CF6]", text: "text-[#6D28D9]", icon: "bg-[#E6DDFE] text-[#7C3AED]" },
} as const;

function Tile({
  label,
  value,
  tone,
  icon,
  active,
  onClick,
}: {
  label: string;
  value: number;
  tone: keyof typeof TONES;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  const t = TONES[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-2xl border border-line px-4 py-3 text-left transition hover:-translate-y-0.5 hover:shadow-soft",
        t.bg,
        active && `ring-2 ${t.ring}`,
      )}
    >
      <span className={cn("inline-flex h-8 w-8 items-center justify-center rounded-lg", t.icon)}>{icon}</span>
      <div className="mt-2 text-[13px] font-medium text-navy">{label}</div>
      <div className={cn("text-[26px] font-bold leading-tight tabular-nums", t.text)}>{value}</div>
    </button>
  );
}

function Summary({
  title,
  head,
  icon,
  rows,
  empty,
}: {
  title: string;
  head: string;
  icon: ReactNode;
  empty: string;
  rows: { key: string; label: ReactNode; t: Tally; active?: boolean; onClick: () => void }[];
}) {
  return (
    <Card className="flex flex-col p-4">
      <div className="mb-2 flex items-center gap-2 text-[15px] font-bold text-navy">
        {icon}
        {title}
      </div>
      <div className="max-h-[330px] overflow-y-auto rounded-xl border border-line">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 z-[1] bg-page text-[12px] text-grey-2">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">{head}</th>
              <th className="px-2 py-2 text-right font-semibold">Pending</th>
              <th className="px-2 py-2 text-right font-semibold">Overdue</th>
              <th className="px-2 py-2 text-right font-semibold">Due today</th>
              <th className="px-2 py-2 text-right font-semibold">7+ days</th>
              <th className="w-7" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-grey">
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.key}
                  onClick={r.onClick}
                  className={cn("cursor-pointer border-t border-line/70 transition hover:bg-page/60", r.active && "bg-orange/5")}
                >
                  <td className="max-w-[200px] px-3 py-2">{r.label}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-navy">{r.t.pending}</td>
                  <td className={cn("px-2 py-2 text-right tabular-nums", r.t.overdue ? "font-semibold text-ryg-red" : "text-grey-2/60")}>{r.t.overdue}</td>
                  <td className={cn("px-2 py-2 text-right tabular-nums", r.t.today ? "text-[#15803D]" : "text-grey-2/60")}>{r.t.today}</td>
                  <td className={cn("px-2 py-2 text-right tabular-nums", r.t.late7 ? "font-semibold text-[#7C3AED]" : "text-grey-2/60")}>{r.t.late7}</td>
                  <td className="pr-2 text-grey-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function DuePill({ item }: { item: PersonItem }) {
  if (!item.dueIso) return <span className="text-grey-2">No date</span>;
  const cls =
    item.bucket === "overdue"
      ? "bg-[#FDECEC] text-ryg-red"
      : item.bucket === "today"
        ? "bg-[#FFF3DC] text-[#B45309]"
        : item.bucket === "hold"
          ? "bg-page text-grey"
          : "bg-[#E9F8EF] text-[#15803D]";
  return <span className={cn("whitespace-nowrap rounded-md px-2 py-0.5 text-[12px] font-semibold tabular-nums", cls)}>{formatDate(item.dueIso)}</span>;
}

/**
 * Which FMS these numbers cover. A module with no View grant is NOT fetched, so its
 * work is missing from every count — said here, or "nobody is overdue in Dispatch"
 * and "you cannot see Dispatch" would look the same.
 */
function Coverage({ modules, contactsMissing }: { modules: ModuleStatus[]; contactsMissing: boolean }) {
  const noAccess = modules.filter((m) => m.state === "no-access");
  const failed = modules.filter((m) => m.state === "error");
  const loading = modules.filter((m) => m.state === "loading");
  if (!noAccess.length && !failed.length && !loading.length && !contactsMissing) return null;
  return (
    <div className="space-y-1.5 border-t border-line pt-3 text-[11.5px] leading-snug text-grey">
      {loading.length ? (
        <div>
          <span className="font-semibold text-navy">Loading:</span> {loading.map((m) => m.name).join(", ")}
        </div>
      ) : null}
      {failed.length ? (
        <div className="text-ryg-red" title={failed.map((m) => `${m.name}: ${m.error}`).join("\n")}>
          <span className="font-semibold">Couldn't load:</span> {failed.map((m) => m.name).join(", ")}
        </div>
      ) : null}
      {noAccess.length ? (
        <div>
          <span className="font-semibold text-navy">Not counted (no View access):</span> {noAccess.map((m) => m.name).join(", ")}
        </div>
      ) : null}
      {contactsMissing ? <div>Phone numbers couldn't be loaded.</div> : null}
    </div>
  );
}

/* ---- icons -------------------------------------------------------------------- */

const ico = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const IcList = () => (
  <svg {...ico}>
    <rect x="5" y="3" width="14" height="18" rx="2" />
    <path d="M9 8h6M9 12h6M9 16h4" />
  </svg>
);
const IcAlert = () => (
  <svg {...ico}>
    <path d="M12 3 2 20h20Z" />
    <path d="M12 10v4M12 17v.01" />
  </svg>
);
const IcCal = () => (
  <svg {...ico}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);
const IcClock = () => (
  <svg {...ico}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
const IcFlag = () => (
  <svg {...ico}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4M12 13v3M12 18.5v.01" />
  </svg>
);
const IcTree = () => (
  <svg {...ico}>
    <rect x="9" y="3" width="6" height="5" rx="1" />
    <rect x="3" y="16" width="6" height="5" rx="1" />
    <rect x="15" y="16" width="6" height="5" rx="1" />
    <path d="M12 8v4M6 16v-4h12v4" />
  </svg>
);
const IcUser = () => (
  <svg {...ico}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4 3.5-6 8-6s8 2 8 6" />
  </svg>
);
const IcPhone = () => (
  <svg {...ico} width={13} height={13}>
    <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
  </svg>
);
