import { createContext, useContext, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { clearAllSticky } from "@/shared/lib/stickyState";
import { clearAllReturnTo } from "@/shared/lib/returnTo";
import { supabase } from "./supabase";
import { clearPersistedCache } from "@/queryPersister";

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
  const queryClient = useQueryClient();
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
    const timers: ReturnType<typeof setTimeout>[] = [];
    const stamp = (s: Session | null) => {
      if (!s) return;
      const now = Date.now();
      if (now - lastStampAt < 60_000) return;
      lastStampAt = now;
      /*
        ⚠ DEFERRED OUT OF THE AUTH CALLBACK ON PURPOSE, not for politeness.

          onAuthStateChange listeners are invoked by supabase-js from INSIDE the
          lock it holds over the stored session (GoTrueClient `_acquireLock` →
          `_notifyAllSubscribers`), and every PostgREST call re-enters that same
          lock to resolve its access token. Calling a Supabase function straight
          from the callback is the case their docs warn about: at best the
          sign-in now waits on this round-trip before it completes, at worst a
          request resolves its token against a half-written session and goes out
          unauthenticated — which, on an RLS'd table, is a silent 200 with an
          empty body rather than an error. `store.tsx` explains what an empty
          directory then did to the whole app.

          A macrotask is enough: the lock is released before the timer fires.
          Telemetry hanging off auth must never be able to affect auth.
      */
      timers.push(setTimeout(() => supabase.rpc("touch_last_active").then(() => {}, () => {}), 0));
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
    return () => {
      sub.subscription.unsubscribe();
      for (const t of timers) clearTimeout(t);
    };
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
      /*
        ⚠ AND THE SERVER DATA, WHICH IS THE HALF THAT WAS MISSING. The query cache
          is also persisted to IndexedDB, and nothing ever cleared it: the last
          user's receivables payload and the staff directory stayed on disk for the
          full 24-hour max age, readable through devtools by anyone who opened the
          browser WITHOUT logging in. Dispatch's catalogue — customer names, GSTINs,
          phone numbers, email addresses — now persists too, so this is no longer a
          theoretical tidiness point.

          Both halves are needed: clear() empties memory, removeClient() deletes the
          disk copy and cancels any throttled write that would otherwise flush the
          cache straight back out again.
      */
      queryClient.clear();
      await clearPersistedCache().catch(() => {});
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
