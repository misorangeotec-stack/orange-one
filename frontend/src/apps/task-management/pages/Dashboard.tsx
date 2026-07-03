import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Avatar from "@/shared/components/ui/Avatar";
import { dateLabel, timeAgo, formatDate } from "@/shared/lib/time";
import { useSession } from "../mock/session";
import { useTaskStore } from "../mock/store";
import { WEEK_START } from "../mock/data";
import { computeStats, actualRygFor, aggregateRyg } from "../mock/selectors";
import type { ActivityType, AppRole, StatusFilter, Task } from "../types";
import { taskListLink } from "../lib/taskLink";
import StatCard from "../components/StatCard";
import StatusChip from "../components/StatusChip";
import RygBar from "../components/RygBar";
import DonutChart from "../components/DonutChart";
import ReportsToTag from "../components/ReportsToTag";
import ScopeToggle, { scopeTasks, type Scope } from "../components/ScopeToggle";

const STATUS_COLORS = {
  pending: "#8A99B0",
  in_progress: "#3B82F6",
  completed: "#27AE60",
  revised: "#F8B62B",
  shifted: "#FF6A1F",
} as const;

const ICONS = {
  tasks: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8.5 12l2 2 4-4.5" /></svg>,
  clock: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  check: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>,
  revise: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 2v6h6" /><path d="M3 13a9 9 0 1 0 3-7.7L3 8" /></svg>,
  shift: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></svg>,
  flag: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 21V4h13l-2 4 2 4H4" /></svg>,
  users: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3 3-5 6-5s6 2 6 5" /></svg>,
};

