import { useMemo } from "react";
import AppShell from "@/shared/components/layout/AppShell";
import type { NotificationItem } from "@/shared/components/layout/types";
import { buildTaskNav } from "./nav";
import { useSession, roleLabel } from "./mock/session";
import { useTaskStore } from "./mock/store";
import { notificationMessage, notificationLink } from "./lib/notifyText";


/** Wires the session + live task data into the generic AppShell, then renders routes. */
export default function TaskLayout() {
  const { user, role } = useSession();
  const { myNotifications, unreadCount, getTask, actorById, markNotificationsRead } = useTaskStore();

  // Rebuilt only when the unread count changes, not on every render.
  const nav = useMemo(() => buildTaskNav({ unreadCount }), [unreadCount]);

  const notifItems: NotificationItem[] = myNotifications.map((n) => {
    const actor = actorById(n.actorId);
    return {
      id: n.id,
      actorName: actor?.name ?? "Someone",
      actorColor: actor?.avatarColor,
      // Wording lives in lib/notifyText so the bell, the Notifications page, the
      // dashboard panel and the /home bell can't drift apart. Prefer the live task
      // (fresher title) and let the builder fall back to the row's own copy.
      message: notificationMessage(n, { taskTitle: getTask(n.taskId ?? "")?.title }),
      createdAt: n.createdAt,
      unread: !n.readAt,
      to: notificationLink(n),
    };
  });

  return (
    <AppShell
      nav={nav}
      role={role}
      user={{ name: user.name, designation: user.designation, color: user.avatarColor, roleLabel: roleLabel(role) }}
      notifications={notifItems}
      onMarkRead={(ids) => { void markNotificationsRead(ids); }}
    />
  );
}
