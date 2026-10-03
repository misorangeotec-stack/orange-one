/**
 * ALL DRAFTS — the app shell. One page: every saved raise-form draft the
 * signed-in person may see (RLS on public.fms_drafts decides).
 */
import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "@/shared/components/layout/AppShell";
import type { NavItem } from "@/shared/components/layout/types";
import { roleLabel, useSession } from "@/core/platform/session";
import { appBasePath, appName } from "../appInfo";
import AllDrafts from "./pages/AllDrafts";

const B = appBasePath("all-drafts");

const NAV: NavItem[] = [
  {
    label: "All drafts",
    to: `${B}/list`,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <path d="M14 3v5h5M9 13h6M9 17h4" />
      </svg>
    ),
    section: appName("all-drafts"),
  },
];

function AllDraftsLayout() {
  const { user, role } = useSession();
  return (
    <AppShell
      nav={NAV}
      role={role}
      user={{ name: user.name, designation: user.designation, color: user.avatarColor, roleLabel: roleLabel(role) }}
      notifications={[]}
    />
  );
}

export default function AllDraftsApp() {
  return (
    <Routes>
      <Route element={<AllDraftsLayout />}>
        <Route index element={<Navigate to="list" replace />} />
        <Route path="list" element={<AllDrafts />} />
        <Route path="*" element={<Navigate to="list" replace />} />
      </Route>
    </Routes>
  );
}
