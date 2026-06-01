import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/shared/lib/cn";
import type { NotificationItem } from "./types";

/** Topbar bell with unread dot + dropdown list of notifications. */
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
  const unreadIds = items.filter((i) => i.unread).map((i) => i.id);
  const unread = unreadIds.length;

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative w-10 h-10 rounded-xl bg-white border border-line text-grey flex items-center justify-center hover:text-navy hover:border-[#d9e2f0] transition"
        aria-label="Notifications"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute top-1.5 right-2 w-2 h-2 bg-orange rounded-full ring-2 ring-white" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white border border-line rounded-card shadow-card overflow-hidden z-50">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between">
            <span className="text-sm font-semibold text-navy">Notifications</span>
            {unread > 0 && (
              onMarkRead ? (
                <button
                  onClick={() => onMarkRead(unreadIds)}
                  className="text-[11px] text-orange font-medium hover:underline"
                >
                  Mark all read
                </button>
              ) : (
                <span className="text-[11px] text-orange font-medium">{unread} new</span>
              )
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-grey-2">You're all caught up 🎉</p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    if (n.unread) onMarkRead?.([n.id]);
                    if (n.to) navigate(n.to);
                    setOpen(false);
                  }}
                  className={cn(
                    "w-full text-left px-4 py-3 border-b border-line/70 last:border-0 hover:bg-page transition flex gap-3",
                    n.unread && "bg-orange-soft/40"
                  )}
                >
                  <span className={cn("mt-1.5 w-1.5 h-1.5 rounded-full shrink-0", n.unread ? "bg-orange" : "bg-transparent")} />
                  <span className="min-w-0">
                    <span className="block text-[13px] text-ink leading-snug">{n.text}</span>
                    <span className="block text-[11px] text-grey-2 mt-0.5">{n.time}</span>
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
