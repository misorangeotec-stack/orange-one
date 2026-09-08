import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared read-only client for the ConnectWave (TallyCopilot) project — the live Tally mirror.
 *
 * This is a THIRD Supabase project, separate from Orange One's identity project and the legacy
 * receivables one. Until now only the receivables hub talked to it, through its own client at
 * `apps/receivables-hub/lib/connectwaveSupabase.ts`. Order Desk needs it too (the LOT picker at
 * Check Material Status), and a hub-internal module is the wrong thing for another app to import,
 * so the client lives here in core.
 *
 * ⚠ The receivables hub keeps its own copy on purpose. It is working, heavily used, and
 *   re-pointing ~20 of its modules at this one would be a large change with no user-visible
 *   benefit. Two clients against the same URL are harmless — both are read-only and neither owns
 *   a session. If the hub is ever refactored, it should adopt this module and its copy deleted.
 *
 * Read-only, and it must NEVER touch the auth session: `persistSession` and `autoRefreshToken` are
 * off so it cannot fight the primary client that owns the login. Same rule the hub's copy follows.
 *
 * Env (frontend/.env.local + Vercel) — the SAME two vars the hub already requires, so no new
 * deployment configuration is needed for this to work:
 *   VITE_CONNECTWAVE_SUPABASE_URL
 *   VITE_CONNECTWAVE_SUPABASE_ANON_KEY
 */
let client: SupabaseClient | null = null;

export function getConnectwave(): SupabaseClient {
  if (!client) {
    const url = import.meta.env.VITE_CONNECTWAVE_SUPABASE_URL;
    const key = import.meta.env.VITE_CONNECTWAVE_SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error(
        "VITE_CONNECTWAVE_SUPABASE_URL and VITE_CONNECTWAVE_SUPABASE_ANON_KEY must be set " +
        "in frontend/.env.local (required for the live Tally LOT picker)"
      );
    }
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

/** True when the ConnectWave vars are configured, so callers can degrade instead of throwing. */
export function hasConnectwave(): boolean {
  return Boolean(
    import.meta.env.VITE_CONNECTWAVE_SUPABASE_URL &&
    import.meta.env.VITE_CONNECTWAVE_SUPABASE_ANON_KEY
  );
}
