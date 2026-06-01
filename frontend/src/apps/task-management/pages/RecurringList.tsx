import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Avatar from "@/shared/components/ui/Avatar";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import EmptyState from "@/shared/components/ui/EmptyState";
import { cn } from "@/shared/lib/cn";
import { useSession } from "../mock/session";
import { useTaskStore } from "../mock/store";
import { MONTH_LAST_DAY, type RecurringTask } from "../types";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function frequencyText(r: RecurringTask) {
  if (r.recurrenceType === "daily") return "Every working day";
  if (r.recurrenceType === "monthly") {
    if (!r.monthlyDays.length) return "Monthly";
    const parts = r.monthlyDays.map((d) => (d === MONTH_LAST_DAY ? "last day" : ordinal(d)));
    return "Every month on the " + parts.join(", ");
  }
  if (!r.weeklyDays.length) return "Weekly";
  return "Every " + r.weeklyDays.map((d) => DOW[d]).join(", ");
}

/** Manage recurring task templates (daily / weekly / monthly). HOD + admin. */
export default function RecurringList() {
  const { user, role } = useSession();
  const { recurringTasks, toggleRecurring, deleteRecurring, directReportIds, profileById, canWrite } = useTaskStore();
  const navigate = useNavigate();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const visible = useMemo(() => {
    if (role === "admin") return recurringTasks;
    const team = new Set([user.id, ...directReportIds(user.id)]);
    return recurringTasks.filter((r) => r.createdBy === user.id || (r.assignedTo && team.has(r.assignedTo)));
  }, [recurringTasks, role, user.id]);

  const target = recurringTasks.find((r) => r.id === confirmId);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-bold text-navy">Recurring Tasks</h2>
          <p className="text-grey text-[13px] mt-1">Automate repetitive work with daily, weekly, and monthly templates.</p>
        </div>
        {canWrite && (
          <Link
            to="/task-management/recurring/new"
            className="inline-flex items-center gap-2 bg-orange-grad text-white font-semibold text-sm px-4 py-2.5 rounded-xl shadow-cta hover:-translate-y-0.5 transition"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            New Recurring Task
          </Link>
        )}
      </div>

      <Card className="overflow-hidden">
        {visible.length === 0 ? (
          <EmptyState
            title="No recurring tasks yet"
            message="Set up a daily, weekly, or monthly template and it will generate tasks automatically."
            actionLabel={canWrite ? "New Recurring Task" : undefined}
            actionTo={canWrite ? "/task-management/recurring/new" : undefined}
          />
        ) : (
          <ul className="divide-y divide-line">
            {visible.map((r) => {
              const assignee = profileById(r.assignedTo);
              return (
                <li key={r.id} className="flex items-center gap-4 px-4 py-4">
                  <span className={cn("w-9 h-9 rounded-card flex items-center justify-center shrink-0", r.active ? "bg-orange-soft text-orange" : "bg-page text-grey-2")}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-medium text-navy truncate">{r.title}</span>
                      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide rounded-pill px-1.5 py-0.5 bg-[#EAF1FE] text-blue">
                        {r.recurrenceType}
                      </span>
                    </div>
                    <div className="text-[11.5px] text-grey-2 mt-0.5 truncate">{frequencyText(r)}</div>
                  </div>

                  {assignee && (
                    <span className="hidden sm:inline-flex items-center gap-2 shrink-0">
                      <Avatar name={assignee.name} color={assignee.avatarColor} size={26} />
                      <span className="text-[12.5px] text-navy">{assignee.name}</span>
                    </span>
                  )}

                  <button
                    onClick={() => toggleRecurring(r.id)}
                    disabled={!canWrite}
                    title={!canWrite ? "Read-only preview" : r.active ? "Active — click to pause" : "Paused — click to resume"}
                    className={cn("relative w-10 h-[22px] rounded-full transition shrink-0 disabled:opacity-50", r.active ? "bg-[#27AE60]" : "bg-line")}
                  >
                    <span className={cn("absolute top-0.5 w-[18px] h-[18px] rounded-full bg-white shadow transition-all", r.active ? "left-[20px]" : "left-0.5")} />
                  </button>

                  <button onClick={() => navigate(`/task-management/recurring/${r.id}/edit`)} disabled={!canWrite} className="text-grey-2 hover:text-orange transition p-1 shrink-0 disabled:opacity-40 disabled:hover:text-grey-2" title={canWrite ? "Edit" : "Read-only preview"}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                  </button>
                  <button onClick={() => setConfirmId(r.id)} disabled={!canWrite} className="text-grey-2 hover:text-[#d4493f] transition p-1 shrink-0 disabled:opacity-40 disabled:hover:text-grey-2" title={canWrite ? "Delete" : "Read-only preview"}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Modal
        open={!!confirmId}
        onClose={() => setConfirmId(null)}
        title="Delete recurring task?"
        subtitle={target?.title}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmId(null)}>Cancel</Button>
            <Button
              className="!bg-[#d4493f] !shadow-none hover:!bg-[#bf3d34]"
              onClick={() => {
                if (confirmId) deleteRecurring(confirmId);
                setConfirmId(null);
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-[14px] text-grey leading-relaxed">
          This stops future tasks from being generated. Tasks already created from it are not affected.
        </p>
      </Modal>
    </div>
  );
}
