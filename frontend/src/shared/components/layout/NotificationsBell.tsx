import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/shared/lib/cn";
import type { NotificationItem } from "./types";

type Filter = "all" | "unread";

/**
 * Topbar bell: unread COUNT badge + dropdown list of notifications.
 *
 * Shared by every app (task management and the five FMS apps), so anything added
 * here lands everywhere at once.
 *
 * It used to show a bare dot — "something is unread" but never how much, which is
 * the first thing anyone wants to know. It now shows the number, and the dropdown
 * carries the read/unread controls people expect: filter to unread, mark one
 * read, mark it back to unread, mark everything read.
 */
export default function NotificationsBell({
  items,
  onMarkRead,
  onMarkUnread,
}: {
  items: NotificationItem[];
  onMarkRead?: (ids: string[]) => void;
  /** Optional: apps that haven't wired an "unread again" write simply omit it. */
  onMarkUnread?: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const unreadIds = useMemo(() => items.filter((i) => i.unread).map((i) => i.id), [items]);
  const unread = unreadIds.length;
  const shown = filter === "unread" ? items.filter((i) => i.unread) : items;

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Nothing left to show under the unread lens: fall back rather than stranding
  // the reader on a permanently empty list they have to notice and undo.
  useEffect(() => {
    if (filter === "unread" && unread === 0) setFilter("all");
  }, [filter, unread]);

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
        <div className="absolute right-0 mt-2 w-80 bg-white border border-line rounded-card shadow-card overflow-hidden z-50">
          <div className="px-4 py-3 border-b border-line">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-navy">Notifications</span>
              {unread > 0 && onMarkRead && (
                <button
                  onClick={() => onMarkRead(unreadIds)}
                  className="text-[11px] text-orange font-medium hover:underline"
                >
                  Mark all read
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 mt-2">
              {([
                { key: "all", label: `All (${items.length})` },
                { key: "unread", label: `Unread (${unread})` },
              ] as { key: Filter; label: string }[]).map((o) => (
                <button
                  key={o.key}
                  onClick={() => setFilter(o.key)}
                  className={cn(
                    "text-[11px] font-semibold px-2 py-1 rounded-pill transition",
                    filter === o.key ? "bg-orange-soft text-orange" : "text-grey-2 hover:text-navy"
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {shown.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-grey-2">
                {filter === "unread" ? "Nothing unread." : "You're all caught up 🎉"}
              </p>
            ) : (
              shown.map((n) => (
                <div
                  key={n.id}
                  className={cn(
                    "group w-full px-4 py-3 border-b border-line/70 last:border-0 hover:bg-page transition flex gap-3",
                    n.unread && "bg-orange-soft/40"
                  )}
                >
                  <button
                    onClick={() => {
                      if (n.unread) onMarkRead?.([n.id]);
                      if (n.to) navigate(n.to);
                      setOpen(false);
                    }}
                    className="flex gap-3 text-left min-w-0 flex-1"
                  >
                    <span className={cn("mt-1.5 w-1.5 h-1.5 rounded-full shrink-0", n.unread ? "bg-orange" : "bg-transparent")} />
                    <span className="min-w-0">
                      <span className="block text-[13px] text-ink leading-snug">{n.text}</span>
                      <span className="block text-[11px] text-grey-2 mt-0.5">{n.time}</span>
                    </span>
                  </button>

                  {/* Per-row read/unread. Revealed on hover so the list stays calm,
                      but kept focusable so it is reachable by keyboard. */}
                  {n.unread
                    ? onMarkRead && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onMarkRead([n.id]); }}
                          title="Mark as read"
                          aria-label="Mark as read"
                          className="shrink-0 self-start text-[10px] font-semibold text-orange hover:underline opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
                        >
                          Read
                        </button>
                      )
                    : onMarkUnread && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onMarkUnread([n.id]); }}
                          title="Mark as unread"
                          aria-label="Mark as unread"
                          className="shrink-0 self-start text-[10px] font-semibold text-grey-2 hover:text-navy hover:underline opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
                        >
                          Unread
                        </button>
                      )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
