import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Tabs from "@/shared/components/ui/Tabs";
import Combobox from "@/shared/components/ui/Combobox";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import { TextInput } from "@/shared/components/ui/Form";
import EmptyState from "@/shared/components/ui/EmptyState";
import Pagination from "@/shared/components/ui/Pagination";
import ActiveFilters, { type ActiveFilter } from "@/shared/components/ui/ActiveFilters";
import { usePagination } from "@/shared/lib/usePagination";
import { formatDate, isOverdue, isToday } from "@/shared/lib/time";
import { matchesSearch } from "@/shared/lib/search";
import { useSession } from "../mock/session";
import { useTaskStore } from "../mock/store";
import { countsTowardMetrics } from "../mock/selectors";
import { parseTaskFilters } from "../lib/taskLink";
import { STATUS_FILTER_OPTIONS, matchesStatusFilter, type StatusFilter } from "../types";
import TaskTable, { DEFAULT_TASK_SORT, nextSort, sortTasks, type TaskSort, type TaskSortKey } from "../components/TaskTable";
import ScopeToggle, { scopeTasks, type Scope } from "../components/ScopeToggle";
import PersonalTaskModal from "../components/PersonalTaskModal";

type View = "all" | "today" | "followup" | "pending" | "personal";
type Relation = "all" | "assigned" | "created";

const RELATION_OPTIONS: { value: Relation; label: string }[] = [
  { value: "all", label: "Assigned or created by me" },
  { value: "assigned", label: "Assigned to me" },
  { value: "created", label: "Created by me" },
];

