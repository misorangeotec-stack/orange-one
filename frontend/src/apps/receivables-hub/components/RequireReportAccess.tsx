import { Navigate, Outlet, useLocation } from "react-router-dom";
import { findReport, reportHref, reportsAtPath, type ReportEntry } from "@hub/lib/reportCatalog";
import { BASE } from "@hub/lib/menus";
import { useReportAccess } from "@hub/lib/reportAccess";
import ScopeBanner from "@hub/components/ScopeBanner";

/**
 * Route guard for the per-report grants — the enforcement half of
 * profiles.receivables_allowed_reports.
 *
 * ⚠ WHY IT IS ONE COMPONENT AND NOT 31 WRAPPERS. This module gains reports steadily, and a
 * per-route guard is a step somebody eventually forgets — which is exactly how
 * reports/sales-dashboard and reports/purchase-dashboard ended up reachable by any Standard
 * user despite sitting in an admin-only category: the routes were simply left outside the
 * `full` wrapper. Resolving the URL against the catalogue instead means a new report is
 * guarded the moment it is catalogued, with no route edit at all.
 *
 * Used as a pathless layout route INSIDE the existing Reports menu guard:
 *
 *   <Route element={<RequireHubMenu menu="reports" />}>
 *     <Route element={<RequireReportAccess />}>
 *       ...every report route...
 *
 * It also renders the ScopeBanner, because it has already had to resolve the entry.
 *
 * Denied users go to the hub home rather than a wall, matching RequireHubMenu: they are
 * legitimate users of this app who were not granted this screen.
 */

/**
 * List routes with a `/:id` detail child that has no catalogue entry of its own. The detail
 * page inherits the list's grant — holding "Ledger Outstandings" means holding the bills
 * behind each row. (reportCrumbs does the same prefix walk for the breadcrumb trail.)
 */
const DETAIL_PARENTS = ["ledger-outstanding", "ledger-voucher"] as const;

/**
 * Does the URL's query pin this entry specifically?
 *
 * Same predicate findReport uses for its exact-match pass, needed separately here because the
 * guard has to tell "the URL named this report" apart from "findReport fell back to the first
 * entry sharing the path". Only two entries are affected — the ?below=0 / ?below=30 pair.
 */
function queryPins(entry: ReportEntry, search: string): boolean {
  const q = entry.path?.split("?")[1];
  if (!q) return false;
  const have = new URLSearchParams(search);
  return [...new URLSearchParams(q)].every(([k, v]) => have.get(k) === v);
}

export default function RequireReportAccess() {
  const { pathname, search } = useLocation();
  const { canSee } = useReportAccess();

  const deny = <Navigate to={BASE} replace />;
  const allow = (report: ReportEntry) => (
    <>
      <ScopeBanner report={report} />
      <Outlet />
    </>
  );

  // The catalogue landing page itself is always reachable — it simply lists fewer rows, and a
  // user with nothing granted gets its empty state. Guarding it would strand them on the
  // dashboard with no way to see that they have no reports.
  if (pathname === `${BASE}/reports`) return <Outlet />;

  // A detail route under a list report: judged on the parent's grant.
  for (const parentId of DETAIL_PARENTS) {
    if (!pathname.startsWith(`${BASE}/reports/${parentId}/`)) continue;
    const parent = findReport(`${BASE}/reports/${parentId}`, "");
    if (!parent || !canSee(parent.id)) return deny;
    return allow(parent);
  }

  const entry = findReport(pathname, search);
  // Not in the catalogue = not a report we can reason about. Fail CLOSED: a report someone
  // forgot to catalogue must not be an unguarded back door.
  if (!entry) return deny;

  // Bare-path ambiguity. Two reports live at reports/collections and differ only by ?below=,
  // so with no query findReport returns whichever is declared first — a coin toss that would
  // deny a user the report they actually hold. Redirect them to the sibling they hold instead.
  const siblings = reportsAtPath(pathname);
  if (siblings.length > 1 && !siblings.some((s) => queryPins(s, search))) {
    const held = siblings.find((s) => canSee(s.id));
    if (!held) return deny;
    if (held.id !== entry.id) return <Navigate to={reportHref(held)} replace />;
  }

  if (!canSee(entry.id)) return deny;
  return allow(entry);
}
