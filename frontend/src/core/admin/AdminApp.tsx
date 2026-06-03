import { Routes, Route, Navigate } from "react-router-dom";
import AdminLayout from "./AdminLayout";
import Onboarding from "./Onboarding";
import Departments from "./Departments";
import Users from "./Users";
import UserForm from "./UserForm";
import Hierarchy from "./Hierarchy";
import ModuleAccess from "./ModuleAccess";
import Backup from "./Backup";

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
        <Route path="departments" element={<Departments />} />
        <Route path="users" element={<Users />} />
        <Route path="users/new" element={<UserForm />} />
        <Route path="users/:id/edit" element={<UserForm />} />
        <Route path="hierarchy" element={<Hierarchy />} />
        <Route path="access" element={<ModuleAccess />} />
        <Route path="backup" element={<Backup />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
    </Routes>
  );
}
