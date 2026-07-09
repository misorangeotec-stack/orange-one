/**
 * Authentication layer. Wraps the app in `_layout.tsx` and exposes the session
 * plus sign-in / sign-out actions. Backed by the Orange One identity Supabase
 * project, so accounts are the same ones used by the web portal.
 *
 * Expo Go SDK 54 safe: email/password is plain supabase-js — no native auth
 * module, no dev build. (Google OAuth can be added later with expo-web-browser
 * + expo-linking + supabase.auth.signInWithOAuth; deliberately omitted for now.)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

/** Result shape returned by the auth actions so the UI can show errors inline. */
type AuthResult = { error: string | null };

// ---- Offline session persistence -------------------------------------------
//
// The user must stay signed in until they explicitly sign out — a phone with no
// signal on an exhibition floor may not see the network for hours.
//
// supabase-js can't give us that on its own. Once the access token expires (~1h),
// `getSession()` tries to refresh it; offline that retries for ~30s and then
// resolves `{ session: null, error }`. Crucially it does NOT discard the stored
// session on a network error — the refresh token is still on disk, and Supabase
// refresh tokens don't expire — but the app used to read that null as "logged
// out" and show the login screen, where signing in is impossible with no network.
//
// So: read the persisted session straight from AsyncStorage on boot and trust it
// unless the user actually signed out; treat a failed `getSession()` as
// "unverified", never as "signed out". The client heals itself on reconnect via
// startAutoRefresh, which emits TOKEN_REFRESHED.

/** Mirrors supabase-js's `defaultStorageKey` — we pass no custom `storageKey`. */
const AUTH_STORAGE_KEY = (() => {
  try {
    const host = new URL(process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').hostname;
    return `sb-${host.split('.')[0]}-auth-token`;
  } catch {
    return '';
  }
})();

/** Set only by an explicit signOut(), cleared on sign-in. */
const SIGNED_OUT_KEY = 'orange-one.auth.signed-out';

/** The session supabase-js persisted, read directly. Null if absent or unparseable. */
async function readPersistedSession(): Promise<Session | null> {
  if (!AUTH_STORAGE_KEY) return null;
  try {
    const raw = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // We don't configure `userStorage`, so the session is stored flat. The
    // wrappers are defensive against other supabase-js layouts.
    const s = parsed?.access_token ? parsed : parsed?.session ?? parsed?.currentSession ?? null;
    return s?.access_token && s?.user ? (s as Session) : null;
  } catch {
    return null;
  }
}

/**
 * A null session may only clear a good one when the user really signed out.
 * Any other event carrying null (an offline INITIAL_SESSION, say) keeps what we have.
 */
function reduceAuth(prev: Session | null, event: AuthChangeEvent, next: Session | null): Session | null {
  if (event === 'SIGNED_OUT') return null;
  return next ?? prev;
}

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  /** The signed-in user's id, or null. Used to namespace per-user data. */
  userId: string | null;
  /** True until the initial getSession() resolves — gate the UI on this. */
  initializing: boolean;
  /**
   * Whether the signed-in user may use this mobile app (admins always; others
   * need the 'mobile-app' module grant). null = not yet checked; the AuthGate
   * blocks the app when this is false.
   */
  hasAppAccess: boolean | null;
  signInWithPassword: (email: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [hasAppAccess, setHasAppAccess] = useState<boolean | null>(null);
  // Set the moment signOut() runs. The boot verification below may already hold a
  // session it read before the sign-out; without this it would hand it straight back.
  const signedOutRef = useRef(false);

  useEffect(() => {
    let active = true;

    (async () => {
      // 1) Trust what's on disk. Offline this is the whole story, and it renders
      //    the app immediately instead of holding a splash on a doomed refresh.
      const signedOut = await AsyncStorage.getItem(SIGNED_OUT_KEY).catch(() => null);
      const persisted = signedOut === '1' ? null : await readPersistedSession();
      if (!active) return;
      if (persisted) {
        // `prev ?? persisted`: an INITIAL_SESSION/TOKEN_REFRESHED event may have
        // landed a fresher session while we were reading disk — don't stale it.
        setSession((prev) => prev ?? persisted);
        setInitializing(false);
      }

      // 2) Verify against the server, bounded. `getSession()` can retry a token
      //    refresh for ~30s before giving up, so never wait on it indefinitely.
      const TIMED_OUT = Symbol('timeout');
      const verified = await Promise.race([
        supabase.auth.getSession().catch((error) => ({ data: { session: null }, error })),
        new Promise<typeof TIMED_OUT>((res) => setTimeout(() => res(TIMED_OUT), 8000)),
      ]);
      if (!active || signedOutRef.current) return;

      if (verified !== TIMED_OUT) {
        if (verified.data.session) {
          setSession(verified.data.session); // fresh and verified — always win
        } else if (!verified.error) {
          setSession(null); // genuinely signed out on the server
        }
        // else: errored → unverified. Keep the persisted session (the offline case).
      }
      setInitializing(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession((prev) => reduceAuth(prev, event, nextSession));
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Gate mobile-app usage on the 'mobile-app' module grant (admins always pass).
  // Source of truth is the app_mobile_has_access() RPC; the result is cached per
  // user so a returning granted user isn't blocked while briefly offline.
  const authUserId = session?.user?.id ?? null;
  useEffect(() => {
    if (!authUserId) {
      setHasAppAccess(null);
      return;
    }
    let active = true;
    const cacheKey = `orange-one.mobile-access::${authUserId}`;

    (async () => {
      try {
        const cached = await AsyncStorage.getItem(cacheKey);
        if (active && cached != null) setHasAppAccess(cached === '1');
      } catch {
        /* ignore */
      }

      try {
        const res = await Promise.race([
          supabase.rpc('app_mobile_has_access'),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
        ]);
        if (!active) return;
        if (!res.error) {
          const ok = !!res.data;
          setHasAppAccess(ok);
          AsyncStorage.setItem(cacheKey, ok ? '1' : '0').catch(() => {});
        } else {
          // Server reachable but errored → fail closed unless we already trust a grant.
          setHasAppAccess((prev) => (prev == null ? false : prev));
        }
      } catch {
        // Offline / timeout → keep any cached decision; otherwise fail closed.
        if (active) setHasAppAccess((prev) => (prev == null ? false : prev));
      }
    })();

    return () => {
      active = false;
    };
  }, [authUserId]);

  // Refresh tokens only while the app is foregrounded (the documented RN pattern).
  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (AppState.currentState === 'active') supabase.auth.startAutoRefresh();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') supabase.auth.startAutoRefresh();
      else supabase.auth.stopAutoRefresh();
    });
    return () => sub.remove();
  }, []);

  const signInWithPassword = useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (!error) {
        signedOutRef.current = false;
        await AsyncStorage.removeItem(SIGNED_OUT_KEY).catch(() => {});
      }
      return { error: error?.message ?? null };
    },
    []
  );

  const signOut = useCallback(async () => {
    // Signing out is the ONLY way to end a session, so it has to work with no
    // network. `scope: 'local'` drops the stored session without the server-side
    // revoke round-trip, which would hang or fail offline and leave the user
    // signed in. The flag survives even if that local clear somehow fails.
    signedOutRef.current = true;
    await AsyncStorage.setItem(SIGNED_OUT_KEY, '1').catch(() => {});
    setSession(null);
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  }, []);

  const userId = session?.user?.id ?? null;

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      userId,
      initializing,
      hasAppAccess,
      signInWithPassword,
      signOut,
    }),
    [session, userId, initializing, hasAppAccess, signInWithPassword, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
