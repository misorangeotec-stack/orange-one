import AppShell from "@/shared/components/layout/AppShell";
import type { NotificationItem } from "@/shared/components/layout/types";
import { timeAgo } from "@/shared/lib/time";
import { taskNav } from "./nav";
import { useSession, ALL_ROLES } from "./mock/session";
import { useTaskStore } from "./mock/store";

const roleLabel = (role: string) => ALL_ROLES.find((r) => r.value === role)?.label ?? role;

/** Wires the session + live task data into the generic AppShell, then renders routes. */
export default function TaskLayout() {
  const { user, role } = useSession();
  const { notifications, getTask, profileById, canWrite } = useTaskStore();

  const notifItems: NotificationItem[] = notifications
    .filter((n) => n.userId === user.id)
    .map((n) => {
      const actor = profileById(n.actorId)?.name ?? "Someone";
      const task = getTask(n.taskId ?? "");
      return {
        id: n.id,
        text: (
          <span>
            <b className="font-semibold text-navy">{actor}</b> mentioned you on{" "}
            <b className="font-semibold text-navy">“{task?.title ?? "a task"}”</b>
          </span>
        ),
        time: timeAgo(n.createdAt),
        unread: !n.readAt,
        to: task ? `/task-management/tasks/${task.id}` : undefined,
      };
    });

  return (
    <AppShell
      nav={taskNav}
      role={role}
      user={{ name: user.name, designation: user.designation, color: user.avatarColor, roleLabel: roleLabel(role) }}
      notifications={notifItems}
      banner={
        canWrite ? undefined : (
          <div className="mb-5 flex items-start gap-3 rounded-card border border-[#F8B62B]/50 bg-[#FEF9EE] px-4 py-3">
            <svg className="mt-0.5 shrink-0 text-[#B7820E]" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
            <p className="text-[12.5px] text-[#9a6e0c] leading-relaxed">
              <b className="font-semibold">Live writes rolling out.</b> Creating tasks now saves to the
              live backend. Other edits (start / revise / complete, etc.) are being wired next and won't
              save yet.
            </p>
          </div>
        )
      }
    />
  );
}
