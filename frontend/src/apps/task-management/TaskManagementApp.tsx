import { Routes, Route, Navigate } from "react-router-dom";
import { MockSessionProvider } from "./mock/session";
import { TaskStoreProvider } from "./mock/store";
import TaskLayout from "./TaskLayout";
import RequireRole from "./components/RequireRole";
import Dashboard from "./pages/Dashboard";
import TasksList from "./pages/TasksList";
import CreateTask from "./pages/CreateTask";
import TaskDetail from "./pages/TaskDetail";
import TeamTasks from "./pages/TeamTasks";
import AllTasks from "./pages/AllTasks";
import RecurringList from "./pages/RecurringList";
import RecurringForm from "./pages/RecurringForm";
import Reports from "./pages/Reports";
import ActivityHistory from "./pages/ActivityHistory";
import SetupLayout from "./pages/setup/SetupLayout";
import Onboarding from "./pages/setup/Onboarding";
import Departments from "./pages/setup/Departments";
import Users from "./pages/setup/Users";
import UserForm from "./pages/setup/UserForm";
import Hierarchy from "./pages/setup/Hierarchy";
import SettingsLayout from "./pages/settings/SettingsLayout";
import Profile from "./pages/settings/Profile";
import Organization from "./pages/settings/Organization";
import Permissions from "./pages/settings/Permissions";
import NotFound from "./pages/system/NotFound";

const MANAGER = ["admin", "hod", "sub_hod"] as const;

/**
 * Root of the Task Management app. Owns all routing under /task-management.
 * Providers: mock session (current user/role) → task store (live mutations).
 * The shell wraps every screen; admin/manager routes are role-guarded.
 */
export default function TaskManagementApp() {
  return (
    <MockSessionProvider>
      <TaskStoreProvider>
        <Routes>
          <Route element={<TaskLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="tasks" element={<TasksList />} />
            <Route path="tasks/new" element={<CreateTask />} />
            <Route path="tasks/:id" element={<TaskDetail />} />

            <Route path="team" element={<RequireRole roles={[...MANAGER]}><TeamTasks /></RequireRole>} />
            <Route path="all" element={<RequireRole roles={["admin"]}><AllTasks /></RequireRole>} />

            <Route path="recurring" element={<RequireRole roles={[...MANAGER]}><RecurringList /></RequireRole>} />
            <Route path="recurring/new" element={<RequireRole roles={[...MANAGER]}><RecurringForm /></RequireRole>} />
            <Route path="recurring/:id/edit" element={<RequireRole roles={[...MANAGER]}><RecurringForm /></RequireRole>} />

            <Route path="reports" element={<Reports />} />
            <Route path="history" element={<RequireRole roles={[...MANAGER]}><ActivityHistory /></RequireRole>} />

            <Route path="setup" element={<RequireRole roles={["admin"]}><SetupLayout /></RequireRole>}>
              <Route index element={<Onboarding />} />
              <Route path="departments" element={<Departments />} />
              <Route path="users" element={<Users />} />
              <Route path="users/new" element={<UserForm />} />
              <Route path="users/:id/edit" element={<UserForm />} />
              <Route path="hierarchy" element={<Hierarchy />} />
            </Route>

            <Route path="settings" element={<SettingsLayout />}>
              <Route index element={<Profile />} />
              <Route path="organization" element={<RequireRole roles={["admin"]}><Organization /></RequireRole>} />
              <Route path="permissions" element={<RequireRole roles={["admin"]}><Permissions /></RequireRole>} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Route>
          <Route path="*" element={<Navigate to="/task-management" replace />} />
        </Routes>
      </TaskStoreProvider>
    </MockSessionProvider>
  );
}
