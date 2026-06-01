import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import { TextInput } from "@/shared/components/ui/Form";
import Combobox from "@/shared/components/ui/Combobox";
import Avatar from "@/shared/components/ui/Avatar";
import EmptyState from "@/shared/components/ui/EmptyState";
import Pagination from "@/shared/components/ui/Pagination";
import { usePagination } from "@/shared/lib/usePagination";
import { WEEK_START } from "../mock/data";
import type { Department, Profile, Task, TaskStatus } from "../types";
import TaskListItem from "./TaskListItem";

const STATUS_OPTIONS: { value: TaskStatus | "all"; label: string }[] = [
  { value: "all", label: "All statuses" },
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
}: {
  tasks: Task[];
  people: Profile[];
  departments?: Department[];
  emptyMessage?: string;
}) {
  const [q, setQ] = useState("");
  const [person, setPerson] = useState("all");
  const [dept, setDept] = useState("all");
  const [status, setStatus] = useState<TaskStatus | "all">("all");
  const [week, setWeek] = useState<"all" | "this" | "next">("all");

  const filtered = useMemo(() => {
    const nw = nextWeekStart();
    return tasks.filter((t) => {
      if (person !== "all" && t.assignedTo !== person) return false;
      if (dept !== "all" && t.departmentId !== dept) return false;
      if (status !== "all" && t.status !== status) return false;
      if (week === "this" && t.weekStart !== WEEK_START) return false;
      if (week === "next" && t.weekStart !== nw) return false;
      if (q.trim() && !t.title.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [tasks, person, dept, status, week, q]);

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

  const pg = usePagination(filtered, { resetKey: `${q}|${person}|${dept}|${status}|${week}` });

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
              onChange={setDept}
              className="w-auto min-w-[160px]"
              options={[{ value: "all", label: "All departments" }, ...departments.map((d) => ({ value: d.id, label: d.name }))]}
            />
          )}
          <Combobox
            value={person}
            onChange={setPerson}
            className="w-auto min-w-[170px]"
            options={[
              { value: "all", label: departments ? "All people" : "All team members" },
              ...people.map((p) => ({
                value: p.id,
                label: p.name,
                sublabel: p.designation ?? undefined,
                icon: <Avatar name={p.name} color={p.avatarColor} size={22} />,
              })),
            ]}
          />
          <Combobox
            value={status}
            onChange={(v) => setStatus(v as TaskStatus | "all")}
            className="w-auto min-w-[150px]"
            options={STATUS_OPTIONS.map((s) => ({ value: s.value, label: s.label }))}
          />
          <Combobox
            value={week}
            onChange={(v) => setWeek(v as "all" | "this" | "next")}
            className="w-auto min-w-[130px]"
            options={[
              { value: "all", label: "Any week" },
              { value: "this", label: "This week" },
              { value: "next", label: "Next week" },
            ]}
          />
        </div>

        {/* list */}
        {filtered.length === 0 ? (
          <EmptyState title="Nothing here" message={emptyMessage} />
        ) : (
          <>
            <div className="divide-y divide-line">
              {pg.pageItems.map((t) => <TaskListItem key={t.id} task={t} showAssignee />)}
            </div>
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
