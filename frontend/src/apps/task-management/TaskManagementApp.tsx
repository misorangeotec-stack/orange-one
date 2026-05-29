import { Routes, Route, Navigate } from "react-router-dom";
import { MockSessionProvider } from "./mock/session";
import TaskLayout from "./TaskLayout";
import Dashboard from "./pages/Dashboard";
import ComingSoon from "./pages/ComingSoon";

/**
 * Root of the Task Management app. Owns all routing under /task-management.
 * The shell (sidebar + topbar) wraps every screen via the TaskLayout layout route.
 * Screens marked ComingSoon are built in subsequent phases — nav already links them.
 */
export default function TaskManagementApp() {
  return (
    <MockSessionProvider>
      <Routes>
        <Route element={<TaskLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="tasks" element={<ComingSoon name="My Tasks" phase="Phase 3" />} />
          <Route path="tasks/new" element={<ComingSoon name="Create Task" phase="Phase 3" />} />
          <Route path="tasks/:id" element={<ComingSoon name="Task Detail" phase="Phase 3" />} />
          <Route path="team" element={<ComingSoon name="Team Tasks" phase="Phase 4" />} />
          <Route path="all" element={<ComingSoon name="All Tasks" phase="Phase 4" />} />
          <Route path="recurring" element={<ComingSoon name="Recurring Tasks" phase="Phase 5" />} />
          <Route path="reports" element={<ComingSoon name="Reports" phase="Phase 6" />} />
          <Route path="history" element={<ComingSoon name="Activity History" phase="Phase 6" />} />
          <Route path="setup" element={<ComingSoon name="Admin Setup" phase="Phase 7" />} />
          <Route path="settings" element={<ComingSoon name="Settings" phase="Phase 8" />} />
        </Route>
        <Route path="*" element={<Navigate to="/task-management" replace />} />
      </Routes>
    </MockSessionProvider>
  );
}
