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
            <Route path="recurring" element={<ComingSoon name="Recurring Tasks" phase="Phase 5" />} />
            <Route path="reports" element={<ComingSoon name="Reports" phase="Phase 6" />} />
            <Route path="history" element={<ComingSoon name="Activity History" phase="Phase 6" />} />
            <Route path="setup" element={<ComingSoon name="Admin Setup" phase="Phase 7" />} />
            <Route path="settings" element={<ComingSoon name="Settings" phase="Phase 8" />} />
          </Route>
          <Route path="*" element={<Navigate to="/task-management" replace />} />
        </Routes>
      </TaskStoreProvider>
    </MockSessionProvider>
  );
}