export default function Dashboard() {
  const { user, role, isAdmin, isHod } = useSession();
  const { visibleTasks, workspace, canCreateTask, assignableUsers } = useTaskStore();
  const [scope, setScope] = useState<Scope>("week");
  const list = visibleTasks(role, user.id);
  // Scope toggle: "this week" keeps only tasks planned for the current week
  // (weekStart = this Monday, the same boundary the RYG sections use); "all
  // time" keeps the full backlog. Every card + the donut read the scoped list.
  const scopedList = scopeTasks(list, scope);
  const canCreate = canCreateTask && assignableUsers(role, user.id).length > 0;
  const stats = computeStats(scopedList);
  const weekly = scope === "week";
  const firstName = user.name.split(" ")[0];
  // Deep-link a stat card to the role-appropriate task list, scoped to this week
  // when the weekly toggle is on (the destination route already matches the
  // dashboard's role scope: admin → All, HOD → Team, employee → My Tasks).
  const cardLink = (statuses?: StatusFilter[]) =>
    taskListLink({ role, weekStart: weekly ? WEEK_START : undefined, statuses, metricOnly: true });

  return (
    <div className="space-y-5">
      {/* greeting */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="inline-flex items-center bg-orange-soft text-orange font-semibold text-[12px] px-3 py-1.5 rounded-pill">
            {greeting()}, {firstName} 👋
          </span>
          <h2 className="text-[22px] font-bold text-navy mt-3">
            {isAdmin ? "Organization Overview" : isHod ? "Team Overview" : "Your Day at a Glance"}
          </h2>
          <p className="text-grey text-[13px] mt-1">
            {new Date().toLocaleDateString("en-IN", { weekday: "long" })}, {formatDate(new Date().toISOString().slice(0, 10))}
            {" · "}revision limit {workspace.maxRevisionsPerWeek}/week
          </p>
        </div>
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

      {/* scope toggle: this week vs all time */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] text-grey-2">
          {/* Coverage note: the dashboard total is role-scoped (admin = org-wide,
              HOD/sub-HOD = own + downline team, employee = own). Spelling it out
              here explains why this number differs from the personal "My Tasks"
              count, which only ever counts tasks assigned to or created by you. */}
          Showing <b className="text-navy font-semibold">{weekly ? "this week" : "all time"}</b> · {stats.total} task{stats.total !== 1 ? "s" : ""}{" "}
          {isAdmin ? "across the organization" : isHod ? "across your team" : "assigned to or created by you"}
        </span>
        <ScopeToggle scope={scope} onChange={setScope} />
      </div>

      {/* stat cards (role-aware) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {isAdmin || isHod ? (
          <>
            <StatCard label={isAdmin ? "Total Tasks" : "Team Tasks"} value={stats.total} icon={ICONS.tasks} tone="orange" hint={weekly ? "this week" : "all tasks"} to={cardLink()} />
            <StatCard label="Pending" value={stats.pending + stats.inProgress} icon={ICONS.clock} tone="blue" hint={`${stats.overdue} overdue`} to={cardLink(["pending", "in_progress"])} />
            <StatCard label="Completed" value={stats.completed} icon={ICONS.check} tone="green" hint={weekly ? "this week" : "all time"} to={cardLink(["completed"])} />
            <StatCard label="Revised / Shifted" value={`${stats.revised} / ${stats.shifted}`} icon={ICONS.revise} tone="violet" hint="needs attention" to={cardLink(["revised", "shifted"])} />
          </>
        ) : (
          <>
            <StatCard label="Due Today" value={stats.dueToday} icon={ICONS.clock} tone="orange" hint={`${stats.overdue} overdue`} />
            <StatCard label="Pending" value={stats.pending + stats.inProgress} icon={ICONS.tasks} tone="blue" to={cardLink(["pending", "in_progress"])} />
            <StatCard label="Completed" value={stats.completed} icon={ICONS.check} tone="green" hint={weekly ? "this week" : "all time"} to={cardLink(["completed"])} />
            <StatCard label="Follow-ups Due" value={stats.followUpDue} icon={ICONS.flag} tone="rose" />
          </>
        )}
      </div>

      {/* main grid */}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {isAdmin || isHod ? <TeamOrOrgPanel isAdmin={isAdmin} hodId={user.id} /> : <TodayPanel userId={user.id} list={list} />}
        </div>

        <div className="space-y-4">
          {!isAdmin && !isHod && <WeeklyRygCard doerId={user.id} />}
          <StatusBreakdownCard stats={stats} role={role} weekly={weekly} />
          <RecentActivityCard list={list} />
        </div>
      </div>
    </div>
  );
}

/* ---------------- Employee: Today's tasks ---------------- */
function TodayPanel({ userId, list }: { userId: string; list: Task[] }) {
  const mine = list
    .filter((t) => t.assignedTo === userId && t.status !== "completed" && t.status !== "shifted")
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  return (
    <SectionCard title="Today & Upcoming" action={<Link to="/task-management/tasks" className="text-orange text-[12px] font-semibold hover:underline">View all</Link>}>
      {mine.length === 0 ? (
        <Empty>No open tasks. Enjoy the calm 🌤️</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {mine.slice(0, 6).map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/* ---------------- HOD/Admin: team or org performance ---------------- */
function TeamOrOrgPanel({ isAdmin, hodId }: { isAdmin: boolean; hodId: string }) {
  const { tasks, departments, profiles, downlineIds, profileById, weeklyPlanFor } = useTaskStore();
  const navigate = useNavigate();
  // Clicking a member opens their Weekly Scorecard for the current week — same
  // destination as Master Analysis, scoped to the dashboard's fixed week.
  const openScorecard = (id: string) => navigate(`/task-management/scorecard?user=${id}&week=${WEEK_START}`);
  if (isAdmin) {
    return (
      <SectionCard title="Department Performance" subtitle="Actual execution quality this week">
        <ul className="space-y-4">
          {departments.map((dep) => {
            const members = profiles.filter((p) => p.departmentId === dep.id);
            // Actual achieved RYG pooled across the department's tasks this week —
            // the same calculation Master Analysis uses, so the two reconcile.
            const avg = aggregateRyg(members.map((m) => m.id), [WEEK_START], tasks, weeklyPlanFor).actual;
            return (
              <li key={dep.id}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[13px] font-semibold text-navy">{dep.name}</span>
                  <span className="text-[11px] text-grey-2">{members.length} member{members.length !== 1 ? "s" : ""}</span>
                </div>
                <RygBar red={avg.red} yellow={avg.yellow} green={avg.green} showLegend={false} />
              </li>
            );
          })}
        </ul>
      </SectionCard>
    );
  }
  const team = downlineIds(hodId).map((id) => profileById(id)!).filter(Boolean);
  return (
    <SectionCard title="Team Performance" subtitle="Actual execution quality this week" action={<Link to="/task-management/team" className="text-orange text-[12px] font-semibold hover:underline">Team tasks</Link>}>
      {team.length === 0 ? (
        <Empty>No team members mapped yet.</Empty>
      ) : (
        <ul className="space-y-4">
          {team.map((m) => {
            // Actual achieved RYG from this member's tasks this week — matches the
            // per-member row in Master Analysis instead of showing the plan target.
            const ryg = actualRygFor(tasks, m.id, WEEK_START);
            return (
              <li
                key={m.id}
                onClick={() => openScorecard(m.id)}
                title={`Open ${m.name}'s Weekly Scorecard`}
                className="flex items-center gap-3 cursor-pointer rounded-lg -mx-2 px-2 py-1 hover:bg-page/60 transition"
              >
                <Avatar name={m.name} color={m.avatarColor} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[13px] font-semibold text-navy truncate">{m.name}</span>
                      <ReportsToTag person={m} viewerId={hodId} />
                    </span>
                    <span className="text-[11px] text-grey-2 shrink-0">{m.designation}</span>
                  </div>
                  <div className="mt-1.5">
                    <RygBar red={ryg.red} yellow={ryg.yellow} green={ryg.green} showLegend={false} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

/* ---------------- Weekly RYG (employee) ---------------- */
function WeeklyRygCard({ doerId }: { doerId: string }) {
  const { weeklyPlanFor } = useTaskStore();
  const plan = weeklyPlanFor(doerId, WEEK_START);
  return (
    <SectionCard title="This Week (RYG)">
      {plan ? (
        <RygBar red={plan.redPct} yellow={plan.yellowPct} green={plan.greenPct} />
      ) : (
        <Empty>No weekly plan set by your HOD yet.</Empty>
      )}
    </SectionCard>
  );
}

/* ---------------- Status breakdown donut ---------------- */
function StatusBreakdownCard({ stats, role, weekly }: { stats: ReturnType<typeof computeStats>; role: AppRole; weekly: boolean }) {
  const segments = (Object.keys(stats.statusCounts) as Array<keyof typeof STATUS_COLORS>)
    .map((k) => ({
      label: labelFor(k),
      value: stats.statusCounts[k],
      color: STATUS_COLORS[k],
      to: taskListLink({ role, weekStart: weekly ? WEEK_START : undefined, statuses: [k], metricOnly: true }),
    }))
    .filter((s) => s.value > 0);
  return (
    <SectionCard title="Status Breakdown">
      {segments.length === 0 ? <Empty>No tasks yet.</Empty> : <DonutChart segments={segments} />}
    </SectionCard>
  );
}

/* ---------------- Recent activity ---------------- */
function RecentActivityCard({ list }: { list: Task[] }) {
  const { activity, getTask, actorById } = useTaskStore();
  const ids = new Set(list.map((t) => t.id));
  const items = activity.filter((a) => ids.has(a.taskId)).slice(0, 6);
  return (
    <SectionCard title="Recent Activity">
      {items.length === 0 ? (
        <Empty>No recent activity.</Empty>
      ) : (
        <ul className="space-y-3">
          {items.map((a) => {
            const actor = actorById(a.actorId);
            const task = getTask(a.taskId);
            return (
              <li key={a.id} className="flex gap-2.5 text-[12.5px]">
                <span className="mt-0.5 text-orange [&>svg]:w-4 [&>svg]:h-4 shrink-0">{actIcon(a.type)}</span>
                <span className="text-grey leading-snug">
                  <b className="text-navy font-semibold">{actor?.name ?? "Someone"}</b> {actVerb(a.type)}{" "}
                  <b className="text-navy font-medium">“{task?.title ?? "a task"}”</b>
                  <span className="block text-[11px] text-grey-2 mt-0.5">{timeAgo(a.createdAt)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

/* ---------------- small shared bits ---------------- */
function TaskRow({ task }: { task: Task }) {
  const { profileById, actorById, departmentById } = useTaskStore();
  const assignee = profileById(task.assignedTo);
  const creator = actorById(task.createdBy);
  const dept = departmentById(task.departmentId);
  return (
    <li>
      <Link to={`/task-management/tasks/${task.id}`} className="flex items-center gap-3 py-3 group">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="text-[13.5px] font-medium text-navy truncate group-hover:text-orange transition">{task.title}</span>
            {task.recurringTaskId && (
              <svg className="shrink-0 text-blue" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-label="Recurring"><path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>
            )}
          </span>
          {task.description?.trim() && (
            <span className="block text-[12px] text-grey mt-0.5 truncate">{task.description}</span>
          )}
          <span className="block text-[11.5px] text-grey-2 mt-0.5">
            {dept?.name}
            {creator ? ` · by ${creator.name}` : ""}
            {assignee ? ` · ${assignee.name}` : ""}
            {task.revisionCount > 0 ? ` · ${task.revisionCount} revision${task.revisionCount > 1 ? "s" : ""}` : ""}
          </span>
        </span>
        <span className="text-[11.5px] text-grey whitespace-nowrap">{dateLabel(task.dueDate)}</span>
        <StatusChip status={task.status} />
      </Link>
    </li>
  );
}

function SectionCard({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-[14px] font-semibold text-navy">{title}</h3>
          {subtitle && <p className="text-[11.5px] text-grey-2 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] text-grey-2 py-6 text-center">{children}</p>;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}
function labelFor(s: keyof typeof STATUS_COLORS) {
  return { pending: "Pending", in_progress: "In Progress", completed: "Completed", revised: "Revised", shifted: "Shifted" }[s];
}
function actIcon(t: ActivityType) {
  if (t === "completed") return ICONS.check;
  if (t === "revised") return ICONS.revise;
  if (t === "shifted") return ICONS.shift;
  if (t === "followup") return ICONS.flag;
  if (t === "assigned") return ICONS.users;
  return ICONS.clock;
}
function actVerb(t: ActivityType) {
  return {
    created: "created",
    assigned: "assigned",
    revised: "revised",
    followup: "set a follow-up on",
    completed: "completed",
    shifted: "shifted to next week",
    started: "started",
    remark: "commented on",
    reopened: "reopened",
  }[t];
}
