import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/core/platform/supabase";
import { useAuth } from "@/core/platform/auth";

/**
 * Per-user report layout — "the columns I want on this report", remembered for THIS user
 * across browsers and devices.
 *
 * Stored in `profiles.receivables_report_prefs` (jsonb), keyed by report id:
 *
 *   { "collections:zero": { "columns": ["customers", "outstanding", …] } }
 *
 * ── Why not localStorage ──
 * Every other remembered layout in the hub (the Risk Register's columns, the source toggle)
 * lives in localStorage, which is per BROWSER. A salesperson who opens the dashboard on the
 * office desktop and again on a laptop is the same person and gets a different table — and an
 * admin can never see or reason about what anyone saved. This is a property of the user, so it
 * belongs on the user.
 *
 * ── Why the write is an RPC ──
 * `profiles` is admin-only for writes under RLS and must stay that way: it carries
 * role-adjacent grants (receivables_salespersons, receivables_admin_menus). Postgres cannot
 * scope an UPDATE policy to one column, so opening the table for a column layout would open it
 * for the grants too. `set_receivables_report_prefs` is a SECURITY DEFINER function that can
 * only touch this one column on the caller's own row. See the migration for the whole argument.
 *
 * ── Fails soft, always ──
 * A saved layout is a convenience, never a gate. If the column or the function isn't there yet
 * (the migration lags the deploy), if the read errors, or if the saved keys no longer exist,
 * the report simply opens on its own defaults. Nothing on screen breaks and nothing is hidden.
 */

/** One stable id per report surface. The three collection reports share a component. */
export const REPORT_PREF_IDS = {
  collectionsZero: "collections:zero",
  collectionsThreshold: "collections:threshold",
  collectionsDormant: "collections:dormant",
} as const;

interface ReportPrefEntry {
  columns?: unknown;
}

/** Pull one report's saved column keys out of the raw jsonb, defensively. */
function readColumns(raw: unknown, reportId: string): string[] | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entry = (raw as Record<string, ReportPrefEntry | undefined>)[reportId];
  if (!entry || typeof entry !== "object") return null;
  const cols = entry.columns;
  if (!Array.isArray(cols)) return null;
  const keys = cols.filter((c): c is string => typeof c === "string" && c.length > 0);
  return keys.length ? keys : null;
}

export interface ReportColumnPrefs {
  /**
   * The saved layout, already narrowed to columns this report still offers — or null when the
   * user has never saved one (or saved one that no longer contains a valid column).
   */
  saved: string[] | null;
  /** True until the first read settles. Seed component state only after this goes false. */
  loading: boolean;
  /** Persist `columns` as this user's layout for this report. */
  save: (columns: string[]) => Promise<void>;
  /** Forget the saved layout — the report goes back to its shipped default. */
  clear: () => Promise<void>;
  /** Set while a save/clear is in flight. */
  saving: boolean;
  /** Last write failure, in words fit for a button tooltip. Cleared by the next success. */
  error: string | null;
}

/**
 * @param reportId  one of REPORT_PREF_IDS
 * @param validKeys the column keys this report's picker offers. Saved keys outside this set are
 *                  dropped on read, so retiring or renaming a column can never leave a user
 *                  looking at a table with columns that no longer exist.
 */
export function useReportColumnPrefs(reportId: string, validKeys: readonly string[]): ReportColumnPrefs {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  const [raw, setRaw] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards the async read against an unmount / a user switch mid-flight.
  const liveFor = useRef<string | null>(null);

  useEffect(() => {
    liveFor.current = userId;
    if (!userId) { setRaw(null); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    supabase
      .from("profiles")
      .select("receivables_report_prefs")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (cancelled || liveFor.current !== userId) return;
        // A missing column (migration not applied yet) lands here as an error. That is not
        // worth a message on screen — the report just opens on its defaults.
        setRaw(err ? null : (data?.receivables_report_prefs ?? null));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [userId]);

  const validSet = useMemo(() => new Set(validKeys), [validKeys]);

  const saved = useMemo(() => {
    const cols = readColumns(raw, reportId);
    if (!cols) return null;
    const kept = cols.filter((k) => validSet.has(k));
    return kept.length ? kept : null;
  }, [raw, reportId, validSet]);

  const write = useCallback(
    async (columns: string[] | null) => {
      if (!userId) return;
      setSaving(true);
      setError(null);
      const { error: err } = await supabase.rpc("set_receivables_report_prefs", {
        p_report_id: reportId,
        p_columns: columns,
      });
      if (err) {
        setError(err.message);
        setSaving(false);
        throw new Error(err.message);
      }
      // Mirror the write locally rather than re-reading: one round trip, and the button can
      // flip to "Saved" the moment the RPC returns.
      setRaw((prev: unknown) => {
        const base = prev && typeof prev === "object" && !Array.isArray(prev)
          ? { ...(prev as Record<string, unknown>) }
          : {};
        if (columns === null || columns.length === 0) delete base[reportId];
        else base[reportId] = { columns };
        return base;
      });
      setSaving(false);
    },
    [userId, reportId],
  );

  const save = useCallback((columns: string[]) => write(columns), [write]);
  const clear = useCallback(() => write(null), [write]);

  return { saved, loading, save, clear, saving, error };
}
