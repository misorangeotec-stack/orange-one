import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import { TextInput } from "@/shared/components/ui/Form";
import Combobox from "@/shared/components/ui/Combobox";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import PillToggle from "@/shared/components/ui/PillToggle";
import DateRangeFilter, { EMPTY_RANGE, dateInRange, rangeKey, rangeLabel, type DateRange } from "@/shared/components/ui/DateRangeFilter";
import Avatar from "@/shared/components/ui/Avatar";
import Pagination from "@/shared/components/ui/Pagination";
import ActiveFilters, { type ActiveFilter } from "@/shared/components/ui/ActiveFilters";
import { usePagination } from "@/shared/lib/usePagination";
import { useStickyState, NO_STICKY, type StickyScope } from "@/shared/lib/stickyState";
import { matchesSearch } from "@/shared/lib/search";
import { formatDate, formatDateTime } from "@/shared/lib/time";
import { WEEK_START } from "../mock/data";
import { useTaskStore } from "../mock/store";
import { countsTowardMetrics, isRecurringTask } from "../mock/selectors";
import type { Department, Profile, Task, TaskStatus } from "../types";
import { STATUS_FILTER_OPTIONS, RECURRENCE_LABEL, matchesStatusFilter, isOverdueTask, type StatusFilter } from "../types";
import { exportTasksToXlsx, type TaskExportRow } from "../lib/exportTasks";

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  completed: "Completed",
  revised: "Revised",
  shifted: "Shifted",
};
import type { ParsedTaskFilters } from "../lib/taskLink";
import TaskTable, { DEFAULT_TASK_SORT, nextSort, sortTasks, type TaskSort, type TaskSortKey } from "./TaskTable";

const nextWeekStart = () => {
  const d = new Date(WEEK_START);
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
};

