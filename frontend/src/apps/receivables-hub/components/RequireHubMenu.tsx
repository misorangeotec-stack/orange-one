import { Navigate, Outlet } from "react-router-dom";
import { BASE, useHubMenuAccess } from "@hub/lib/menus";

/**
 * Route guard for a receivables menu — the enforcement half of the per-user menu grants.
 *
 * ⚠ WHY THIS EXISTS. Until this shipped, the grants were decoration: `visibleMenusFor`
 * removed a menu from the sidebar and nothing else. Typing
 * `/outstanding-dashboard/settings` into the address bar rendered Settings in full for a
 * user whose `settings` key was denied — the deny-list looked like access control while
 * being nothing but a hidden link. Any new gate has to be applied to the ROUTE, here, not
 * just to the nav entry.
 *
 * Used as a pathless layout route, so it guards a whole subtree in one place:
 *
 *   <Route element={<RequireHubMenu menu="reports" />}>
 *     <Route path="reports" element={<Reports />} />
 *     <Route path="reports/aging" element={<AgingReport />} />   // ...and every other leaf
 *   </Route>
 *
 * `full` raises the bar from "may see the menu" to "may use its admin-depth features"
 * (profiles.receivables_admin_menus) — that is what guards the C-Level dashboards and
 * Customer Profile, which used to be pinned to role = admin.
 *
 * Denied users are sent to the hub home rather than shown a wall: they are legitimate
 * users of this app who simply weren't granted this screen, and a bounce to a page they
 * can use beats a dead end. Module-level access is already settled upstream by
 * RequireAuth + RequireModule in App.tsx.
 */
export default function RequireHubMenu({ menu, full = false }: { menu: string; full?: boolean }) {
  const { canSee, hasFullAccess } = useHubMenuAccess();
  const allowed = canSee(menu) && (!full || hasFullAccess(menu));
  if (!allowed) return <Navigate to={BASE} replace />;
  return <Outlet />;
}
