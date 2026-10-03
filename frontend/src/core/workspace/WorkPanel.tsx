/**
 * The side panel a My Control Center row opens into.
 *
 * WHY AN IFRAME OF THE REAL PAGE, NOT A REBUILT ACTION BAR. Every FMS already has
 * a page carrying its own Approve / Reject / Reassign / Hold / step forms, each
 * wrapped in that app's store, permission checks and RPCs. Re-implementing them
 * on the home screen would be a second copy of rules that are hard enough to keep
 * straight in one place. Loading the page itself means an action taken here IS
 * the action taken in the FMS.
 *
 * WHY IT IS FAST: see shared/lib/embedded.ts. In short — one frame, booted in the
 * background by `warmWorkPanel()`, seeded with a copy of this page's data, and
 * re-routed per click. The host sits at the app root (App.tsx) so the frame
 * survives moving between pages and is booted once per tab.
 *
 * Usage: `openWorkItem(item)` from anywhere; `<WorkPanelHost />` once, in App.tsx.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { cn } from "@/shared/lib/cn";
import { MCC_FRAME_NAME, MCC_IDLE_PATH, isEmbedded, seedFromParent, type FromFrame, type ToFrame } from "@/shared/lib/embedded";
import type { WorkItem } from "./mywork/types";

/* ---- a tiny store: which item is open, and has the frame been asked for ---- */

let openItem: WorkItem | null = null;
let warm = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function openWorkItem(item: WorkItem): void {
  openItem = item;
  warm = true;
  emit();
}
export function closeWorkItem(): void {
  openItem = null;
  emit();
}
/** Boot the frame in the background so the first click does not pay for it. */
export function warmWorkPanel(): void {
  if (warm) return;
  warm = true;
  emit();
}

const snapshot = () => ({ openItem, warm });
let last = snapshot();
const getSnapshot = () => {
  if (last.openItem !== openItem || last.warm !== warm) last = snapshot();
  return last;
};

/* ---- the page side ---------------------------------------------------------- */

export function WorkPanelHost() {
  const { openItem: item, warm: isWarm } = useSyncExternalStore(subscribe, getSnapshot);
  const qc = useQueryClient();
  const frame = useRef<HTMLIFrameElement>(null);
  // Bumped on every "ready" — the frame can reboot (its error screen reloads it),
  // and a rebooted frame must be routed again.
  const [boot, setBoot] = useState(0);
  const ready = boot > 0;
  // True from asking the frame for a page until it reports any route change —
  // not an exact match, because a page may redirect (a queue to its default tab).
  const [awaiting, setAwaiting] = useState(false);

  const post = (msg: ToFrame) => {
    const f = frame.current;
    if (!f?.contentWindow) return;
    try {
      // Throws if the frame wandered off to another origin (a document opened
      // into it, for instance). A message would be dropped there and "Opening…"
      // would never clear, so restart it on the page we want instead.
      void f.contentWindow.location.pathname;
    } catch {
      setBoot(0);
      f.src = msg.to;
      return;
    }
    f.contentWindow.postMessage(msg, window.location.origin);
  };

  // Frame → page messages.
  useEffect(() => {
    const onMsg = (e: MessageEvent<FromFrame>) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      const d = e.data;
      if (d?.type === "mcc:ready") setBoot((b) => b + 1);
      else if (d?.type === "mcc:navigated" && d.to !== MCC_IDLE_PATH) setAwaiting(false);
      // The frame landed new data (an approval, a reassign): refetch it here too,
      // with this page's own code, so the list behind the panel stays true.
      else if (d?.type === "mcc:changed" && Array.isArray(d.queryKey)) void qc.invalidateQueries({ queryKey: d.queryKey, exact: true });
      else if (d?.type === "mcc:close") closeWorkItem();
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [qc]);

  // Route the frame to the open item — or back to its blank resting page on close,
  // so no FMS stays mounted (and subscribed) behind a closed panel.
  const target = item?.to ?? MCC_IDLE_PATH;
  useEffect(() => {
    if (!ready) return;
    setAwaiting(target !== MCC_IDLE_PATH);
    post({ type: "mcc:navigate", to: target });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot, target]);

  // Esc closes; the page behind does not scroll while open.
  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeWorkItem();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [item]);

  if (isEmbedded || !isWarm) return null;
  const loading = !!item && (!ready || awaiting);

  return (
    <div
      className={cn("fixed inset-0 z-[60] flex justify-end", !item && "invisible pointer-events-none")}
      role="dialog"
      aria-modal={!!item}
      aria-hidden={!item}
      aria-label={item?.ref}
    >
      <div className="absolute inset-0 bg-navy/40" onClick={closeWorkItem} />
      <div className="relative h-full w-full sm:w-[min(1180px,92vw)] bg-page shadow-2xl flex flex-col">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-line bg-white">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-grey-2 truncate">
              {item?.sourceLabel}
              {item?.stage ? ` · ${item.stage}` : ""}
            </div>
            <div className="text-[15px] font-semibold text-navy truncate">{item?.ref}</div>
          </div>
          <div className="ml-auto flex items-center gap-2 shrink-0">
            {item && (
              <Link
                to={item.to}
                onClick={closeWorkItem}
                className="h-[34px] inline-flex items-center rounded-xl border border-line bg-white px-3 text-[12.5px] font-medium text-grey hover:text-orange hover:border-orange transition-colors"
                title="Leave My Control Center and open this in its FMS"
              >
                Open in FMS
              </Link>
            )}
            <button
              type="button"
              onClick={closeWorkItem}
              title="Close (Esc)"
              className="h-[34px] w-[34px] inline-flex items-center justify-center rounded-xl border border-line bg-white text-grey hover:text-navy"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
        <div className="relative flex-1 min-h-0">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-page text-[13px] text-grey-2">
              <span className="inline-flex items-center gap-2">
                <span className="h-4 w-4 rounded-full border-2 border-orange border-t-transparent animate-spin" />
                Opening {item?.ref}…
              </span>
            </div>
          )}
          <iframe
            ref={frame}
            name={MCC_FRAME_NAME}
            src={MCC_IDLE_PATH}
            title="Work item"
            className="w-full h-full border-0 bg-page"
          />
        </div>
      </div>
    </div>
  );
}

