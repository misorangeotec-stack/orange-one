import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Tabs from "@/shared/components/ui/Tabs";
import Combobox from "@/shared/components/ui/Combobox";
import { TextInput } from "@/shared/components/ui/Form";
import EmptyState from "@/shared/components/ui/EmptyState";
import Pagination from "@/shared/components/ui/Pagination";
import ActiveFilters, { type ActiveFilter } from "@/shared/components/ui/ActiveFilters";
import { usePagination } from "@/shared/lib/usePagination";
import { isOverdue, isToday } from "@/shared/lib/time";
import { useSession } from "../mock/session";
import { useTaskStore } from "../mock/store";
import type { TaskStatus } from "../types";
import TaskTable, { DEFAULT_TASK_SORT, nextSort, sortTasks, type TaskSort, type TaskSortKey } from "../components/TaskTable";

type View = "all" | "today" | "followup" | "pending";
type Relation = "all" | "assigned" | "created";

const RELATION_OPTIONS: { value: Relation; label: string }[] = [
  { value: "all", label: "Assigned or created by me" },
  { value: "assigned", label: "Assigned to me" },
  { value: "created", label: "Created by me" },
];

const STATUS_OPTIONS: { value: TaskStatus | "all"; label: string }[] = [
  { value: "all", label: "Any status" },
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In Progress" },
  { value: "revised", label: "Revised" },
  { value: "completed", label: "Completed" },
  { value: "shifted", label: "Shifted" },
];

/** "My Tasks" — every task assigned to or created by the current user, with tabs. */
export default function TasksList() {
  const { user } = useSession();
  const { tasks, canCreateTask, profileById } = useTaskStore();
  const [params, setParams] = useSearchParams();
  const view = (params.get("view") as View) || "all";
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<TaskStatus | "all">("all");
  const [relation, setRelation] = useState<Relation>("all");
  const [sort, setSort] = useState<TaskSort>(DEFAULT_TASK_SORT);
  const onSort = (key: TaskSortKey) => setSort((s) => nextSort(s, key));

  const mine = useMemo(
    () =>
      tasks
        .filter((t) => t.assignedTo === user.id || t.createdBy === user.id)
        .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999")),
    [tasks, user.id]
  );

  const counts = useMemo(
    () => ({
      all: mine.length,
      today: mine.filter((t) => isToday(t.dueDate) && t.status !== "completed").length,
      followup: mine.filter((t) => t.followUpDate && (isToday(t.followUpDate) || isOverdue(t.followUpDate)) && t.status !== "completed").length,
      pending: mine.filter((t) => t.status === "pending" || t.status === "in_progress").length,
    }),
    [mine]
  );

  const filtered = useMemo(() => {
    let list = mine;
    if (view === "today") list = list.filter((t) => isToday(t.dueDate) && t.status !== "completed");
    else if (view === "followup")
      list = list.filter((t) => t.followUpDate && (isToday(t.followUpDate) || isOverdue(t.followUpDate)) && t.status !== "completed");
    else if (view === "pending") list = list.filter((t) => t.status === "pending" || t.status === "in_progress");
    if (relation === "assigned") list = list.filter((t) => t.assignedTo === user.id);
    else if (relation === "created") list = list.filter((t) => t.createdBy === user.id);
    if (status !== "all") list = list.filter((t) => t.status === status);
    if (q.trim()) list = list.filter((t) => t.title.toLowerCase().includes(q.toLowerCase()));
    return list;
  }, [mine, view, status, q, relation, user.id]);

  const sorted = useMemo(
    () => sortTasks(filtered, sort, (id) => profileById(id)?.name),
    [filtered, sort, profileById],
  );

  const pg = usePagination(sorted, { resetKey: `${view}|${status}|${q}|${relation}|${sort.key}|${sort.dir}` });

  const activeFilters: ActiveFilter[] = [];
  if (relation !== "all")
    activeFilters.push({
      key: "relation",
      label: RELATION_OPTIONS.find((r) => r.value === relation)?.label ?? relation,
      onClear: () => setRelation("all"),
    });
  if (status !== "all")
    activeFilters.push({
      key: "status",
      label: `Status: ${STATUS_OPTIONS.find((s) => s.value === status)?.label ?? status}`,
      onClear: () => setStatus("all"),
    });
  if (q.trim()) activeFilters.push({ key: "q", label: `Search: “${q.trim()}”`, onClear: () => setQ("") });
  const clearAll = () => {
    setStatus("all");
    setQ("");
    setRelation("all");
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-bold text-navy">My Tasks</h2>
          <p className="text-grey text-[13px] mt-1">Everything assigned to you or created by you.</p>
        </div>
        {canCreateTask && (
          <Link
            to="/task-management/tasks/new"
            className="inline-flex items-center gap-2 bg-orange-grad text-white font-semibold text-sm px-4 py-2.5 rounded-xl shadow-cta hover:-translate-y-0.5 transition"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            New Task
          </Link>
        )}
      </div>

      <Card className="overflow-hidden">
        <div className="px-4 pt-3 flex flex-wrap items-center justify-between gap-3">
          <Tabs
            tabs={[
              { key: "all", label: "All", count: counts.all },
              { key: "today", label: "Today", count: counts.today },
              { key: "followup", label: "Follow-ups", count: counts.followup },
              { key: "pending", label: "Pending", count: counts.pending },
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
            <Combobox
              value={status}
              onChange={(v) => setStatus(v as TaskStatus | "all")}
              className="w-full sm:w-auto sm:min-w-[150px]"
              align="right"
              options={STATUS_OPTIONS.map((s) => ({ value: s.value, label: s.label }))}
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
              actionLabel={canCreateTask ? "New Task" : undefined}
              actionTo={canCreateTask ? "/task-management/tasks/new" : undefined}
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
