import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import { TextInput } from "@/shared/components/ui/Form";
import Combobox from "@/shared/components/ui/Combobox";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import Avatar from "@/shared/components/ui/Avatar";
import EmptyState from "@/shared/components/ui/EmptyState";
import Pagination from "@/shared/components/ui/Pagination";
import ActiveFilters, { type ActiveFilter } from "@/shared/components/ui/ActiveFilters";
import { usePagination } from "@/shared/lib/usePagination";
import { matchesSearch } from "@/shared/lib/search";
import { WEEK_START } from "../mock/data";
import { useTaskStore } from "../mock/store";
import type { Department, Profile, Task, TaskStatus } from "../types";
import TaskTable, { DEFAULT_TASK_SORT, nextSort, sortTasks, type TaskSort, type TaskSortKey } from "./TaskTable";

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In Progress" },
  { value: "revised", label: "Revised" },
  { value: "completed", label: "Completed" },
  { value: "shifted", label: "Shifted" },
];

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
}: {
  tasks: Task[];
  people: Profile[];
  departments?: Department[];
  emptyMessage?: string;
  /** Hide the internal "Any/This/Next week" dropdown when the parent owns the time scope (e.g. Team Tasks' This-week/All-time toggle). */
  hideWeekFilter?: boolean;
}) {
  const { profileById } = useTaskStore();
  const [q, setQ] = useState("");
  const [person, setPerson] = useState("all");
  const [creator, setCreator] = useState("all");
  const [dept, setDept] = useState("all");
  const [statuses, setStatuses] = useState<TaskStatus[]>([]);
  const [week, setWeek] = useState<"all" | "this" | "next">("all");
  const [sort, setSort] = useState<TaskSort>(DEFAULT_TASK_SORT);
  const onSort = (key: TaskSortKey) => setSort((s) => nextSort(s, key));

  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  // "Created by" options come from the creators that actually appear in these
  // tasks (resolved via the directory), not from `people` — a task's creator may
  // be an admin or the HOD themselves, who aren't in a team-scoped `people` list.
  const creatorOptions = useMemo(() => {
    const ids = [...new Set(tasks.map((t) => t.createdBy))];
    return ids
      .map((id) => ({ value: id, label: profileById(id)?.name ?? "—" }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [tasks, profileById]);

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
    setWeek("all");
  };

  const filtered = useMemo(() => {
    const nw = nextWeekStart();
    return tasks.filter((t) => {
      if (person !== "all" && t.assignedTo !== person) return false;
      if (creator !== "all" && t.createdBy !== creator) return false;
      if (dept !== "all" && t.departmentId !== dept) return false;
      if (statuses.length && !statuses.includes(t.status)) return false;
      if (week === "this" && t.weekStart !== WEEK_START) return false;
      if (week === "next" && t.weekStart !== nw) return false;
      if (!matchesSearch(q, t.title)) return false;
      return true;
    });
  }, [tasks, person, creator, dept, statuses, week, q]);

  // KPI cards reflect the active filters (not the full list).
  const counts = useMemo(() => {
    const c = { total: filtered.length, open: 0, completed: 0, revised: 0, shifted: 0 };
    for (const t of filtered) {
      if (t.status === "pending" || t.status === "in_progress") c.open++;
      else if (t.status === "completed") c.completed++;
      else if (t.status === "revised") c.revised++;
      else if (t.status === "shifted") c.shifted++;
    }
    return c;
  }, [filtered]);

  const sorted = useMemo(
    () => sortTasks(filtered, sort, (id) => profileById(id)?.name),
    [filtered, sort, profileById],
  );

  const pg = usePagination(sorted, { resetKey: `${q}|${person}|${creator}|${dept}|${statuses.join(",")}|${week}|${sort.key}|${sort.dir}` });

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
      label: `Status: ${STATUS_OPTIONS.filter((s) => statuses.includes(s.value)).map((s) => s.label).join(", ")}`,
      onClear: () => setStatuses([]),
    });
  if (week !== "all")
    activeFilters.push({
      key: "week",
      label: week === "this" ? "This week" : "Next week",
      onClear: () => setWeek("all"),
    });

  return (
    <div className="space-y-4">
      {/* stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Stat label="Total" value={counts.total} tone="text-navy" />
        <Stat label="Open" value={counts.open} tone="text-blue" />
        <Stat label="Completed" value={counts.completed} tone="text-[#27AE60]" />
        <Stat label="Revised" value={counts.revised} tone="text-[#B7820E]" />
        <Stat label="Shifted" value={counts.shifted} tone="text-orange" />
      </div>

      <Card className="overflow-hidden">
        {/* filter bar */}
        <div className="p-3 flex flex-wrap items-center gap-2.5 border-b border-line">
          <div className="relative flex-1 min-w-[180px]">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-grey-2" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks…" className="pl-9 py-2 text-[13px]" />
          </div>
          {departments && (
            <Combobox
              value={dept}
              onChange={handleDeptChange}
              className="w-full sm:w-auto sm:min-w-[160px]"
              options={[{ value: "all", label: "All departments" }, ...departments.map((d) => ({ value: d.id, label: d.name }))]}
            />
          )}
          <Combobox
            value={creator}
            onChange={setCreator}
            className="w-full sm:w-auto sm:min-w-[170px]"
            options={[{ value: "all", label: "All creators" }, ...creatorOptions]}
          />
          <Combobox
            value={person}
            onChange={handlePersonChange}
            className="w-full sm:w-auto sm:min-w-[170px]"
            options={[
              { value: "all", label: "All assignees" },
              ...visiblePeople.map((p) => ({
                value: p.id,
                label: p.name,
                sublabel: p.designation ?? undefined,
                icon: <Avatar name={p.name} color={p.avatarColor} size={22} />,
              })),
            ]}
          />
          <MultiSelect
            values={statuses}
            onChange={(v) => setStatuses(v as TaskStatus[])}
            placeholder="All statuses"
            className="w-full sm:w-auto sm:min-w-[150px]"
            options={STATUS_OPTIONS.map((s) => ({ value: s.value, label: s.label }))}
          />
          {!hideWeekFilter && (
            <Combobox
              value={week}
              onChange={(v) => setWeek(v as "all" | "this" | "next")}
              className="w-full sm:w-auto sm:min-w-[130px]"
              options={[
                { value: "all", label: "Any week" },
                { value: "this", label: "This week" },
                { value: "next", label: "Next week" },
              ]}
            />
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

        {/* list */}
        {filtered.length === 0 ? (
          <EmptyState title="Nothing here" message={emptyMessage} />
        ) : (
          <>
            <TaskTable tasks={pg.pageItems} sort={sort} onSort={onSort} />
            <Pagination state={pg} rowsLabel="tasks" />
          </>
        )}
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
