import { Routes, Route, Navigate } from "react-router-dom";
import RequireRole from "@/core/platform/RequireRole";
import LeadsLayout from "./LeadsLayout";
import { LeadsProvider } from "./lib/LeadsProvider";
import Overview from "./pages/Overview";
import LeadsTable from "./pages/LeadsTable";
import Masters from "./pages/Masters";

/**
 * Root of the Leads Dashboard app — owns all routing under /leads-dashboard.
 * Access is gated upstream by <RequireModule appId="leads-dashboard"> in App.tsx
 * (admins bypass); cross-user data read is enforced server-side by RLS. Data +
 * filter state are shared across pages via LeadsProvider. Masters is admin-only:
 * the lead master lists are org-wide config, and only admins may write them (RLS).
 */
export default function LeadsDashboardApp() {
  return (
    <LeadsProvider>
      <Routes>
        <Route element={<LeadsLayout />}>
          <Route index element={<Overview />} />
          <Route path="leads" element={<LeadsTable />} />
          <Route path="masters" element={<RequireRole roles={["admin"]}><Masters /></RequireRole>} />
          <Route path="*" element={<Navigate to="/leads-dashboard" replace />} />
        </Route>
      </Routes>
    </LeadsProvider>
  );
}
