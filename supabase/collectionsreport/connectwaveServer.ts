/**
 * The Deno stand-in for `@hub/lib/connectwaveSupabase`.
 *
 * WHY THIS FILE EXISTS
 *   `connectwaveFetcher.ts` is otherwise pure PostgREST — paging, `.select()`, `.in()` — and the
 *   only thing stopping it running on a server is its one import of the browser client, which
 *   reads `import.meta.env`. The bundle build aliases that specifier here, so the fetcher compiles
 *   unchanged and the mailed report is built by the SAME code that draws the screen. A second
 *   implementation would be a second source of truth, and the point of this whole exercise is not
 *   to have one.
 *
 * ⚠ CONNECTWAVE, NOT THE LEGACY RECEIVABLES PROJECT.
 *   The old project (`lkwtvcpeamkzzqkfnkuc`) that `receivablesSupabase.ts` still points at NO
 *   LONGER EXISTS — its hostname does not resolve. Live (Tally) is the hub's default source and
 *   ConnectWave is what every reader is actually on. A builder wired to the legacy client would
 *   fail at 08:00 in front of nobody. See CLAUDE.md and RC-4 on the work list.
 *
 * ⚠ ANON KEY, DELIBERATELY — not a service role.
 *   ConnectWave is a third-party mirror we only read. The anon key is what the browser uses and it
 *   is sufficient, so the function holds no elevated credential for a project that is not ours.
 *   Scoping to a salesperson happens later, in the report builder, exactly as it does on screen.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const url = Deno.env.get("CONNECTWAVE_URL") ?? "";
const anonKey = Deno.env.get("CONNECTWAVE_ANON_KEY") ?? "";

if (!url || !anonKey) {
  throw new Error(
    "collections-report: CONNECTWAVE_URL / CONNECTWAVE_ANON_KEY are not set. " +
    "Set them as Edge secrets from the frontend's VITE_CONNECTWAVE_SUPABASE_URL / _ANON_KEY.",
  );
}

const client = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export function getConnectwaveSupabase() {
  return client;
}
