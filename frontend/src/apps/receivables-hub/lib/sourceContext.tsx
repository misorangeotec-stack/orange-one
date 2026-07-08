import { createContext, useContext, type ReactNode } from "react";

/**
 * Which backend useAppData reads from.
 *   "default"     — the normal receivables source (VITE_DATA_SOURCE: supabase/local).
 *   "connectwave" — the live Tally mirror (ConnectWave snapshot), used by the admin
 *                   "Collection Report (Tally Live)" screen and the parallel "Live (Tally)"
 *                   dashboard set (Dashboard / Risk Register / Customer Detail / Aging).
 *
 * A page opts into ConnectWave by wrapping itself in <ReceivablesSourceProvider
 * value="connectwave">; every other screen inherits the default, so the rest of the
 * Receivables Hub is untouched.
 *
 * `basePath` lets a wrapped subtree relocate the app's routes (the Live set lives under
 * "/outstanding-dashboard/live"). The four Live screens are the SAME components as the
 * default ones, so their internal navigation must be source-aware — they read useHubBase()
 * instead of hard-coding "/outstanding-dashboard", so drill-through stays inside the Live set.
 */
export type ReceivablesSource = "default" | "connectwave";

export const DEFAULT_HUB_BASE = "/outstanding-dashboard";

interface SourceValue {
  source: ReceivablesSource;
  basePath: string;
}

const SourceContext = createContext<SourceValue>({ source: "default", basePath: DEFAULT_HUB_BASE });

export function ReceivablesSourceProvider({
  value,
  basePath = DEFAULT_HUB_BASE,
  children,
}: {
  value: ReceivablesSource;
  basePath?: string;
  children: ReactNode;
}) {
  return <SourceContext.Provider value={{ source: value, basePath }}>{children}</SourceContext.Provider>;
}

export function useReceivablesSource(): ReceivablesSource {
  return useContext(SourceContext).source;
}

/** Base path the current screen's internal links should be relative to (Live vs default). */
export function useHubBase(): string {
  return useContext(SourceContext).basePath;
}
