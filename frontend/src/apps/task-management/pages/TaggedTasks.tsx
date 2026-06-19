import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import { TextInput } from "@/shared/components/ui/Form";
import EmptyState from "@/shared/components/ui/EmptyState";
import Pagination from "@/shared/components/ui/Pagination";
import ActiveFilters, { type ActiveFilter } from "@/shared/components/ui/ActiveFilters";
import { usePagination } from "@/shared/lib/usePagination";
import { matchesSearch } from "@/shared/lib/search";
import { useSession } from "../mock/session";
import { useTaskStore } from "../mock/store";
import { STATUS_FILTER_OPTIONS, matchesStatusFilter, type StatusFilter } from "../types";
import TaskTable, { DEFAULT_TASK_SORT, nextSort, sortTasks, type TaskSort, type TaskSortKey } from "../components/TaskTable";
import ScopeToggle, { scopeTasks, type Scope } from "../components/ScopeToggle";

/** "Tagged" — every task the current user has been @mentioned in (in a remark). */
export default function TaggedTasks() {
  const { user } = useSession();
  const { tasks, notifications, profileById } = useTaskStore();
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<Scope>("week");
  const [statuses, setStatuses] = useState<StatusFilter[]>([]);
  const [sort, setSort] = useState<TaskSort>(DEFAULT_TASK_SORT);
  const onSort = (key: TaskSortKey) => setSort((s) => nextSort(s, key));

  // Tasks I've been tagged in = tasks referenced by my own mention notifications.
  // notifications are RLS-scoped to the caller, so this is the source of truth.
  const taggedIds = useMemo(
    () => new Set(notifications.filter((n) => n.userId === user.id && n.type === "mention").map((n) => n.taskId)),
    [notifications, user.id]
  );

  const mine = useMemo(
    () =>
      tasks
        .filter((t) => taggedIds.has(t.id))
        .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999")),
    [tasks, taggedIds]
  );

  const filtered = useMemo(() => {
    let list = scopeTasks(mine, scope);
    if (statuses.length) list = list.filter((t) => matchesStatusFilter(t, statuses));
    if (q.trim()) list = list.filter((t) => matchesSearch(q, t.title, t.description));
    return list;
  }, [mine, scope, statuses, q]);

  const sorted = useMemo(
    () => sortTasks(filtered, sort, (id) => profileById(id)?.name),
    [filtered, sort, profileById],
  );

  const pg = usePagination(sorted, { resetKey: `${scope}|${statuses.join(",")}|${q}|${sort.key}|${sort.dir}` });

  const activeFilters: ActiveFilter[] = [];
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
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-bold text-navy">Tagged</h2>
          <p className="text-grey text-[13px] mt-1">Tasks you've been mentioned in.</p>
        </div>
      </div>

      {/* scope toggle: this week vs all time — same placement as the dashboard */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] text-grey-2">
          Showing <b className="text-navy font-semibold">{scope === "week" ? "this week" : "all time"}</b> · {filtered.length} task{filtered.length !== 1 ? "s" : ""}
        </span>
        <ScopeToggle scope={scope} onChange={setScope} />
      </div>

      <Card className="overflow-hidden">
        <div className="px-4 pt-3 flex flex-wrap items-center justify-end gap-3">
          <div className="flex flex-wrap items-center gap-2.5 pb-2 w-full sm:w-auto">
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
              title="No tagged tasks"
              message="When someone @mentions you in a task remark, that task will appear here."
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
