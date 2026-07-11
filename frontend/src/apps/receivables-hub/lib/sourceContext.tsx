import { createContext, useContext, type ReactNode } from "react";

/**
 * Which backend useAppData reads from.
 *   "default"     — the normal receivables source (VITE_DATA_SOURCE: supabase/local).
 *   "connectwave" — the live Tally mirror (ConnectWave snapshot).
 *
 * The value is set in ONE place: ReceivablesHubApp wraps the whole router in a provider that
 * follows the admin-only "Live (Tally)" topbar toggle (see lib/liveMode). So every screen is the
 * SAME component on both sources — there is no separate set of "Live" pages, and no page opts in
 * on its own. (An earlier design did both: a "/outstanding-dashboard/live" route set and a
 * self-wrapping "Collection Report (Tally Live)" page. Both are gone; don't reintroduce them.)
 *
 * `basePath` therefore has no override today, but useHubBase() is still the right way for a screen
 * to build internal links: it keeps drill-through source-aware if the routes are ever relocated.
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
