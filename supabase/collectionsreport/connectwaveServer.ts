/**
 * The server stand-in for `@hub/lib/connectwaveSupabase`.
 *
 * WHY THIS FILE EXISTS
 *   `connectwaveFetcher.ts` is otherwise pure PostgREST — paging, `.select()`, `.in()` — and the
 *   only thing stopping it running off-browser is its one import of the browser client, which
 *   reads `import.meta.env`. The build aliases that specifier here, so the fetcher compiles
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
 *   is sufficient, so the job holds no elevated credential for a project that is not ours.
 *   Scoping to a salesperson happens later, in the report builder, exactly as it does on screen.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.CONNECTWAVE_URL ?? "";
const anonKey = process.env.CONNECTWAVE_ANON_KEY ?? "";

if (!url || !anonKey) {
  throw new Error(
    "collections-report: CONNECTWAVE_URL / CONNECTWAVE_ANON_KEY are not set. " +
      "They are the frontend's VITE_CONNECTWAVE_SUPABASE_URL / _ANON_KEY, and on CI they come " +
      "from the repository secrets of the same name.",
  );
}

// ⚠ SHAPE-CHECKED, not merely presence-checked. A secret set to the wrong thing — the literal
// string "-", from a mis-typed `gh secret set`, is the one that actually happened — reaches
// supabase-js as "Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL", thrown from line 61906
// of a 4 MB bundle, naming neither the variable nor which of the two projects it meant. Ten
// characters here turn that into a sentence.
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url)) {
  throw new Error(
    `collections-report: CONNECTWAVE_URL is not a Supabase URL (got "${url}"). ` +
      "Expected https://<ref>.supabase.co — the value of VITE_CONNECTWAVE_SUPABASE_URL.",
  );
}

const client = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export function getConnectwaveSupabase() {
  return client;
}
