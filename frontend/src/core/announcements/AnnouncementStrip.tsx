import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/shared/lib/cn";
import AnnouncementReader from "./AnnouncementReader";
import { ANNOUNCEMENTS_PATH, useActiveAnnouncements, useDismissAnnouncement, type ActiveAnnouncement } from "./data";

const megaphone = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
  </svg>
);

/**
 * PF-18 · The announcement strip, at the top of every staff screen in the hub.
 *
 * Rendered in exactly THREE places, which between them cover every signed-in staff
 * screen: `AppShell` (the launcher, Admin and every app but one), the Outstanding
 * Dashboard's own `UserLayout`, and `/account`, which has its own header. The Order
 * Desk's shell is for customers and deliberately carries none of it.
 *
 * ⚠ IN THE DOCUMENT FLOW, NEVER OVERLAID. It sits between a shell's header and its
 *   scrolling content, so the page below simply starts lower; nothing is covered,
 *   at any width. It renders NOTHING when there is nothing to say.
 *
 * ⚠ NOT THE SHELL'S `banner` SLOT. Four layouts (HR Exit, HR Recruitment, Import,
 *   Procurement) already use `banner` for the Demo Sandbox notice. This is a separate
 *   element beside it, so both show when both apply.
 *
 * Shows the newest running announcement; ‹ › walk the rest. ✕ closes one for this
 * person only, and the next one steps up.
 */
export default function AnnouncementStrip({ className }: { className?: string }) {
  const { data } = useActiveAnnouncements();
  const dismiss = useDismissAnnouncement();
  const [index, setIndex] = useState(0);
  const [reading, setReading] = useState<ActiveAnnouncement | null>(null);

  const rows = data ?? [];
  if (rows.length === 0 && !reading) return null;

  const i = Math.min(index, Math.max(rows.length - 1, 0));
  const a = rows[i];
  const many = rows.length > 1;
  const close = (id: string) => {
    dismiss.mutate(id);
    setReading(null);
  };

  return (
    <>
      {a && (
        <div role="region" aria-label="Announcement" className={cn("shrink-0 bg-navy text-white", className)}>
          <div className="mx-auto flex max-w-[1440px] items-center gap-2 px-4 py-2 sm:gap-3 sm:px-6">
            <span className="shrink-0 text-orange">{megaphone}</span>
            {/* The title is itself the way in: on a phone it is truncated, and a tap
                shows all of it. */}
            <button
              type="button"
              onClick={() => setReading(a)}
              title={a.title}
              className="min-w-0 truncate text-left text-[13px] font-semibold hover:underline"
            >
              {a.title}
            </button>
            {(a.body || a.link_url) && (
              <button
                type="button"
                onClick={() => setReading(a)}
                className="shrink-0 text-[12.5px] font-semibold text-orange-2 hover:underline"
              >
                Read more
              </button>
            )}
            <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
              {many && (
                <>
                  <StripButton label="Previous announcement" onClick={() => setIndex((i - 1 + rows.length) % rows.length)}>
                    <path d="m15 18-6-6 6-6" />
                  </StripButton>
                  <span className="whitespace-nowrap text-[11.5px] tabular-nums text-white/70">
                    {i + 1} of {rows.length}
                  </span>
                  <StripButton label="Next announcement" onClick={() => setIndex((i + 1) % rows.length)}>
                    <path d="m9 18 6-6-6-6" />
                  </StripButton>
                </>
              )}
              <Link
                to={ANNOUNCEMENTS_PATH}
                title="All announcements"
                aria-label="All announcements"
                className="ml-1 inline-flex h-7 items-center gap-1.5 rounded-lg px-1.5 text-[12px] font-medium text-white/75 hover:bg-white/10 hover:text-white"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                </svg>
                <span className="hidden sm:inline">All</span>
              </Link>
              <StripButton label="Close this announcement" onClick={() => close(a.id)}>
                <path d="M18 6 6 18M6 6l12 12" />
              </StripButton>
            </div>
          </div>
        </div>
      )}
      <AnnouncementReader
        announcement={reading}
        open={!!reading}
        onClose={() => setReading(null)}
        onDismiss={reading ? () => close(reading.id) : undefined}
      />
    </>
  );
}

function StripButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-white/75 transition hover:bg-white/10 hover:text-white"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}
