import { createClient } from "@supabase/supabase-js";

/**
 * Single Supabase browser client for the whole portal (Stage B). Uses the public
 * anon key under Row Level Security — every read/write is gated by the policies on
 * the existing tables, so the browser can never see or change data the signed-in
 * user isn't entitled to. The service-role key NEVER enters the browser bundle.
 *
 * Values come from frontend/.env.local (gitignored): VITE_SUPABASE_URL +
 * VITE_SUPABASE_ANON_KEY.
 */
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Missing Supabase env vars. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to frontend/.env.local."
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// Dev-only: expose the client for manual verification/cleanup during the B4
// write rollout (runs under the signed-in user + RLS). Never present in prod builds.
if (import.meta.env.DEV) {
  (window as unknown as { sb: typeof supabase }).sb = supabase;
}
