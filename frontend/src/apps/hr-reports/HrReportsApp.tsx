/**
 * HR Reports (HRREP-1) — root.
 *
 * Two HR instruments the client writes by hand, rendered from live data, plus the two
 * reference pages that explain them. They were built as a localhost lab, then lived
 * briefly inside New Recruitment; they are their own app because they belong to every
 * employee, not to the recruitment team — a person with no business in the recruitment
 * pipeline still has their own KPI sheet.
 *
 * ── What it reads and what it writes ──────────────────────────────────────────
 * Reads: `kpi_report` (permission-checked server-side), the recruitment tables under the
 * caller's own RLS, and `hr_report_viewers`. WRITES: nothing, anywhere. Figures a reader
 * types stay in their own browser — every page says so on its face, because on a live
 * portal somebody will fill forty boxes and expect them kept.
 *
 * ⚠ UNIVERSAL APP. Everybody can open it with no grant (apps/universal.ts), so every
 *   page must be safe for an employee who has never heard of a requisition. That is why
 *   the scorecard refuses to score somebody whose job has no sheet rather than falling
 *   back to another job's targets, and why the person picker is built from lib/scope.ts.
 */
import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "@/shared/components/layout/AppShell";
import { roleLabel, useSession } from "@/core/platform/session";
import { appBasePath } from "../appInfo";
import { buildHrReportsNav, HR_REPORTS_BASE } from "./nav";
import Compare from "./pages/Compare";
import FieldMap from "./pages/FieldMap";
import Scorecard from "./pages/Scorecard";
import WeeklyReview from "./pages/WeeklyReview";
import Settings from "./pages/Settings";

function Layout() {
  const { user, role, isAdmin } = useSession();
  return (
    <AppShell
      nav={buildHrReportsNav({ isAdmin })}
      role={role}
      user={{ name: user.name, designation: user.designation, color: user.avatarColor, roleLabel: roleLabel(role) }}
      notifications={[]}
    />
  );
}

/** Settings edits a permission table; an admin is the only one who may open it. */
function AdminOnly({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useSession();
  if (!isAdmin) return <Navigate to={HR_REPORTS_BASE} replace />;
  return <>{children}</>;
}

export default function HrReportsApp() {
  const { isExternal, isAdmin } = useSession();
  // A customer login has no KPI sheet and no weekly review, exactly as in the live
  // scorecard next door.
  if (isExternal && !isAdmin) return <Navigate to={appBasePath("customer-orders")} replace />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Scorecard />} />
        <Route path="weekly-review" element={<WeeklyReview />} />
        <Route path="compare" element={<Compare />} />
        <Route path="weekly-review-fields" element={<FieldMap />} />
        <Route path="settings" element={<AdminOnly><Settings /></AdminOnly>} />
        <Route path="*" element={<Navigate to={HR_REPORTS_BASE} replace />} />
      </Route>
    </Routes>
  );
}
