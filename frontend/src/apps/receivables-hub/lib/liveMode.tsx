import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { useSession } from "@/core/platform/session";

/**
 * Global "Live (Tally)" view toggle for the Receivables Hub (admin-only).
 *
 * When ON, the whole hub reads from the ConnectWave live-Tally snapshot instead of the
 * pipeline-fed source — the SAME screens/URLs, just a different backend (see sourceContext).
 * This replaces the earlier idea of duplicating every left-menu item with a "Live …" copy:
 * one switch in the topbar flips the entire view, so the nav stays a single clean set.
 *
 * Live data is admin-only, so the effective flag is forced off for non-admins regardless of the
 * persisted value. The choice is remembered across reloads (localStorage) but is always visibly
 * indicated in the topbar so it's never a silent surprise.
 */
const KEY = "receivables.liveMode";

interface LiveModeValue {
  /** Effective flag (admin AND toggled on). Drives the data source. */
  liveMode: boolean;
  setLiveMode: (v: boolean) => void;
  /** Whether this user may use Live mode at all (admins only). */
  canUseLive: boolean;
}

const Ctx = createContext<LiveModeValue>({ liveMode: false, setLiveMode: () => {}, canUseLive: false });

export function LiveModeProvider({ children }: { children: ReactNode }) {
  const { isAdmin } = useSession();
  const [raw, setRaw] = useState<boolean>(() => {
    try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
  });
  const setLiveMode = useCallback((v: boolean) => {
    setRaw(v);
    try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* private mode */ }
  }, []);
  const liveMode = isAdmin && raw;
  return <Ctx.Provider value={{ liveMode, setLiveMode, canUseLive: isAdmin }}>{children}</Ctx.Provider>;
}

export function useLiveMode(): LiveModeValue {
  return useContext(Ctx);
}
