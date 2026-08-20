/**
 * The server stand-in for `@/core/platform/supabase` — the portal's own project.
 *
 * The app code the report imports does not knowingly use this client; it is here because the
 * import graph brushes against modules that construct one at load time, and a browser client
 * reading `import.meta.env` would blow up on `import` rather than on use. Swapping it at the
 * module boundary keeps every one of those modules compiling untouched.
 *
 * ⚠ SERVICE ROLE, AND THEREFORE RLS DOES NOT APPLY.
 *   The job legitimately needs it: it reads the schedule and the address book, writes into
 *   `report-exports`, and inserts `email_outbox` rows — a table with RLS on and NO policies, so
 *   there is no lesser key that can do it. Everything it may decide is decided in SQL by
 *   `collections_report_due()`, not here, precisely because the key itself checks nothing.
 *
 *   It is a repository secret and must never be printed. `entry.ts` logs addresses and counts,
 *   never headers.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!url || !key) {
  throw new Error(
    "collections-report: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set. " +
      "These are the portal's own project (icutjkrqkbzwvmnfbzpr), not ConnectWave.",
  );
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export function getSupabase() {
  return supabase;
}
