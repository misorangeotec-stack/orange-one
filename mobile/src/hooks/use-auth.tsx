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
import type { Session, User } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AppState, Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

/** Result shape returned by the auth actions so the UI can show errors inline. */
type AuthResult = { error: string | null };

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

  useEffect(() => {
    let active = true;

    // Release the gate as soon as the session check settles — but never hang the
    // splash on it. If getSession() stalls (e.g. the device can't reach Supabase)
    // or rejects, fall through to the login screen after a short timeout instead
    // of holding the splash forever.
    const finish = () => {
      if (active) setInitializing(false);
    };
    const timeout = setTimeout(finish, 6000);

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) setSession(data.session);
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(timeout);
        finish();
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      active = false;
      clearTimeout(timeout);
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
      return { error: error?.message ?? null };
    },
    []
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut().catch(() => {});
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
