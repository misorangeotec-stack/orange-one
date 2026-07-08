import { Routes, Route, Navigate } from "react-router-dom";
import LeadsLayout from "./LeadsLayout";
import { LeadsProvider } from "./lib/LeadsProvider";
import Overview from "./pages/Overview";
import LeadsTable from "./pages/LeadsTable";

/**
 * Root of the Leads Dashboard app — owns all routing under /leads-dashboard.
 * Access is gated upstream by <RequireModule appId="leads-dashboard"> in App.tsx
 * (admins bypass); cross-user data read is enforced server-side by RLS. Data +
 * filter state are shared across pages via LeadsProvider.
 */
export default function LeadsDashboardApp() {
  return (
    <LeadsProvider>
      <Routes>
        <Route element={<LeadsLayout />}>
          <Route index element={<Overview />} />
          <Route path="leads" element={<LeadsTable />} />
          <Route path="*" element={<Navigate to="/leads-dashboard" replace />} />
        </Route>
      </Routes>
    </LeadsProvider>
  );
}
