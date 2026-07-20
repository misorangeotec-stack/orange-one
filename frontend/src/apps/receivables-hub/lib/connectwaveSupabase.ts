// deploy: 2026-07-20 — rebuild to inline the Production VITE_CONNECTWAVE_* env vars.
import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Read-only Supabase client for the ConnectWave (TallyCopilot) project.
 *
 * This is a THIRD Supabase project, separate from both Orange One's identity
 * project and the (legacy) receivables project. It holds the live Tally mirror
 * (project ieeefdnyhzgrroifiqbb, tenant acct_orange) and the curated
 * `collection_*` snapshot + `ext_*` muster tables that back the admin-only
 * "Collection Report (Tally Live)" screen.
 *
 * Read-only from the app's side and must never touch the auth session, so
 * persistSession / autoRefreshToken are off (same rule as receivablesSupabase.ts)
 * — otherwise it would fight the primary client that owns the login.
 *
 * Env (frontend/.env.local + Vercel):
 *   VITE_CONNECTWAVE_SUPABASE_URL
 *   VITE_CONNECTWAVE_SUPABASE_ANON_KEY
 */
let client: SupabaseClient | null = null;

export function getConnectwaveSupabase(): SupabaseClient {
  if (!client) {
    const url = import.meta.env.VITE_CONNECTWAVE_SUPABASE_URL;
    const key = import.meta.env.VITE_CONNECTWAVE_SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error(
        "VITE_CONNECTWAVE_SUPABASE_URL and VITE_CONNECTWAVE_SUPABASE_ANON_KEY must be set " +
        "in frontend/.env.local (required for the Collection Report (Tally Live) screen)"
      );
    }
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
