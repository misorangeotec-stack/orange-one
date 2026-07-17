import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { clearAllSticky } from "@/shared/lib/stickyState";
import { clearAllReturnTo } from "@/shared/lib/returnTo";
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
    // Record "last active" whenever the user is actually in the app:
    //   • app open with a restored session (getSession + INITIAL_SESSION)
    //   • a fresh sign-in (SIGNED_IN)
    //   • a long-open tab whose token refreshes (TOKEN_REFRESHED, ~hourly)
    // Fire-and-forget (a failed stamp must never block auth) and throttled to at
    // most once a minute, so bursty/duplicate auth events don't spam the write.
    let lastStampAt = 0;
    const stamp = (s: Session | null) => {
      if (!s) return;
      const now = Date.now();
      if (now - lastStampAt < 60_000) return;
      lastStampAt = now;
      supabase.rpc("touch_last_active").then(() => {}, () => {});
    };
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
      stamp(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") {
        stamp(s);
      }
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
      // Signing out is an SPA navigate, not a page reload, so these in-memory stores
      // would otherwise survive into the next user's session on a shared machine and
      // hand them the previous user's filters, search text and assignee selections.
      clearAllSticky();
      clearAllReturnTo();
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
