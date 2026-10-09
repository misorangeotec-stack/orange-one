import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { supabase } from "@/core/platform/supabase";
import { useSession } from "@/core/platform/session";
import { TASK_NOTIF_KEY } from "@/apps/task-management/lib/useMyNotifications";
import { fetchMyNotifications } from "@/apps/task-management/data/fetchTaskData";

/**
 * Recurring-task reminders, shown as a pop-up every time the user opens the hub.
 *
 * A template with "Notification required" drops a `task_recurring_reminder` row in
 * the bell N days before its date (send_recurring_reminders, 20270106120100). The
 * bell is easy to miss, so the user asked for these to come up on opening the hub
 * and KEEP coming up until the task is done.
 *
 * "Done" is read from the task the generator mints on the day (same template, due
 * on the reminder's date): completed, Not Applicable or shifted closes the reminder.
 * Before that task exists the reminder stays open; if its date has passed and no
 * task ever came (template paused or edited), it stops, since there is nothing left
 * to complete.
 *
 * "Every time you open the hub" = once per browser tab session: dismissing it
 * hides it until the next visit, not on every return to /home in the same visit.
 */
const SEEN_KEY = "tm:recurring-reminder-popup-seen";

function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "2026-11-10" → "10-11-2026". */
function dmy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

function seenThisSession(): boolean {
  try {
    return window.sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

interface TaskRow {
  id: string;
  recurring_task_id: string;
  due_date: string;
  status: string;
  not_applicable: boolean | null;
}

/**
 * LOCALHOST ONLY: open /home?reminder-preview to see the pop-up with sample rows, without
 * any reminder in the database. Dropped from production builds (import.meta.env.DEV).
 */
function previewRows() {
  if (!import.meta.env.DEV) return null;
  if (!new URLSearchParams(window.location.search).has("reminder-preview")) return null;
  const shift = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  return [
    { recurringTaskId: "preview-1", date: shift(-2), title: "Weekly stock update (sample)", task: undefined },
    { recurringTaskId: "preview-2", date: shift(0), title: "Monthly GST return (sample)", task: undefined },
    { recurringTaskId: "preview-3", date: shift(3), title: "Quarterly audit file (sample)", task: undefined },
  ];
}

export default function RecurringReminderPopup() {
  const preview = useMemo(previewRows, []);
  const { user } = useSession();
  const navigate = useNavigate();
  // Same query key as the bell, so this shares its cache and fetch. NOT useMyNotifications:
  // that would open a third realtime channel for nothing — the bell's subscription already
  // refreshes this shared cache.
  const { data: notifications = [] } = useQuery({
    queryKey: [TASK_NOTIF_KEY, user?.id ?? null],
    queryFn: () => fetchMyNotifications(user!.id),
    enabled: !!user,
  });
  // Preview ignores the "already seen" flag so it always opens; OK still closes it.
  const [dismissed, setDismissed] = useState(() => !preview && seenThisSession());

  // One entry per template + date (a re-sent reminder must not list twice).
  const reminders = useMemo(() => {
    const byKey = new Map<string, { recurringTaskId: string; date: string; title: string }>();
    for (const n of notifications) {
      if (n.type !== "task_recurring_reminder" || !n.recurringTaskId || !n.reminderDate) continue;
      const key = `${n.recurringTaskId}|${n.reminderDate}`;
      if (!byKey.has(key)) {
        byKey.set(key, { recurringTaskId: n.recurringTaskId, date: n.reminderDate, title: n.taskTitle ?? "Recurring task" });
      }
    }
    return [...byKey.values()];
  }, [notifications]);

  const templateIds = [...new Set(reminders.map((r) => r.recurringTaskId))];
  const dates = [...new Set(reminders.map((r) => r.date))];

  // The tasks those reminders turned into, to know which are finished.
  const { data: tasks, isSuccess } = useQuery({
    queryKey: ["recurringReminderTasks", user?.id ?? null, templateIds.join(","), dates.join(",")],
    enabled: !!user && reminders.length > 0 && !dismissed,
    queryFn: async (): Promise<TaskRow[]> => {
      const { data, error } = await supabase
        .from("tasks")
        .select("id,recurring_task_id,due_date,status,not_applicable")
        .in("recurring_task_id", templateIds)
        .in("due_date", dates);
      if (error) throw new Error(error.message);
      return (data ?? []) as TaskRow[];
    },
  });

  const open = useMemo(() => {
    if (preview) return preview;
    if (!isSuccess) return [];
    const today = todayIso();
    return reminders
      .map((r) => ({
        ...r,
        task: (tasks ?? []).find((t) => t.recurring_task_id === r.recurringTaskId && t.due_date === r.date),
      }))
      .filter(({ task, date }) => {
        if (task) return task.status !== "completed" && task.status !== "shifted" && !task.not_applicable;
        return date >= today; // no task yet: still coming; past with no task: nothing to do
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [reminders, tasks, isSuccess, preview]);

  const close = () => {
    try {
      window.sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* private mode: it just shows again next time */
    }
    setDismissed(true);
  };

  if (dismissed || open.length === 0) return null;

  const today = todayIso();
  return (
    <Modal
      open
      onClose={close}
      title="Task reminders"
      subtitle="Recurring tasks coming up or still open. This shows each time you open the hub until they are completed."
      footer={<Button onClick={close}>OK</Button>}
    >
      <ul className="divide-y divide-line">
        {open.map((r) => {
          const when =
            r.date > today ? `Due on ${dmy(r.date)}` : r.date === today ? "Due today" : `Overdue since ${dmy(r.date)}`;
          const tone = r.date < today ? "text-[#d4493f]" : r.date === today ? "text-orange" : "text-grey";
          return (
            <li key={`${r.recurringTaskId}|${r.date}`} className="flex items-center gap-3 py-3">
              <span className="text-[18px] leading-none">🔔</span>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium text-navy truncate">{r.title}</div>
                <div className={`text-[12px] mt-0.5 ${tone}`}>{when}</div>
              </div>
              <Button
                variant="ghost"
                onClick={() => {
                  close();
                  navigate(r.task ? `/task-management/tasks/${r.task.id}` : "/task-management/tasks");
                }}
              >
                Open
              </Button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
