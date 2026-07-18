import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/shared/lib/cn";
import Avatar from "@/shared/components/ui/Avatar";
import { timeAgoShort, formatDateTime } from "@/shared/lib/time";
import type { NotificationItem } from "./types";

/**
 * Topbar bell: unread COUNT badge + dropdown of what is still UNREAD.
 *
 * Shared by every app (task management and the five FMS apps), so anything
 * added here lands everywhere at once.
 *
 * It is an inbox, not an archive. It used to list every notification ever
 * received behind an All/Unread filter, which meant the bell never emptied and
 * you could not tell at a glance what was new. Now reading something is how you
 * clear it: the list is unread-only, so a row you click disappears.
 *
 * IMPORTANT: the unread filter lives HERE and must not be pushed down into the
 * queries or stores. The task app's Tagged screen derives its whole task set
 * from the same notification array INCLUDING read rows — filtering upstream
 * would silently empty that screen without erroring.
 *
 * Nothing is deleted. Rows are marked read (`read_at`), which matters beyond
 * tidiness: a 'mention' row is what grants read access to the task you were
 * tagged in, so deleting one would revoke that access.
 */
export default function NotificationsBell({
  items,
  onMarkRead,
}: {
  items: NotificationItem[];
  onMarkRead?: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Newest first. Belt-and-braces: three of the FMS stores don't sort their own
  // feed, so without this their bells read oldest-first.
  const shown = useMemo(
    () =>
      items
        .filter((i) => i.unread)
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [items]
  );
  const unreadIds = useMemo(() => shown.map((i) => i.id), [shown]);
  const unread = unreadIds.length;

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Re-render the relative times once a minute WHILE OPEN, so a panel left
  // sitting there doesn't freeze at "3m". Costs nothing when closed.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative w-10 h-10 rounded-xl bg-white border border-line text-grey flex items-center justify-center hover:text-navy hover:border-[#d9e2f0] transition"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 && (
          // A count, not a dot. Caps at 99+ so a long-neglected inbox can't
          // stretch the pill across the topbar.
          <span
            className={cn(
              "absolute -top-1 -right-1 h-[18px] min-w-[18px] px-1 rounded-full bg-orange text-white",
              "text-[10px] font-bold leading-[18px] text-center ring-2 ring-white tabular-nums"
            )}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-96 bg-white border border-line rounded-card shadow-card overflow-hidden z-50">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between">
            <span className="text-sm font-semibold text-navy">Notifications</span>
            {unread > 0 && onMarkRead && (
              <button
                onClick={() => onMarkRead(unreadIds)}
                className="text-[11px] text-orange font-medium hover:underline"
              >
                Mark all as read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {shown.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-ink">You're all caught up.</p>
                <p className="text-[12px] text-grey-2 mt-1">New notifications will appear here.</p>
              </div>
            ) : (
              shown.map((n) => (
                // The WHOLE row is the button — no nested interactive elements,
                // so no click-swallowing and one obvious tap target.
                <button
                  key={n.id}
                  onClick={() => {
                    // Mark first: the producer patches its cache synchronously,
                    // so the row is gone before the write round-trips.
                    onMarkRead?.([n.id]);
                    setOpen(false);
                    if (n.to) navigate(n.to);
                  }}
                  className="w-full px-4 py-3 border-b border-line/70 last:border-0 hover:bg-page transition flex gap-3 text-left"
                >
                  <Avatar name={n.actorName} color={n.actorColor} size={32} className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 text-[13px] font-semibold text-navy truncate">
                        {n.actorName}
                      </span>
                      <span
                        className="shrink-0 text-[11px] text-grey-2 tabular-nums"
                        title={formatDateTime(n.createdAt)}
                      >
                        {timeAgoShort(n.createdAt)}
                      </span>
                    </span>
                    {/* No `block` here: line-clamp-2 supplies its own
                        display:-webkit-box, and a competing display utility can
                        win the cascade and silently stop the clamp working. */}
                    <span className="text-[13px] text-ink leading-snug line-clamp-2 mt-0.5">
                      {n.message}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
