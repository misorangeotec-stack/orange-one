import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { useSession } from "@/core/platform/session";

/**
 * Data-source view for the Receivables Hub. Live (Tally) is now the DEFAULT for everyone;
 * the old pipeline-fed source is an opt-in "legacy" view a user may switch to only if
 * permitted (admins always; a non-admin needs profiles.receivables_allow_pipeline).
 *
 * When ON (the default), the whole hub reads from the ConnectWave live-Tally snapshot; when
 * a permitted user toggles OFF, the SAME screens/URLs read from the legacy pipeline source
 * instead (see sourceContext). One switch flips the entire view, so the nav stays a single
 * clean set rather than duplicating every menu.
 *
 * The exported `liveMode` is "currently viewing Live". It is forced ON for anyone who can't
 * use the legacy source, regardless of a stale stored preference — so a user without
 * permission always sees Live, never a silent fallback to the old pipeline.
 *
 * NEW storage key (v2): the previous "receivables.liveMode" key stored "is Live ON" under the
 * old admin-opt-in-to-Live model. Its persisted 0/1 values are ambiguous now that the default
 * has flipped, so we start fresh here — "never chosen" unambiguously means Live.
 */
const KEY = "receivables.source.v2";

interface LiveModeValue {
  /** Effective flag — true when the hub is currently showing Live (Tally). Drives the data source. */
  liveMode: boolean;
  /** Set the view: true → Live (Tally), false → legacy pipeline. No-op for users who can't use legacy. */
  setLiveMode: (v: boolean) => void;
  /** Whether this user may switch to the legacy pipeline source at all (admins + permitted non-admins). */
  canUsePipeline: boolean;
}

const Ctx = createContext<LiveModeValue>({ liveMode: true, setLiveMode: () => {}, canUsePipeline: false });

export function LiveModeProvider({ children }: { children: ReactNode }) {
  const { isAdmin, user } = useSession();
  const canUsePipeline = isAdmin || user.receivablesAllowPipeline;
  // Persisted preference: has the user chosen to view the legacy pipeline? Default (unset) = Live.
  const [prefersPipeline, setPrefersPipeline] = useState<boolean>(() => {
    try { return localStorage.getItem(KEY) === "pipeline"; } catch { return false; }
  });
  const setLiveMode = useCallback((live: boolean) => {
    setPrefersPipeline(!live);
    try { localStorage.setItem(KEY, live ? "live" : "pipeline"); } catch { /* private mode */ }
  }, []);
  // Live by default; only a permitted user who explicitly picked the legacy source leaves Live.
  const liveMode = !(canUsePipeline && prefersPipeline);
  return <Ctx.Provider value={{ liveMode, setLiveMode, canUsePipeline }}>{children}</Ctx.Provider>;
}

export function useLiveMode(): LiveModeValue {
  return useContext(Ctx);
}