/** "My Tasks" — every task assigned to or created by the current user, with tabs. */
export default function TasksList() {
  const { user, role } = useSession();
  const { tasks, canCreateTask, profileById, assignableUsers } = useTaskStore();
  const canCreate = canCreateTask && assignableUsers(role, user.id).length > 0;
  const [params, setParams] = useSearchParams();
  const view = (params.get("view") as View) || "all";
  // Seed status + an exact week from a deep-link (e.g. a RYG number on the scorecard).
  const initialFilters = useMemo(() => parseTaskFilters(params), [params]);
  const [q, setQ] = useState("");
  const [statuses, setStatuses] = useState<StatusFilter[]>(initialFilters.statuses);
  const [relation, setRelation] = useState<Relation>("assigned");
  const [scope, setScope] = useState<Scope>("week");
  // A specific ISO-Monday week from a deep-link; when set it overrides the
  // this-week/all-time scope so a historical week's tasks are shown.
  const [exactWeek, setExactWeek] = useState<string | null>(initialFilters.week ?? null);
  // Exclude personal + N/A tasks (set when arriving from a score number).
  const [metricOnly, setMetricOnly] = useState(initialFilters.metricOnly);
  const [sort, setSort] = useState<TaskSort>(DEFAULT_TASK_SORT);
  const onSort = (key: TaskSortKey) => setSort((s) => nextSort(s, key));
  const [personalOpen, setPersonalOpen] = useState(false);

  const mine = useMemo(
    () =>
      tasks
        .filter((t) => t.assignedTo === user.id || t.createdBy === user.id)
        .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999")),
    [tasks, user.id]
  );

  // Everything EXCEPT the tab (view) selection: time scope + relation + status +
  // search. The tab counters read from this so they reflect the active filters
  // (previously they counted the full list and never moved when a filter changed).
  const base = useMemo(() => {
    let list = exactWeek ? mine.filter((t) => t.weekStart === exactWeek) : scopeTasks(mine, scope);
    if (metricOnly) list = list.filter(countsTowardMetrics);
    if (relation === "assigned") list = list.filter((t) => t.assignedTo === user.id);
    else if (relation === "created") list = list.filter((t) => t.createdBy === user.id);
    if (statuses.length) list = list.filter((t) => matchesStatusFilter(t, statuses));
    if (q.trim()) list = list.filter((t) => matchesSearch(q, t.title, t.description));
    return list;
  }, [mine, scope, exactWeek, metricOnly, relation, statuses, q, user.id]);

  const counts = useMemo(
    () => ({
      all: base.length,
      today: base.filter((t) => isToday(t.dueDate) && t.status !== "completed").length,
      followup: base.filter((t) => t.followUpDate && (isToday(t.followUpDate) || isOverdue(t.followUpDate)) && t.status !== "completed").length,
      pending: base.filter((t) => !t.notApplicable && (t.status === "pending" || t.status === "in_progress")).length,
      personal: base.filter((t) => t.isPersonal).length,
    }),
    [base]
  );

  const filtered = useMemo(() => {
    let list = base;
    if (view === "today") list = list.filter((t) => isToday(t.dueDate) && t.status !== "completed");
    else if (view === "followup")
      list = list.filter((t) => t.followUpDate && (isToday(t.followUpDate) || isOverdue(t.followUpDate)) && t.status !== "completed");
    else if (view === "pending") list = list.filter((t) => !t.notApplicable && (t.status === "pending" || t.status === "in_progress"));
    else if (view === "personal") list = list.filter((t) => t.isPersonal);
    return list;
  }, [base, view]);

  const sorted = useMemo(
    () => sortTasks(filtered, sort, (id) => profileById(id)?.name),
    [filtered, sort, profileById],
  );

  const pg = usePagination(sorted, { resetKey: `${view}|${statuses.join(",")}|${q}|${relation}|${scope}|${exactWeek ?? ""}|${metricOnly}|${sort.key}|${sort.dir}` });

  const activeFilters: ActiveFilter[] = [];
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
  if (relation !== "all")
    activeFilters.push({
      key: "relation",
      label: RELATION_OPTIONS.find((r) => r.value === relation)?.label ?? relation,
      onClear: () => setRelation("all"),
    });
  if (statuses.length)
    activeFilters.push({
      key: "status",
      label: `Status: ${STATUS_FILTER_OPTIONS.filter((s) => statuses.includes(s.value)).map((s) => s.label).join(", ")}`,
      onClear: () => setStatuses([]),
    });
  if (q.trim()) activeFilters.push({ key: "q", label: `Search: “${q.trim()}”`, onClear: () => setQ("") });
  const clearAll = () => {
    setStatuses([]);
    setQ("");
    setRelation("all");
    setExactWeek(null);
    setMetricOnly(false);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-bold text-navy">My Tasks</h2>
          <p className="text-grey text-[13px] mt-1">Everything assigned to you or created by you.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => setPersonalOpen(true)}
            className="inline-flex items-center gap-2 bg-white text-navy font-semibold text-sm px-4 py-2.5 rounded-xl border border-line hover:border-orange hover:text-orange transition"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Add personal task
          </button>
          {canCreate && (
            <Link
              to="/task-management/tasks/new"
              className="inline-flex items-center gap-2 bg-orange-grad text-white font-semibold text-sm px-4 py-2.5 rounded-xl shadow-cta hover:-translate-y-0.5 transition"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              New Task
            </Link>
          )}
        </div>
      </div>

      <PersonalTaskModal open={personalOpen} onClose={() => setPersonalOpen(false)} />

      {/* scope toggle: this week vs all time — same placement as the dashboard */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] text-grey-2">
          Showing <b className="text-navy font-semibold">{scope === "week" ? "this week" : "all time"}</b> · {counts.all} task{counts.all !== 1 ? "s" : ""}
        </span>
        <ScopeToggle scope={scope} onChange={setScope} />
      </div>

      <Card className="overflow-hidden">
        <div className="px-4 pt-3 flex flex-wrap items-center justify-between gap-3">
          <Tabs
            tabs={[
              { key: "all", label: "All", count: counts.all },
              { key: "today", label: "Today", count: counts.today },
              { key: "followup", label: "Follow-ups", count: counts.followup },
              { key: "pending", label: "Pending", count: counts.pending },
              { key: "personal", label: "Personal", count: counts.personal },
            ]}
            active={view}
            onChange={(k) => setParams(k === "all" ? {} : { view: k }, { replace: true })}
          />
          <div className="flex flex-wrap items-center gap-2.5 pb-2 w-full sm:w-auto">
            <Combobox
              value={relation}
              onChange={(v) => setRelation(v as Relation)}
              className="w-full sm:w-auto sm:min-w-[190px]"
              align="right"
              options={RELATION_OPTIONS.map((r) => ({ value: r.value, label: r.label }))}
            />
            <MultiSelect
              values={statuses}
              onChange={(v) => setStatuses(v as StatusFilter[])}
              placeholder="Any status"
              className="w-full sm:w-auto sm:min-w-[150px]"
              align="right"
              options={STATUS_FILTER_OPTIONS.map((s) => ({ value: s.value, label: s.label }))}
            />
            <div className="relative w-full sm:w-auto">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-grey-2" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              <TextInput
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search tasks…"
                className="pl-9 py-2 w-full sm:w-56 text-[13px]"
              />
            </div>
          </div>
        </div>

        {activeFilters.length > 0 && (
          <ActiveFilters
            filters={activeFilters}
            onClearAll={clearAll}
            className="px-4 py-2.5 mt-1 border-t border-line bg-page/60"
          />
        )}

        {filtered.length === 0 ? (
          <div className="border-t border-line">
            <EmptyState
              title="No tasks here"
              message={view === "all" ? "Tasks assigned to you will appear here." : "Nothing in this view right now."}
              actionLabel={canCreate ? "New Task" : undefined}
              actionTo={canCreate ? "/task-management/tasks/new" : undefined}
            />
          </div>
        ) : (
          <>
            <div className="border-t border-line">
              <TaskTable tasks={pg.pageItems} sort={sort} onSort={onSort} />
            </div>
            <Pagination state={pg} rowsLabel="tasks" />
          </>
        )}
      </Card>
    </div>
  );
}
