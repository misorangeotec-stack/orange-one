import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

/**
 * Real Supabase authentication for the portal (Stage B). Tracks the auth session
 * and exposes sign-in / sign-out. This is the auth GATE — it controls who may
 * enter the app. The app's identity/data still come from the existing providers
 * for now; a later phase swaps those for live queries keyed off this session.
 */
interface AuthValue {
  session: Session | null;
  loading: boolean;
  /** Returns an error message on failure, or null on success. */
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Stamp "last active" once per app open / login. Fire-and-forget: a failed
    // stamp must never block auth. We stamp on the initial session resolve and on
    // an explicit SIGNED_IN — not on every TOKEN_REFRESHED — matching the
    // "app open / login only" signal.
    const stamp = (s: Session | null) => {
      if (s) supabase.rpc("touch_last_active").then(() => {}, () => {});
    };
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
      stamp(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "SIGNED_IN") stamp(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const value: AuthValue = {
    session,
    loading,
    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      return error?.message ?? null;
    },
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/** Route guard: requires a signed-in session, else redirects to /login. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page-grad text-grey text-sm">
        Loading…
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}
