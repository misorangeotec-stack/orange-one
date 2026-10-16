/**
 * The side panel a My Control Center row opens into.
 *
 * WHY THE REAL PAGE, NOT A REBUILT ACTION BAR. Every FMS already has a page
 * carrying its own Approve / Reject / Reassign / Hold / step forms, each wrapped
 * in that app's store, permission checks and RPCs. Re-implementing them on the
 * home screen would be a second copy of rules that are hard enough to keep
 * straight in one place. Rendering the page itself means an action taken here IS
 * the action taken in the FMS.
 *
 * HOW: the "background location" pattern. Opening an item remembers where the
 * reader was (My Control Center) and navigates to the item's real URL. App.tsx
 * then renders the main routes AT THE REMEMBERED LOCATION — so the home screen
 * stays exactly as it was, underneath — and renders the item's route a second
 * time inside this panel, where AppShell drops its chrome (shared/lib/embedded.ts).
 *
 * Because it is the same window, the page opens on the query cache My Control
 * Center has already filled (the FMS stores and the home providers share keys),
 * and whatever it changes updates the list behind it directly.
 *
 * The URL is the item's real URL while the panel is open, so a reload or a shared
 * link lands on the full FMS page — which is what such a link should mean.
 * Browser Back returns to My Control Center, and the panel follows it closed.
 *
 * KEEPING THE LIST BEHIND IT TRUE. Each FMS store refreshes its own cache after a
 * write, and the list reads the same cache, so normally the row moves on its own.
 * Two backstops cover the cases where it does not:
 *   · CLOSING refreshes every module opened in this panel session whose cache was
 *     not already refreshed since it was opened (a write path that forgot to
 *     invalidate, or an RPC called outside the store). Only that module, only the
 *     queries something is still watching — never the whole portal.
 *   · My Control Center asks the panel to close (`requestWorkPanelClose`) once the
 *     open item has left the reader's list — the step is done. The close waits for
 *     any dialog inside the page (a confirmation, a "mail sent" notice) to go first.
 */
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useLocation, useNavigate, type Location } from "react-router-dom";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { InPanelContext } from "@/shared/lib/embedded";
import { cacheRootOf } from "./mywork/useDeferredActivation";
import type { WorkItem } from "./mywork/types";

/* ---- what is open, and where the reader came from ---------------------------- */

interface PanelState {
  item: WorkItem | null;
  /** Where the panel was opened FROM. Non-null exactly while it is open. */
  background: Location | null;
  /** Each module opened in this panel session → when it was first opened (ms). */
  opened: Record<string, number>;
  /** Set by `requestWorkPanelClose`; the panel closes as soon as no dialog is up. */
  closeRequested: boolean;
  /** Navigating back to `background`; the panel is hidden and clears on arrival. */
  closing: boolean;
  /** The last item closed because it was finished — My Control Center says so. */
  done: { ref: string; label: string; at: number } | null;
}