/* ---- the frame side --------------------------------------------------------- */

/** Mounted in App.tsx; does anything only inside the panel frame. */
export function WorkPanelFrameBridge() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { pathname, search } = useLocation();

  useEffect(() => {
    if (!isEmbedded) return;
    const toPage = (msg: FromFrame) => window.parent.postMessage(msg, window.location.origin);
    const onMsg = (e: MessageEvent<ToFrame>) => {
      if (e.origin !== window.location.origin || e.source !== window.parent) return;
      if (e.data?.type === "mcc:navigate") {
        // Fresh copy of the page's data first, so the page opens on what the list shows.
        if (e.data.to !== MCC_IDLE_PATH) seedFromParent(qc);
        // REPLACE, never push: the frame shares the tab's history, and every open
        // and close would otherwise leave entries the Back button walks through
        // invisibly before it ever leaves the page.
        navigate(e.data.to, { replace: true });
      }
    };
    // Esc inside the frame closes the panel — unless a dialog in the page is open,
    // whose own Esc it is.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector('[role="dialog"][aria-modal="true"]')) toPage({ type: "mcc:close" });
    };
    // Report every key that lands new data from a FETCH (not the seed copy, which
    // arrives as a plain state set) so the page can refetch it.
    const unsubscribe = qc.getQueryCache().subscribe((ev) => {
      // The staff directory is skipped: the frame loads it on boot, and nothing done
      // in the panel changes it, so reporting it would refetch it here for nothing.
      if (ev.type === "updated" && ev.action.type === "success" && !ev.action.manual && ev.query.queryKey[0] !== "directory") {
        toPage({ type: "mcc:changed", queryKey: ev.query.queryKey as unknown[] });
      }
    });
    window.addEventListener("message", onMsg);
    window.addEventListener("keydown", onKey);
    toPage({ type: "mcc:ready" });
    return () => {
      unsubscribe();
      window.removeEventListener("message", onMsg);
      window.removeEventListener("keydown", onKey);
    };
  }, [navigate, qc]);

  // Tell the page what is showing, so it can drop its "Opening…" cover.
  useEffect(() => {
    if (!isEmbedded) return;
    window.parent.postMessage({ type: "mcc:navigated", to: pathname + search } satisfies FromFrame, window.location.origin);
  }, [pathname, search]);

  return null;
}