/** Filterable task list shared by Team Tasks (HOD) and All Tasks (admin). */
export default function TaskBrowser({
  tasks,
  people,
  departments,
  emptyMessage = "No tasks match these filters.",
  hideWeekFilter = false,
  initialFilters,
  enableExport = false,
  exportSubtitle,
  onRequestAllTime,
  stickyScope,
}: {
  tasks: Task[];
  people: Profile[];
  departments?: Department[];
  emptyMessage?: string;
  /** Hide the internal "Any/This/Next week" dropdown when the parent owns the time scope (e.g. Team Tasks' This-week/All-time toggle). */
  hideWeekFilter?: boolean;
  /** Seed the filters from a deep-link (e.g. clicking a RYG number on the scorecard). */
  initialFilters?: ParsedTaskFilters;
  /** Show an "Export" button that downloads the full filtered set to .xlsx (All Tasks / admin). */
  enableExport?: boolean;
  /** Context line recorded on the export's Filters sheet (e.g. the week/all-time scope). */
  exportSubtitle?: string;
  /**
   * Widen the parent's time scope to "all time". The parent scopes `tasks` BEFORE
   * they reach here, so a week-scoped list physically cannot contain last week's
   * overdue work — and since this week's tasks are due this week, on a Monday the
   * Overdue filter would match nothing at all. Turning Overdue on calls this so
   * the filter has something to search.
   */
  onRequestAllTime?: () => void;
  /**
   * Namespace for remembering these filters across navigation, opened by the PARENT
   * (`useStickyScope`) and passed down — Team Tasks and All Tasks both render this
   * component, so each must own its own scope or they'd share one snapshot. Omit to
   * persist nothing.
   */
  stickyScope?: StickyScope;
}) {
  const { actorById, departmentById, getRecurring } = useTaskStore();
  const scope = stickyScope ?? NO_STICKY;
  const [q, setQ] = useStickyState(scope, "q", "");
  const [person, setPerson] = useStickyState(scope, "person", initialFilters?.assignee ?? "all");
  const [creator, setCreator] = useStickyState(scope, "creator", "all");
  const [dept, setDept] = useStickyState(scope, "dept", initialFilters?.dept ?? "all");
  const [statuses, setStatuses] = useStickyState<StatusFilter[]>(scope, "statuses", initialFilters?.statuses ?? []);
  // Recurring-vs-one-off scope, seeded from a deep-link (Weekly Scorecard split blocks).
  const [kind, setKind] = useStickyState<"all" | "recurring" | "oneoff">(scope, "kind", initialFilters?.kind ?? "all");
  const [week, setWeek] = useStickyState<"all" | "this" | "next">(scope, "week", "all");
  // An exact ISO-Monday week from a deep-link — independent of the all/this/next
  // dropdown, so it can target a historical week even when that dropdown is hidden.
  const [exactWeek, setExactWeek] = useStickyState<string | null>(scope, "exactWeek", initialFilters?.week ?? null);
  // Exclude personal + N/A tasks (set when arriving from a score/RYG number, so
  // the list matches the count behind it). Clearable, like any other filter.
  const [metricOnly, setMetricOnly] = useStickyState(scope, "metricOnly", initialFilters?.metricOnly ?? false);
  // Regular (scored) vs "Other" (self-tracking, is_personal) tasks. Seeded to
  // "other" when arriving from the Other-tasks card on the scorecard.
  const [category, setCategory] = useStickyState<"all" | "regular" | "other">(scope, "category", initialFilters?.personal ? "other" : "all");
  // Date windows on the two date columns. Not part of the deep-link contract
  // (see lib/taskLink) — plain sticky state, so a scorecard drill-down doesn't
  // start discarding snapshots on their account.
  const [assignedRange, setAssignedRange] = useStickyState<DateRange>(scope, "assignedRange", EMPTY_RANGE);
  const [dueRange, setDueRange] = useStickyState<DateRange>(scope, "dueRange", EMPTY_RANGE);
  // Overdue is a CONDITION, not a status: it ANDs with everything else, so
  // "In Progress" + Overdue means in-progress AND late. It deliberately isn't an
  // option in the status multi-select, where it would have read as an OR.
  const [overdueOnly, setOverdueOnly] = useStickyState(scope, "overdueOnly", false);
  const [sort, setSort] = useStickyState<TaskSort>(scope, "sort", DEFAULT_TASK_SORT);
  const onSort = (key: TaskSortKey) => setSort((s) => nextSort(s, key));

  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  // "Created by" options come from the creators that actually appear in these
  // tasks, not from `people` — a task's creator may be an admin or the HOD
  // themselves, who aren't in a team-scoped `people` list. Resolved via
  // actorById (org-wide, name-only) rather than the RLS-scoped directory, or a
  // cross-department assigner's option reads "—" and can't be picked out.
  const creatorOptions = useMemo(() => {
    const ids = [...new Set(tasks.map((t) => t.createdBy))];
    return ids
      .map((id) => ({ value: id, label: actorById(id)?.name ?? "—" }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [tasks, actorById]);

  // The assignee dropdown is scoped to the selected department, so picking a
  // department surfaces exactly that team's members.
  const visiblePeople = useMemo(
    () => (dept === "all" ? people : people.filter((p) => p.departmentId === dept)),
    [people, dept],
  );

  // Linked filters. Choosing a person pins the department to that person's dept;
  // choosing a department drops any selected person who no longer belongs to it,
  // so the whole department's tasks show.
  const handlePersonChange = (next: string) => {
    setPerson(next);
    // Pin the department to the chosen person's dept; if they have none, drop the
    // department filter so their tasks aren't hidden by a stale selection.
    if (departments && next !== "all") {
      setDept(peopleById.get(next)?.departmentId ?? "all");
    }
  };
  const handleDeptChange = (next: string) => {
    setDept(next);
    if (next !== "all" && person !== "all" && peopleById.get(person)?.departmentId !== next) {
      setPerson("all");
    }
  };

  const clearAll = () => {
    setQ("");
    setPerson("all");
    setCreator("all");
    setDept("all");
    setStatuses([]);
    setKind("all");
    setCategory("all");
    setWeek("all");
    setExactWeek(null);
    setMetricOnly(false);
    setOverdueOnly(false);
    setAssignedRange(EMPTY_RANGE);
    setDueRange(EMPTY_RANGE);
  };

  const filtered = useMemo(() => {
    const nw = nextWeekStart();
    return tasks.filter((t) => {
      if (metricOnly && !countsTowardMetrics(t)) return false;
      if (category === "regular" && t.isPersonal) return false;
      if (category === "other" && !t.isPersonal) return false;
      if (person !== "all" && t.assignedTo !== person) return false;
      if (creator !== "all" && t.createdBy !== creator) return false;
      if (dept !== "all" && t.departmentId !== dept) return false;
      if (statuses.length && !matchesStatusFilter(t, statuses)) return false;
      if (overdueOnly && !isOverdueTask(t)) return false;
      if (kind === "recurring" && !isRecurringTask(t)) return false;
      if (kind === "oneoff" && (isRecurringTask(t) || t.isPersonal)) return false;
      if (exactWeek && t.weekStart !== exactWeek) return false;
      if (week === "this" && t.weekStart !== WEEK_START) return false;
      if (week === "next" && t.weekStart !== nw) return false;
      if (!dateInRange(t.createdAt, assignedRange)) return false;
      if (!dateInRange(t.dueDate, dueRange)) return false;
      if (!matchesSearch(q, t.title, t.description)) return false;
      return true;
    });
  }, [tasks, person, creator, dept, statuses, kind, category, week, exactWeek, metricOnly, overdueOnly, assignedRange, dueRange, q]);

  // KPI cards reflect the active filters (not the full list).
  const counts = useMemo(() => {
    const c = { total: filtered.length, open: 0, overdue: 0, completed: 0, revised: 0, shifted: 0 };
    for (const t of filtered) {
      // Overdue is derived and cuts ACROSS the others (an overdue task is also
      // Open or Revised), so it's counted separately rather than in the chain.
      if (isOverdueTask(t)) c.overdue++;
      if (t.status === "pending" || t.status === "in_progress") c.open++;
      else if (t.status === "completed") c.completed++;
      else if (t.status === "revised") c.revised++;
      else if (t.status === "shifted") c.shifted++;
    }
    return c;
  }, [filtered]);

  const sorted = useMemo(
    () => sortTasks(filtered, sort, (id) => actorById(id)?.name, (id) => departmentById(id)?.name),
    [filtered, sort, actorById, departmentById],
  );

  // Injected rather than seeded — see the note in TasksList.
  const pageState = useStickyState(scope, "page", 1);
  const pg = usePagination(sorted, {
    // The ranges go through rangeKey: they're fresh objects on every change, so
    // interpolating them directly would yield a constant "[object Object]" and
    // the page would never reset.
    resetKey: `${q}|${person}|${creator}|${dept}|${statuses.join(",")}|${kind}|${category}|${week}|${exactWeek ?? ""}|${metricOnly}|${overdueOnly}|${rangeKey(assignedRange)}|${rangeKey(dueRange)}|${sort.key}|${sort.dir}`,
    pageState,
  });

  // Active-filter chips, so it's always visible what's narrowing the list.
  const activeFilters: ActiveFilter[] = [];
  if (q.trim()) activeFilters.push({ key: "q", label: `Search: “${q.trim()}”`, onClear: () => setQ("") });
  if (departments && dept !== "all")
    activeFilters.push({
      key: "dept",
      label: `Department: ${departments.find((d) => d.id === dept)?.name ?? dept}`,
      onClear: () => handleDeptChange("all"),
    });
  if (creator !== "all")
    activeFilters.push({
      key: "creator",
      label: `Created by: ${creatorOptions.find((c) => c.value === creator)?.label ?? creator}`,
      onClear: () => setCreator("all"),
    });
  if (person !== "all")
    activeFilters.push({
      key: "person",
      label: `Assigned to: ${peopleById.get(person)?.name ?? person}`,
      onClear: () => handlePersonChange("all"),
    });
  if (statuses.length)
    activeFilters.push({
      key: "status",
      label: `Status: ${STATUS_FILTER_OPTIONS.filter((s) => statuses.includes(s.value)).map((s) => s.label).join(", ")}`,
      onClear: () => setStatuses([]),
    });
  if (overdueOnly)
    activeFilters.push({
      key: "overdue",
      label: "Overdue only",
      onClear: () => setOverdueOnly(false),
    });
  if (rangeLabel(assignedRange))
    activeFilters.push({
      key: "assignedRange",
      label: `Assigned: ${rangeLabel(assignedRange)}`,
      onClear: () => setAssignedRange(EMPTY_RANGE),
    });
  if (rangeLabel(dueRange))
    activeFilters.push({
      key: "dueRange",
      label: `Due: ${rangeLabel(dueRange)}`,
      onClear: () => setDueRange(EMPTY_RANGE),
    });
  if (kind !== "all")
    activeFilters.push({
      key: "kind",
      label: kind === "recurring" ? "Recurring tasks" : "One-off tasks",
      onClear: () => setKind("all"),
    });
  if (week !== "all")
    activeFilters.push({
      key: "week",
      label: week === "this" ? "This week" : "Next week",
      onClear: () => setWeek("all"),
    });
  if (exactWeek)
    activeFilters.push({
      key: "exactWeek",
      label: `Week of ${formatDate(exactWeek)}`,
      onClear: () => setExactWeek(null),
    });
  if (metricOnly)
    activeFilters.push({
      key: "metric",
      label: "Scored tasks only",
      onClear: () => setMetricOnly(false),
    });
  if (category !== "all")
    activeFilters.push({
      key: "category",
      label: category === "regular" ? "Regular tasks" : "Other tasks",
      onClear: () => setCategory("all"),
    });

  // Export the FULL filtered + sorted set (every page, not just the current one),
  // so the file matches exactly what the active filters describe.
  const handleExport = () => {
    const rows: TaskExportRow[] = sorted.map((t) => {
      const rec = t.recurringTaskId ? getRecurring(t.recurringTaskId)?.recurrenceType : undefined;
      return {
        title: t.title,
        description: t.description ?? "",
        department: departmentById(t.departmentId)?.name ?? "",
        createdBy: actorById(t.createdBy)?.name ?? "",
        assignedTo: actorById(t.assignedTo)?.name ?? "",
        type: t.isPersonal ? "Other" : isRecurringTask(t) ? "Recurring" : "One-off",
        recurrence: rec ? RECURRENCE_LABEL[rec] : "",
        status: t.notApplicable ? "Not Applicable" : STATUS_LABEL[t.status],
        assignedOn: formatDate(t.createdAt),
        dueDate: formatDate(t.dueDate),
        followUp: formatDate(t.followUpDate),
        revisions: t.revisionCount,
        completedOn: formatDate(t.completedAt),
        lastUpdated: formatDateTime(t.updatedAt),
      };
    });
    exportTasksToXlsx(rows, activeFilters.map((f) => f.label), exportSubtitle);
  };

  return (
    <div className="space-y-4">
      {/* stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat label="Total" value={counts.total} tone="text-navy" />
        <Stat label="Open" value={counts.open} tone="text-blue" />
        <Stat label="Overdue" value={counts.overdue} tone="text-[#d4493f]" />
        <Stat label="Completed" value={counts.completed} tone="text-[#27AE60]" />
        <Stat label="Revised" value={counts.revised} tone="text-[#B7820E]" />
        <Stat label="Shifted" value={counts.shifted} tone="text-orange" />
      </div>

      <Card className="overflow-hidden">
        {/*
          Toolbar strip: the filters that have no column of their own (task type,
          regular-vs-other, week), plus Export. Everything that DOES map to a
          column now lives in the table's own filter row instead.
        */}
        <div className="p-3 flex flex-wrap items-center gap-2.5 border-b border-line">
          <PillToggle<"all" | "recurring" | "oneoff">
            value={kind}
            onChange={setKind}
            options={[
              { value: "all", label: "All types" },
              { value: "recurring", label: "Recurring" },
              { value: "oneoff", label: "One-off" },
            ]}
          />
          <PillToggle<"all" | "regular" | "other">
            value={category}
            onChange={setCategory}
            options={[
              { value: "all", label: "All tasks" },
              { value: "regular", label: "Regular" },
              { value: "other", label: "Other" },
            ]}
          />
          {/* ANDs with the status filter — "In Progress" + Overdue only = late
              in-progress work. Separate from the status list on purpose. */}
          <PillToggle<"all" | "overdue">
            value={overdueOnly ? "overdue" : "all"}
            onChange={(v) => {
              const on = v === "overdue";
              setOverdueOnly(on);
              // Overdue work is historical by definition, and it lives in EARLIER
              // weeks that a "this week" scope has already removed. Widen the
              // window, or this filter reads as "no overdue tasks exist".
              if (on) onRequestAllTime?.();
            }}
            options={[
              { value: "all", label: "Any due date" },
              { value: "overdue", label: "Overdue" },
            ]}
          />
          {!hideWeekFilter && (
            <Combobox
              value={week}
              onChange={(v) => setWeek(v as "all" | "this" | "next")}
              className="w-full sm:w-auto sm:min-w-[130px]"
              triggerClassName="py-1.5 text-[13px]"
              options={[
                { value: "all", label: "Any week" },
                { value: "this", label: "This week" },
                { value: "next", label: "Next week" },
              ]}
            />
          )}
          <div className="flex-1" />
          {enableExport && (
            <button
              type="button"
              onClick={handleExport}
              disabled={filtered.length === 0}
              title={filtered.length === 0 ? "Nothing to export" : "Download the filtered tasks as an Excel file"}
              className="inline-flex items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2 text-[13px] font-semibold text-navy hover:border-orange hover:text-orange transition disabled:opacity-50 disabled:hover:border-line disabled:hover:text-navy"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              Export{filtered.length > 0 ? ` (${filtered.length})` : ""}
            </button>
          )}
        </div>

        {/* active filters */}
        {activeFilters.length > 0 && (
          <ActiveFilters
            filters={activeFilters}
            onClearAll={clearAll}
            className="px-3 py-2.5 border-b border-line bg-page/60"
          />
        )}

        {/*
          The table is rendered even with no matching rows: its header carries the
          filter controls now, so swapping in an EmptyState would take away the
          very controls needed to undo the filter that emptied it.
        */}
        <TaskTable
          tasks={pg.pageItems}
          sort={sort}
          onSort={onSort}
          showDepartment={!!departments}
          emptyMessage={emptyMessage}
          filterRow={{
            title: (
              <div className="relative">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-grey-2" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks…" className="pl-8 py-1.5 text-[12.5px]" />
              </div>
            ),
            department: departments ? (
              <Combobox
                value={dept}
                onChange={handleDeptChange}
                className="w-full"
                triggerClassName="py-1.5 px-2.5 text-[12.5px]"
                options={[{ value: "all", label: "All" }, ...departments.map((d) => ({ value: d.id, label: d.name }))]}
              />
            ) : undefined,
            createdBy: (
              <Combobox
                value={creator}
                onChange={setCreator}
                className="w-full"
                triggerClassName="py-1.5 px-2.5 text-[12.5px]"
                options={[{ value: "all", label: "All" }, ...creatorOptions]}
              />
            ),
            assignedTo: (
              <Combobox
                value={person}
                onChange={handlePersonChange}
                className="w-full"
                triggerClassName="py-1.5 px-2.5 text-[12.5px]"
                options={[
                  { value: "all", label: "All" },
                  ...visiblePeople.map((p) => ({
                    value: p.id,
                    label: p.name,
                    sublabel: p.designation ?? undefined,
                    icon: <Avatar name={p.name} color={p.avatarColor} size={22} />,
                  })),
                ]}
              />
            ),
            createdAt: (
              <DateRangeFilter
                value={assignedRange}
                onChange={setAssignedRange}
                placeholder="Any"
                className="w-full"
                triggerClassName="py-1.5 px-2 gap-1 text-[12.5px]"
              />
            ),
            dueDate: (
              <DateRangeFilter
                value={dueRange}
                onChange={setDueRange}
                placeholder="Any"
                className="w-full"
                triggerClassName="py-1.5 px-2 gap-1 text-[12.5px]"
              />
            ),
            status: (
              <MultiSelect
                values={statuses}
                onChange={(v) => setStatuses(v as StatusFilter[])}
                placeholder="All"
                className="w-full"
                align="right"
                triggerClassName="py-1.5 px-2.5 text-[12.5px]"
                options={STATUS_FILTER_OPTIONS.map((s) => ({ value: s.value, label: s.label }))}
              />
            ),
          }}
        />
        <Pagination state={pg} rowsLabel="tasks" />
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <Card className="px-4 py-3">
      <div className={`text-[22px] font-bold leading-none ${tone}`}>{value}</div>
      <div className="text-[11.5px] text-grey mt-1.5">{label}</div>
    </Card>
  );
}
