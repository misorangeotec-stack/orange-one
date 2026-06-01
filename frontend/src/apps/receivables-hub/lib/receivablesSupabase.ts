import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Data-only Supabase client for the Receivables Hub app.
 *
 * This points at the Hub's OWN Supabase project (the one fed by the
 * Tally -> Google Sheets -> process_data.py pipeline), which is SEPARATE from
 * Orange One's primary auth project. It is read-only as far as the app is
 * concerned and must never touch the auth session, so persistSession and
 * autoRefreshToken are both off — otherwise it would compete with the primary
 * client (core/platform/supabase.ts) that owns the logged-in session.
 *
 * Env (frontend/.env.local):
 *   VITE_RECEIVABLES_SUPABASE_URL
 *   VITE_RECEIVABLES_SUPABASE_ANON_KEY
 */
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    const url = import.meta.env.VITE_RECEIVABLES_SUPABASE_URL;
    const key = import.meta.env.VITE_RECEIVABLES_SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error(
        "VITE_RECEIVABLES_SUPABASE_URL and VITE_RECEIVABLES_SUPABASE_ANON_KEY must be set " +
        "in frontend/.env.local (required when VITE_DATA_SOURCE=supabase)"
      );
    }
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
