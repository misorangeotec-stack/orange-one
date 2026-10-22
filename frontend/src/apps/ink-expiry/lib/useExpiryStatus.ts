import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getConnectwave, hasConnectwave } from "@/core/platform/connectwave";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { fetchExpiryStatus, fetchSyncStamp, type ExpiryStatus } from "./expiry";
import { browserLineCache } from "./lineCache";

/**
 * The one read both pages share — Dashboard and Expiry status sit on the same query key, so
 * moving between them does not re-read ~100k lines. `progress` is [done, total] requests.
 *
 * ⚠ A FULL READ TAKES ~1 MINUTE (every ink voucher line is netted in the browser; see expiry.ts).
 *   So the last result is kept in this browser's localStorage and shown at once on the next
 *   visit, while a fresh read runs in the background (`refreshing`). It is a per-browser
 *   convenience only: if storage is blocked or full, the page simply waits for the live read.
 *   Bump CACHE_KEY's version whenever the shape of ExpiryStatus changes.
 *
 * ⚠ A REFRESH ONLY READS WHAT CHANGED (21-10-2026). It first reads ConnectWave's build stamps
 *   (fetchSyncStamp, ~¼ s). Same stamp as the saved copy, same day → nothing new from Tally, the
 *   saved figures stay. Otherwise only the company × years whose stamp moved are read again —
 *   in practice the current FY, rebuilt by every hourly sync; closed years come from this
 *   browser's IndexedDB copy (lineCache.ts). Full read before: ~1 min; after a sync now: seconds.
 */
// v5: purchase / production date skips internal moves; lots carry returnDate / inwardCompany.
const CACHE_KEY = "ink-expiry:status:v5";
// The stamp check is cheap, so look for a new Tally sync every 5 minutes.
const FRESH_MS = 5 * 60_000;

interface Saved { savedAt: number; today: string; data: ExpiryStatus; stamp?: string }

function readSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Saved;
    return s?.data?.lots ? s : null;
  } catch {
    return null;
  }
}

function writeSaved(today: string, data: ExpiryStatus, stamp?: string) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), today, data, stamp } satisfies Saved));
  } catch {
    // Storage blocked or full — the page still works, just without the instant start.
  }
}

export function useExpiryStatus() {
  const today = todayLocalIso();
  const [progress, setProgress] = useState<[number, number]>([0, 0]);
  // Read once per mount; a saved copy from an earlier day is still shown, then replaced.
  const [saved] = useState(readSaved);
  const q = useQuery({
    queryKey: ["ink-expiry", "status", today],
    queryFn: async () => {
      if (!hasConnectwave()) throw new Error("The live Tally mirror (ConnectWave) is not configured for this site.");
      const cw = getConnectwave();
      // No stamp (read failed) → read as before; the line cache then stays unused.
      const sync = await fetchSyncStamp(cw).catch(() => null);
      const prev = readSaved();
      if (sync && prev && prev.stamp === sync.stamp && prev.today === today) {
        writeSaved(today, prev.data, sync.stamp);
        return prev.data;
      }
      const data = await fetchExpiryStatus(cw, today, (d, n) => setProgress([d, n]),
        sync ? { cache: browserLineCache, coverage: sync.coverage } : {});
      writeSaved(today, data, sync?.stamp);
      return data;
    },
    initialData: saved?.data,
    // Older than FRESH_MS (or from another day) → react-query re-reads in the background at once.
    initialDataUpdatedAt: saved ? (saved.today === today ? saved.savedAt : 0) : undefined,
    staleTime: FRESH_MS,
  });
  return {
    q,
    today,
    progress,
    /** When the figures on screen were read from Tally. */
    // A saved copy from another day is registered as time 0 (so it re-reads); show its real time.
    asOf: q.data ? new Date(q.dataUpdatedAt > 0 ? q.dataUpdatedAt : saved?.savedAt ?? Date.now()) : null,
    /** Figures are on screen and a fresh read is running behind them. */
    refreshing: q.isFetching && !!q.data,
    savedAt: saved?.savedAt ?? null,
  };
}
