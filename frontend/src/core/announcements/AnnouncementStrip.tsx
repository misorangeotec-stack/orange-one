import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/shared/lib/cn";
import AnnouncementReader from "./AnnouncementReader";
import { ANNOUNCEMENTS_PATH, useActiveAnnouncements, useDismissAnnouncement, type ActiveAnnouncement } from "./data";

/**
 * How long each announcement stays up when several are running: long enough to read a
 * title twice, short enough that the fourth one comes round inside half a minute.
 */
const ROTATE_MS = 8000;

/**
 * A ✕ pressed this soon after the strip moved on by itself is ignored. The tap was
 * almost certainly aimed at the announcement that was there a moment ago, and closing
 * the one that slid in under the finger would be the wrong one.
 */
const SWAP_GUARD_MS = 600;

const megaphone = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
  </svg>
);

const reducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** True while the tab is in the background — no point turning pages nobody can see. */
function usePageHidden(): boolean {
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.visibilityState === "hidden");
  useEffect(() => {
    const onChange = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return hidden;
}

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
 * Shows the newest running announcement. When several are running it TURNS BY ITSELF,
 * one every ROTATE_MS, the next sliding up into place, with a thin countdown line along
 * the bottom. The countdown IS the timer: the line's own animation finishing is what
 * moves the strip on, so pausing the line pauses the rotation and they cannot drift.
 *
 * It holds still whenever someone is dealing with it — pointer over it (or a finger on
 * it), keyboard focus in it, the full text open, the tab in the background — and there
 * is a pause button, because a phone has no hover and moving content must be stoppable.
 * ‹ › step by hand and restart the countdown. ✕ closes one for this person only.
 */
export default function AnnouncementStrip({ className }: { className?: string }) {
  const { data } = useActiveAnnouncements();
  const dismiss = useDismissAnnouncement();
  const [index, setIndex] = useState(0);
  const [reading, setReading] = useState<ActiveAnnouncement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [keyboardIn, setKeyboardIn] = useState(false);
  const [held, setHeld] = useState(false);
  const hidden = usePageHidden();
  const barRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<Animation | null>(null);
  const swappedAt = useRef(0);

  const rows = data ?? [];
  const i = Math.min(index, Math.max(rows.length - 1, 0));
  const a = rows[i] as ActiveAnnouncement | undefined;
  const many = rows.length > 1;
  const paused = hovered || keyboardIn || held || !!reading || hidden;

  // One countdown per announcement shown. Restarts whenever the one on screen changes —
  // by itself, by ‹ ›, or because the one showing was closed.
  useEffect(() => {
    const el = barRef.current;
    if (!many || !a || !el || typeof el.animate !== "function") return;
    const anim = el.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], {
      duration: ROTATE_MS,
      easing: "linear",
      fill: "forwards",
    });
    anim.onfinish = () => {
      swappedAt.current = Date.now();
      setIndex((i + 1) % rows.length);
    };
    animRef.current = anim;
    return () => {
      anim.onfinish = null;
      anim.cancel();
      animRef.current = null;
    };
  }, [many, a?.id, i, rows.length]);

  // Declared AFTER the countdown so a freshly started one is paused straight away when
  // it begins under the pointer.
  useEffect(() => {
    const anim = animRef.current;
    if (!anim) return;
    if (paused) anim.pause();
    else anim.play();
  }, [paused, a?.id]);

  // The next one slides up into place. Stable identity, so it runs only when the keyed
  // element below is newly mounted — i.e. once per announcement, not on every render.
  const slideIn = useCallback((el: HTMLDivElement | null) => {
    if (!el || reducedMotion() || typeof el.animate !== "function") return;
    el.animate(
      [
        { opacity: 0, transform: "translateY(70%)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" }
    );
  }, []);

  if (rows.length === 0 && !reading) return null;

  const close = (id: string, fromStrip: boolean) => {
    if (fromStrip && Date.now() - swappedAt.current < SWAP_GUARD_MS) return;
    dismiss.mutate(id);
    setReading(null);
  };

  return (
    <>
      {a && (
        <div
          role="region"
          aria-label="Announcement"
          className={cn("relative shrink-0 overflow-hidden bg-navy text-white", className)}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          // Keyboard focus only: a mouse click also focuses a button, and holding the
          // strip still until the person happens to click elsewhere would look broken.
          onFocus={(e) => {
            if ((e.target as HTMLElement).matches?.(":focus-visible")) setKeyboardIn(true);
          }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setKeyboardIn(false);
          }}
        >
          <div className="mx-auto flex max-w-[1440px] items-center gap-2 px-4 py-2 sm:gap-3 sm:px-6">
            <span className="shrink-0 text-orange">{megaphone}</span>
            <div key={a.id} ref={slideIn} className="flex min-w-0 items-center gap-2 sm:gap-3">
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
            </div>
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
                  <StripButton
                    label={held ? "Play announcements" : "Pause announcements"}
                    onClick={() => setHeld((h) => !h)}
                  >
                    {held ? <path d="M7 5v14l11-7Z" /> : <path d="M9 5v14M15 5v14" />}
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
              <StripButton label="Close this announcement" onClick={() => close(a.id, true)}>
                <path d="M18 6 6 18M6 6l12 12" />
              </StripButton>
            </div>
          </div>
          {/* The countdown to the next one. Its animation finishing is what turns the strip. */}
          {many && (
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-white/10">
              <div ref={barRef} className="h-full origin-left bg-orange" style={{ transform: "scaleX(0)" }} />
            </div>
          )}
        </div>
      )}
      <AnnouncementReader
        announcement={reading}
        open={!!reading}
        onClose={() => setReading(null)}
        onDismiss={reading ? () => close(reading.id, false) : undefined}
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
