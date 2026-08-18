import { Routes, Route, Navigate } from "react-router-dom";
import AdminLayout from "./AdminLayout";
import Onboarding from "./Onboarding";
import Organisation from "./Organisation";
import Users from "./Users";
import UserForm from "./UserForm";
import Hierarchy from "./Hierarchy";
import ModuleAccess from "./ModuleAccess";
import Backup from "./Backup";
import MasterReportSettings from "./MasterReportSettings";
import Masters from "./Masters";
import MastersReconcile from "./MastersReconcile";

/**
 * Portal Admin area (mounted at /admin, admin-guarded in App.tsx). Owns the
 * workspace directory: departments, users, reporting hierarchy, and per-user
 * module access. Reads/writes the shared platform directory (useDirectory).
 */
export default function AdminApp() {
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<Onboarding />} />
        <Route path="organisation" element={<Organisation />} />
        {/* The departments screen became the first tab of Organisation. Kept so
            bookmarks and any link still pointing here land in the right place. */}
        <Route path="departments" element={<Navigate to="/admin/organisation" replace />} />
        <Route path="users" element={<Users />} />
        <Route path="users/new" element={<UserForm />} />
        <Route path="users/:id/edit" element={<UserForm />} />
        <Route path="hierarchy" element={<Hierarchy />} />
        <Route path="access" element={<ModuleAccess />} />
        <Route path="masters" element={<Masters />} />
        <Route path="masters/reconcile" element={<MastersReconcile />} />
        <Route path="backup" element={<Backup />} />
        <Route path="master-report" element={<MasterReportSettings />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
    </Routes>
  );
}
