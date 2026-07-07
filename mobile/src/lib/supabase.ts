/**
 * Supabase client — the mobile app's single connection to the Orange One backend
 * (the Task Management / identity project, ref `coshondiqdhorwvibrwu`). It is the
 * SAME project the web portal authenticates against, so staff sign in here with
 * their existing Orange One credentials.
 *
 * Expo Go SDK 54 safe: supabase-js and react-native-url-polyfill are pure JS, so
 * no custom native module / dev build is required.
 *
 * The URL + anon key come from EXPO_PUBLIC_* env vars (see `.env.example`). The
 * anon key is publishable by design — data is guarded by Row-Level Security on
 * the server, not by hiding the key.
 */

// MUST be first: supabase-js builds `URL`/`URLSearchParams` which Hermes lacks.
import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/database.types';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Surface a clear message instead of a cryptic network error deep in a query.
  console.warn(
    '[supabase] Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Copy .env.example to .env, fill in the project values, then restart `npx expo start`.'
  );
}

export const supabase = createClient<Database>(supabaseUrl ?? '', supabaseAnonKey ?? '', {
  auth: {
    // Persist the session so users stay logged in across relaunches.
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // React Native has no browser URL to parse.
    detectSessionInUrl: false,
    // PKCE is the secure flow for native redirects (used if OAuth is added later).
    flowType: 'pkce',
  },
});
