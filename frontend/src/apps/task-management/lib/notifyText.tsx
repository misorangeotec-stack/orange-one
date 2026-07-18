import type { ReactNode } from "react";
import type { Notification } from "../types";

/**
 * The single place a notification is turned into words and a link.
 *
 * FOUR surfaces render the same notification: the topbar bell inside the task
 * app, the bell on the portal home screen, the Notifications page, and the
 * dashboard's unread panel. Each one used to be free to phrase it differently —
 * TaskLayout hardcoded its own JSX — which is exactly how the same event ends up
 * reading three different ways. Everything renders through here instead.
 */

/** Fallback when the linked task is gone or no longer readable under RLS. */
const A_TASK = "a task";

/**
 * The wording MINUS the actor — "assigned you “X”".
 *
 * The bell renders the actor as a byline on its own line, so it needs the
 * predicate alone. Everything else still wants the full sentence, which is why
 * `notificationText` below is written on top of this one: two presentations,
 * one switch, no way for them to drift.
 */
export function notificationMessage(
  n: Notification,
  ctx: { taskTitle?: string | null }
): ReactNode {
  // Prefer a live title (the task app has the tasks array) and fall back to the
  // one carried on the row itself, which is all /home has.
  const raw = ctx.taskTitle ?? n.taskTitle;
  const title = <b className="font-semibold text-navy">{raw ? `“${raw}”` : A_TASK}</b>;

  switch (n.type) {
    case "assigned":
      return <span>assigned you {title}</span>;
    case "mention":
      return <span>mentioned you on {title}</span>;
    default:
      // A notification_type added in SQL before the frontend knows about it must
      // still render a row rather than crash the bell.
      return <span>updated {title}</span>;
  }
}

export function notificationText(
  n: Notification,
  ctx: { actorName: string; taskTitle?: string | null }
): ReactNode {
  return (
    <span>
      <b className="font-semibold text-navy">{ctx.actorName}</b> {notificationMessage(n, ctx)}
    </span>
  );
}

/** Where a notification takes you. Null task = nowhere (the row stays inert). */
export function notificationLink(n: Notification): string | undefined {
  return n.taskId ? `/task-management/tasks/${n.taskId}` : undefined;
}
