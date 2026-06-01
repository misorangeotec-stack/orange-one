import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Tabs from "@/shared/components/ui/Tabs";
import Combobox from "@/shared/components/ui/Combobox";
import { TextInput } from "@/shared/components/ui/Form";
import EmptyState from "@/shared/components/ui/EmptyState";
import { isOverdue, isToday } from "@/shared/lib/time";
import { useSession } from "../mock/session";
import { useTaskStore } from "../mock/store";
import type { Task, TaskStatus } from "../types";
import TaskListItem from "../components/TaskListItem";

type View = "all" | "today" | "followup" | "pending";

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
  const { tasks, canCreateTask } = useTaskStore();
  const [params, setParams] = useSearchParams();
  const view = (params.get("view") as View) || "all";
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<TaskStatus | "all">("all");

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
    if (status !== "all") list = list.filter((t) => t.status === status);
    if (q.trim()) list = list.filter((t) => t.title.toLowerCase().includes(q.toLowerCase()));
    return list;
  }, [mine, view, status, q]);

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
          <div className="flex items-center gap-2.5 pb-2">
            <Combobox
              value={status}
              onChange={(v) => setStatus(v as TaskStatus | "all")}
              className="w-auto min-w-[150px]"
              align="right"
              options={STATUS_OPTIONS.map((s) => ({ value: s.value, label: s.label }))}
            />
            <div className="relative">
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

        <div className="divide-y divide-line border-t border-line">
          {filtered.length === 0 ? (
            <EmptyState
              title="No tasks here"
              message={view === "all" ? "Tasks assigned to you will appear here." : "Nothing in this view right now."}
              actionLabel={canCreateTask ? "New Task" : undefined}
              actionTo={canCreateTask ? "/task-management/tasks/new" : undefined}
            />
          ) : (
            filtered.map((t: Task) => <TaskListItem key={t.id} task={t} />)
          )}
        </div>
      </Card>
    </div>
  );
}
