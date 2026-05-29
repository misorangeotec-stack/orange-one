import AppShell from "@/shared/components/layout/AppShell";
import type { NotificationItem } from "@/shared/components/layout/types";
import { timeAgo } from "@/shared/lib/time";
import { taskNav } from "./nav";
import { useSession, ALL_ROLES } from "./mock/session";
import RoleSwitcher from "./components/RoleSwitcher";
import { notifications, profileById, tasks } from "./mock/data";

const roleLabel = (role: string) => ALL_ROLES.find((r) => r.value === role)?.label ?? role;

/** Wires the mock session + data into the generic AppShell, then renders routes. */
export default function TaskLayout() {
  const { user, role } = useSession();

  const notifItems: NotificationItem[] = notifications
    .filter((n) => n.userId === user.id)
    .map((n) => {
      const actor = profileById(n.actorId)?.name ?? "Someone";
      const task = tasks.find((t) => t.id === n.taskId);
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
      roleSwitcher={<RoleSwitcher />}
    />
  );
}