const CLOSED = { item: null, background: null, opened: {}, closeRequested: false, closing: false };
let state: PanelState = { ...CLOSED, done: null };
const listeners = new Set<() => void>();
const set = (next: PanelState) => {
  state = next;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useWorkPanelState = (): PanelState => useSyncExternalStore(subscribe, () => state);

/** Returns `open(item)`. Opening another item keeps the original background. */
export function useOpenWorkItem(): (item: WorkItem) => void {
  const navigate = useNavigate();
  const location = useLocation();
  return (item) => {
    set({
      ...state,
      item,
      background: state.background ?? location,
      opened: { [item.source]: Date.now(), ...state.opened },
      closeRequested: false,
      closing: false,
    });
    navigate(item.to);
  };
}

/**
 * Close the panel because the open item is finished (it has left the reader's
 * list). No-op unless that item is still the one open, so a late call cannot shut
 * a different item the reader has since opened.
 */
export function requestWorkPanelClose(itemId: string): void {
  if (!state.background || state.item?.id !== itemId || state.closeRequested || state.closing) return;
  set({ ...state, closeRequested: true });
}

export const clearWorkPanelDone = () => {
  if (state.done) set({ ...state, done: null });
};

/**
 * True for a query holding a work source's data that something on screen still
 * watches. Ink Stabilisation's lot list shares the module's key root but is a
 * slow ConnectWave read that no step changes, so it is never part of a refresh.
 */
export function isWatchedWorkQuery(queryKey: readonly unknown[], observers: number, sources: string[]): boolean {
  if (observers === 0) return false;
  if (queryKey[0] === "ink-stabilisation" && queryKey[1] === "lots") return false;
  return sources.some((s) => ([] as string[]).concat(cacheRootOf(s)).includes(queryKey[0] as string));
}

/**
 * Refresh the modules a panel session touched, AFTER the page has unmounted (so
 * only the list behind it is still watching). A module whose cache already moved
 * since it was opened — the normal case after a save — costs nothing.
 */
function refreshOpenedModules(qc: QueryClient, opened: Record<string, number>) {
  for (const [source, openedAt] of Object.entries(opened)) {
    void qc
      .invalidateQueries({
        predicate: (q) =>
          isWatchedWorkQuery(q.queryKey, q.getObserversCount(), [source]) && q.state.dataUpdatedAt < openedAt,
      })
      .catch(() => {});
  }
}

/* ---- the panel ---------------------------------------------------------------- */

/** Rendered by App.tsx while a panel is open, around the item's own routes. */
export function WorkPanel({ children }: { children: ReactNode }) {
  const { item, background, closeRequested, closing } = useWorkPanelState();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  /*
   * Navigate FIRST; the effect below clears the panel once the URL is back on the
   * background. Clearing first left one render with no background while the
   * item's URL was still current, so the main routes drew the ITEM's page and My
   * Control Center unmounted, losing its filters. A click batched the two updates
   * and hid it; the auto-close after an approval runs outside a click and did not.
   */
  const close = () => {
    const bg = state.background;
    if (!bg || state.closing) return;
    set({ ...state, closing: true });
    // Replace, so Back from My Control Center does not reopen the item.
    navigate(`${bg.pathname}${bg.search}`, { replace: true });
  };
  // "Open in FMS": the URL is already the item's — just stop drawing the
  // background, and the full page (sidebar and all) takes over.
  const openFull = () => set({ ...state, ...CLOSED });

  // Back (or any route) that lands on the background itself closes the panel.
  useEffect(() => {
    if (background && location.pathname === background.pathname && location.search === background.search) {
      set({ ...state, ...CLOSED });
    }
  }, [location, background]);

  // However the panel closes (×, Esc, backdrop, Back, auto-close, Open in FMS),
  // refresh what it touched. Read through a ref: by cleanup time `state` is reset.
  const openedRef = useRef(state.opened);
  if (state.background) openedRef.current = state.opened;
  useEffect(
    () => () => {
      const opened = openedRef.current;
      // Next tick: the page's own queries have lost their observers by then.
      window.setTimeout(() => refreshOpenedModules(queryClient, opened), 0);
    },
    [queryClient]
  );

  // The open item is finished: close once nothing inside the page is mid-dialog.
  useEffect(() => {
    if (!closeRequested) return;
    const tryClose = () => {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return false;
      const finished = state.item;
      if (finished) {
        set({ ...state, done: { ref: finished.ref, label: finished.sourceLabel, at: Date.now() } });
      }
      close();
      return true;
    };
    if (tryClose()) return;
    const t = window.setInterval(() => {
      if (tryClose()) window.clearInterval(t);
    }, 300);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeRequested]);

  // Esc closes — unless a dialog or a dropdown menu inside the page is open, whose
  // own Esc it is. CAPTURE phase, so that check runs while the menu is still in the
  // DOM: a Combobox / MultiSelect closes itself on Esc, and by the window's bubble
  // phase it is gone, so a filter dropdown's Esc used to close the whole panel.
  // The page behind does not scroll while the panel is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelector('[role="dialog"][aria-modal="true"], [data-portal-menu]')) return;
      close();
    };
    document.addEventListener("keydown", onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (closing) return null;
  return (
    <div className="fixed inset-0 z-[55] flex justify-end" aria-label={item?.ref ?? "Work item"}>
      <div className="absolute inset-0 bg-navy/40" onClick={close} />
      <div className="relative h-full w-full sm:w-[min(1180px,92vw)] bg-page-grad shadow-2xl flex flex-col">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-line bg-white">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-grey-2 truncate">
              {item?.sourceLabel}
              {item?.stage ? ` · ${item.stage}` : ""}
            </div>
            <div className="text-[15px] font-semibold text-navy truncate">{item?.ref}</div>
          </div>
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={openFull}
              className="h-[34px] inline-flex items-center rounded-xl border border-line bg-white px-3 text-[12.5px] font-medium text-grey hover:text-orange hover:border-orange transition-colors"
              title="Leave My Control Center and open this in its FMS"
            >
              Open in FMS
            </button>
            <button
              type="button"
              onClick={close}
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
        <div className="flex-1 min-h-0 overflow-y-auto">
          <InPanelContext.Provider value={true}>{children}</InPanelContext.Provider>
        </div>
      </div>
    </div>
  );
}
