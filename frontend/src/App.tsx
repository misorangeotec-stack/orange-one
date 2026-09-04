import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useEffect, type ReactNode } from "react";
import { supabase } from "@/core/platform/supabase";
import Landing from "@/core/landing/Landing";
import Login from "@/core/auth/Login";
import HomeLayout from "@/core/workspace/HomeLayout";
import MyWorkToday from "@/core/workspace/MyWorkToday";
import Account from "@/core/account/Account";
import AdminApp from "@/core/admin/AdminApp";
import RequireRole from "@/core/platform/RequireRole";
import { RequireAuth } from "@/core/platform/auth";
import { useSession } from "@/core/platform/session";
import { liveApps } from "@/apps/registry";
import { appBasePath } from "@/apps/appInfo";

/**
 * Last time each module was stamped, per tab. Survives remounts because it is
 * module-level, so walking out of an app and back in does not re-ping.
 */
const stampedAt = new Map<string, number>();
const VISIT_THROTTLE_MS = 30 * 60_000;

/**
 * Gate a live app behind the current user's module access (admins bypass), and
 * record the visit.
 *
 * WHY THE PING LIVES HERE
 *   Every metric the Master Report had was a row count, which is blind to a
 *   module people READ rather than write to. The Outstanding Dashboard is one:
 *   its data lives in a different Supabase project and nobody types into it, so
 *   it read as Dormant while in daily use. `touch_module_visit` supplies the
 *   missing signal, and this guard is the one place that wraps every mounted
 *   app and knows its id — mirroring `touch_last_active()` in auth.tsx, which
 *   does the same thing portal-wide.
 *
 *   Fire-and-forget and throttled: telemetry hanging off a route guard must
 *   never be able to delay or break navigation.
 */
function RequireModule({ appId, children }: { appId: string; children: ReactNode }) {
  const { hasModule } = useSession();
  const allowed = hasModule(appId);

  useEffect(() => {
    if (!allowed) return;
    const now = Date.now();
    if (now - (stampedAt.get(appId) ?? 0) < VISIT_THROTTLE_MS) return;
    stampedAt.set(appId, now);
    void supabase.rpc("touch_module_visit", { p_app_id: appId }).then(
      () => {},
      () => {}
    );
  }, [appId, allowed]);

  if (!allowed) return <Navigate to="/home" replace />;
  return <>{children}</>;
}

/**
 * `/account` is the STAFF account screen. A customer gets their own.
 *
 * ⚠ `RequireModule` does not cover this route, and cannot: `/account` is portal
 *   furniture rather than an app, so nothing gates it by grant. Left open, a
 *   customer following an old link or simply typing the path lands on a page
 *   headed "My Account" carrying a department, a designation and a "Home" link
 *   into the staff launcher — the whole of what the Order Desk's own shell exists
 *   to keep away from them.
 *
 *   The password half of that page IS legitimately theirs, so they are sent to
 *   their own version of it rather than bounced to a screen they did not ask for.
 *
 * A wrapper rather than an early return inside `Account.tsx`: that component
 * opens a dozen `useState` calls off the directory, and a return placed before
 * them would change the hook count between renders once the directory arrives.
 */
function StaffOnly({ children }: { children: ReactNode }) {
  const { isExternal, isAdmin } = useSession();
  if (isExternal && !isAdmin) {
    return <Navigate to={`${appBasePath("customer-orders")}/password`} replace />;
  }
  return <>{children}</>;
}

/** Where General Purchase lived until 29-07-2026. Kept only for the redirect below. */
const LEGACY_SUPPLIES_BASE = "/office-supplies";

/**
 * /office-supplies/* → the module's new home, path + query + hash intact.
 *
 * ⚠ THE REDIRECT IS LOAD-BEARING, NOT A COURTESY. A queued email_outbox row
 *   carries the `ctaPath` it was authored with — that path is frozen at enqueue
 *   time, not built at render — so every approval mail written under the old
 *   base still points there. A 404 on an approval link is how an approval
 *   quietly does not happen. Same reasoning as the Customer Onboarding
 *   redirect in ReceivablesHubApp.tsx, which moved a module the same week.
 *
 * ⚠ NOT wrapped in RequireAuth, deliberately: rewriting FIRST means the new
 *   route's own guard records the NEW path as `state.from`, so a signed-out
 *   reader following an old link lands on the request itself after signing in.
 *   Someone without the module grant still gets sent to /home by RequireModule.
 *
 * `slice`, not `split` on the prefix: the bare "/office-supplies" has to
 * redirect too, and split() yields undefined for it. The target is read from
 * appInfo, so if the base ever moves again only that one line changes.
 */
function OfficeSuppliesLegacyRedirect() {
  const { pathname, search, hash } = useLocation();
  const rest = pathname.slice(LEGACY_SUPPLIES_BASE.length);
  return <Navigate to={`${appBasePath("office-supplies")}${rest}${search}${hash}`} replace />;
}

export default function App() {
  return (
    <Routes>
      {/* ---- Public (landing + auth) ---- */}
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />

      {/* ---- Signed-in portal (launcher + account + admin) ---- */}
      {/* Nested: HomeLayout renders the shared AppShell, whose <Outlet/> is the page. */}
      <Route path="/home" element={<RequireAuth><HomeLayout /></RequireAuth>}>
        <Route index element={<MyWorkToday />} />
      </Route>
      <Route path="/account" element={<RequireAuth><StaffOnly><Account /></StaffOnly></RequireAuth>} />
      <Route path="/admin/*" element={<RequireAuth><RequireRole roles={["admin"]}><AdminApp /></RequireRole></RequireAuth>} />

      {/* ---- Registered apps, each owns everything under its basePath, gated by auth + access ---- */}
      {liveApps.map((app) => {
        const Component = app.Component!;
        return (
          <Route
            key={app.id}
            path={`${app.basePath}/*`}
            element={<RequireAuth><RequireModule appId={app.id}><Component /></RequireModule></RequireAuth>}
          />
        );
      })}

      {/* ---- Moved on 29-07-2026: General Purchase left /office-supplies ---- */}
      <Route path={LEGACY_SUPPLIES_BASE} element={<OfficeSuppliesLegacyRedirect />} />
      <Route path={`${LEGACY_SUPPLIES_BASE}/*`} element={<OfficeSuppliesLegacyRedirect />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
