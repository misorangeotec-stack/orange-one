import { Routes, Route, Navigate } from "react-router-dom";
import { MockSessionProvider } from "./mock/session";
import { TaskStoreProvider } from "./mock/store";
import TaskLayout from "./TaskLayout";
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
import ComingSoon from "./pages/ComingSoon";

/**
 * Root of the Task Management app. Owns all routing under /task-management.
 * Providers: mock session (current user/role) → task store (live mutations).
 * The shell wraps every screen via the TaskLayout layout route.
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
            <Route path="team" element={<TeamTasks />} />
            <Route path="all" element={<AllTasks />} />
            <Route path="recurring" element={<RecurringList />} />
            <Route path="recurring/new" element={<RecurringForm />} />
            <Route path="recurring/:id/edit" element={<RecurringForm />} />
            <Route path="reports" element={<Reports />} />
            <Route path="history" element={<ActivityHistory />} />
            <Route path="setup" element={<SetupLayout />}>
              <Route index element={<Onboarding />} />
              <Route path="departments" element={<Departments />} />
              <Route path="users" element={<Users />} />
              <Route path="users/new" element={<UserForm />} />
              <Route path="users/:id/edit" element={<UserForm />} />
              <Route path="hierarchy" element={<Hierarchy />} />
            </Route>
            <Route path="settings" element={<ComingSoon name="Settings" phase="Phase 8" />} />
          </Route>
          <Route path="*" element={<Navigate to="/task-management" replace />} />
        </Routes>
      </TaskStoreProvider>
    </MockSessionProvider>
  );
}
