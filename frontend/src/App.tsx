import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
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

/** Gate a live app behind the current user's module access (admins bypass). */
function RequireModule({ appId, children }: { appId: string; children: ReactNode }) {
  const { hasModule } = useSession();
  if (!hasModule(appId)) return <Navigate to="/home" replace />;
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
      <Route path="/account" element={<RequireAuth><Account /></RequireAuth>} />
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
