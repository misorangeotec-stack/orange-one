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
 */
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { useLocation, useNavigate, type Location } from "react-router-dom";
import { InPanelContext } from "@/shared/lib/embedded";
import type { WorkItem } from "./mywork/types";

/* ---- what is open, and where the reader came from ---------------------------- */

interface PanelState {
  item: WorkItem | null;
  /** Where the panel was opened FROM. Non-null exactly while it is open. */
  background: Location | null;
}

let state: PanelState = { item: null, background: null };
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
    set({ item, background: state.background ?? location });
    navigate(item.to);
  };
}

/* ---- the panel ---------------------------------------------------------------- */

/** Rendered by App.tsx while a panel is open, around the item's own routes. */
export function WorkPanel({ children }: { children: ReactNode }) {
  const { item, background } = useWorkPanelState();
  const location = useLocation();
  const navigate = useNavigate();

  const close = () => {
    const bg = state.background;
    set({ item: null, background: null });
    // Replace, so Back from My Control Center does not reopen the item.
    if (bg) navigate(`${bg.pathname}${bg.search}`, { replace: true });
  };
  // "Open in FMS": the URL is already the item's — just stop drawing the
  // background, and the full page (sidebar and all) takes over.
  const openFull = () => set({ item: null, background: null });

  // Back (or any route) that lands on the background itself closes the panel.
  useEffect(() => {
    if (background && location.pathname === background.pathname && location.search === background.search) {
      set({ item: null, background: null });
    }
  }, [location, background]);

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
