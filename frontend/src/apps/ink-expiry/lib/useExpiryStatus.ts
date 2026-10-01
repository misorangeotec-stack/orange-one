import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getConnectwave, hasConnectwave } from "@/core/platform/connectwave";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { fetchExpiryStatus, type ExpiryStatus } from "./expiry";

/**
 * The one read both pages share — Dashboard and Expiry status sit on the same query key, so
 * moving between them does not re-read ~100k lines. `progress` is [done, total] requests.
 *
 * ⚠ A FULL READ TAKES ~1 MINUTE (every ink voucher line is netted in the browser; see expiry.ts).
 *   So the last result is kept in this browser's localStorage and shown at once on the next
 *   visit, while a fresh read runs in the background (`refreshing`). It is a per-browser
 *   convenience only: if storage is blocked or full, the page simply waits for the live read.
 *   Bump CACHE_KEY's version whenever the shape of ExpiryStatus changes.
 */
// v3: provision / dead / diff / loose stock excluded — an older copy still holds them.
const CACHE_KEY = "ink-expiry:status:v3";
const FRESH_MS = 15 * 60_000;

interface Saved { savedAt: number; today: string; data: ExpiryStatus }

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

function writeSaved(today: string, data: ExpiryStatus) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), today, data } satisfies Saved));
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
      const data = await fetchExpiryStatus(getConnectwave(), today, (d, n) => setProgress([d, n]));
      writeSaved(today, data);
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
