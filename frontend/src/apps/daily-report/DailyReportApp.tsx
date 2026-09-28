import { Routes, Route, Navigate } from "react-router-dom";

import AppShell from "@/shared/components/layout/AppShell";
import { useSession, roleLabel } from "@/core/platform/session";

import { dailyReportNav } from "./nav";
import { useBalanceStatus } from "./data/bankBalances";
import { todayIso } from "./lib/format";
import DailyReport from "./pages/DailyReport";
import BankBalances from "./pages/BankBalances";
import BankAccounts from "./pages/BankAccounts";
import EmailSettings from "./pages/EmailSettings";

/** Wires the portal session into the shared AppShell, as every app does. */
function DailyReportLayout() {
  const { user, role } = useSession();
  // The nav badge counts TODAY's gaps, never the gaps of whatever day the report
  // happens to be showing — a director reading last Tuesday must not see the
  // badge clear itself because that day was complete.
  const status = useBalanceStatus(todayIso());
  const missing = status.data ? status.data.expected - status.data.entered : 0;

  return (
    <AppShell
      nav={dailyReportNav(Math.max(0, missing))}
      role={role}
      user={{ name: user.name, designation: user.designation, color: user.avatarColor, roleLabel: roleLabel(role) }}
      notifications={[]}
    />
  );
}

/**
 * Root of the Daily Report — the evening snapshot for management and the CFO.
 *
 * Access is gated upstream by <RequireModule appId="daily-report"> in App.tsx
 * (admins bypass), and again in the database: the typed bank balances are the
 * company's live cash position, so their RLS policy requires the same module
 * rather than trusting the route.
 */
export default function DailyReportApp() {
  return (
    <Routes>
      <Route element={<DailyReportLayout />}>
        <Route index element={<DailyReport />} />
        <Route path="bank-balances" element={<BankBalances />} />
        <Route path="bank-accounts" element={<BankAccounts />} />
        {/* Admin-only in practice; the page itself says so rather than the route hiding it, so a
            non-admin who follows a link gets an explanation instead of a silent redirect. */}
        <Route path="email" element={<EmailSettings />} />
        <Route path="*" element={<Navigate to="/daily-report" replace />} />
      </Route>
    </Routes>
  );
}
