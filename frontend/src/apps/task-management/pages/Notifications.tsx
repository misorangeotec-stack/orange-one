import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import EmptyState from "@/shared/components/ui/EmptyState";
import Pagination from "@/shared/components/ui/Pagination";
import { usePagination } from "@/shared/lib/usePagination";
import { useStickyScope, useStickyState } from "@/shared/lib/stickyState";
import { timeAgo, formatDateTime } from "@/shared/lib/time";
import { cn } from "@/shared/lib/cn";
import { useTaskStore } from "../mock/store";
import { notificationText, notificationLink } from "../lib/notifyText";

type Filter = "all" | "unread";

/**
 * The full notification inbox — everything the topbar bell shows a slice of,
 * paginated, with an unread-only lens.
 *
 * The filter is a local two-pill toggle rather than the shared ScopeToggle:
 * that component is hardcoded to the week/all-time Scope union and imports
 * WEEK_START, so it isn't reusable here. The styling is copied so the two read
 * as the same control.
 */
export default function Notifications() {
  const { myNotifications, unreadCount, getTask, actorById, markNotificationsRead, markNotificationsUnread } = useTaskStore();
  const navigate = useNavigate();

  const sticky = useStickyScope("tm:notifications");
  const [filter, setFilter] = useStickyState<Filter>(sticky, "filter", "all");

  const shown = useMemo(
    () => (filter === "unread" ? myNotifications.filter((n) => !n.readAt) : myNotifications),
    [myNotifications, filter]
  );

  const pageState = useStickyState(sticky, "page", 1);
  const pg = usePagination(shown, { resetKey: filter, pageState });

  const unreadIds = myNotifications.filter((n) => !n.readAt).map((n) => n.id);

  // Clicking a row does what the bell does: mark it read, then go to the task.
  const open = (id: string, wasUnread: boolean, to?: string) => {
    if (wasUnread) void markNotificationsRead([id]);
    if (to) navigate(to);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-bold text-navy">Notifications</h2>
          <p className="text-grey text-[13px] mt-1">Tasks assigned to you and remarks you were mentioned in.</p>
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={() => void markNotificationsRead(unreadIds)}
            className="text-[12px] font-semibold text-orange hover:underline"
          >
            Mark all read
          </button>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] text-grey-2">
          <b className="text-navy font-semibold">{unreadCount}</b> unread · {myNotifications.length} total
        </span>
        <div className="inline-flex items-center rounded-pill bg-page border border-line p-0.5 text-[12px] font-semibold">
          {([
            { key: "all", label: "All" },
            { key: "unread", label: "Unread only" },
          ] as { key: Filter; label: string }[]).map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setFilter(o.key)}
              className={cn(
                "px-3 py-1.5 rounded-pill transition",
                filter === o.key ? "bg-white text-navy shadow-sm" : "text-grey-2 hover:text-navy"
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <Card className="overflow-hidden">
        {shown.length === 0 ? (
          <EmptyState
            title={filter === "unread" ? "Nothing unread" : "No notifications yet"}
            message={
              filter === "unread"
                ? "You're all caught up."
                : "When someone assigns you a task or mentions you in a remark, it will show up here."
            }
          />
        ) : (
          <>
            <div className="divide-y divide-line">
              {pg.pageItems.map((n) => {
                const to = notificationLink(n);
                const unread = !n.readAt;
                return (
                  <div
                    key={n.id}
                    onClick={() => open(n.id, unread, to)}
                    className={cn(
                      "group flex items-start gap-3 px-4 py-3.5 transition",
                      to && "cursor-pointer hover:bg-page",
                      // Same tint the bell uses for an unread row, so the two
                      // surfaces read as one signal.
                      unread && "bg-orange-soft/40"
                    )}
                  >
                    <span className={cn("mt-1.5 w-1.5 h-1.5 rounded-full shrink-0", unread ? "bg-orange" : "bg-transparent")} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-ink leading-snug">
                        {notificationText(n, {
                          actorName: actorById(n.actorId)?.name ?? "Someone",
                          taskTitle: getTask(n.taskId ?? "")?.title,
                        })}
                      </div>
                      <div className="text-[11px] text-grey-2 mt-0.5" title={formatDateTime(n.createdAt)}>
                        {timeAgo(n.createdAt)}
                      </div>
                    </div>
                    {/* The row itself navigates; these only flip read state. */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void (unread ? markNotificationsRead([n.id]) : markNotificationsUnread([n.id]));
                      }}
                      className={cn(
                        "shrink-0 text-[11px] font-semibold hover:underline opacity-0 group-hover:opacity-100 focus:opacity-100 transition",
                        unread ? "text-orange" : "text-grey-2 hover:text-navy"
                      )}
                    >
                      {unread ? "Mark read" : "Mark unread"}
                    </button>
                  </div>
                );
              })}
            </div>
            <Pagination state={pg} rowsLabel="notifications" />
          </>
        )}
      </Card>
    </div>
  );
}
