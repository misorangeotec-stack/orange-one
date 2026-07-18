import { Routes, Route, Navigate } from "react-router-dom";
import { TaskStoreProvider } from "./mock/store";
import TaskLayout from "./TaskLayout";
import RequireRole from "./components/RequireRole";
import Dashboard from "./pages/Dashboard";
import TasksList from "./pages/TasksList";
import TaggedTasks from "./pages/TaggedTasks";
import Notifications from "./pages/Notifications";
import CreateTask from "./pages/CreateTask";
import TaskDetail from "./pages/TaskDetail";
import TeamTasks from "./pages/TeamTasks";
import AllTasks from "./pages/AllTasks";
import RecurringList from "./pages/RecurringList";
import RecurringForm from "./pages/RecurringForm";
import Reports from "./pages/Reports";
import WeeklyScorecard from "./pages/WeeklyScorecard";
import ActivityHistory from "./pages/ActivityHistory";
import SettingsLayout from "./pages/settings/SettingsLayout";
import Organization from "./pages/settings/Organization";
import Locations from "./pages/settings/Locations";
import Permissions from "./pages/settings/Permissions";
import NotFound from "./pages/system/NotFound";

const MANAGER = ["admin", "hod", "sub_hod"] as const;

/**
 * Root of the Task Management app. Owns all routing under /task-management.
 * Session lives in the portal core (app-wide); this only mounts the task store
 * (live mutations) beneath it. The shell wraps every screen; admin/manager
 * routes are role-guarded.
 */
export default function TaskManagementApp() {
  return (
      <TaskStoreProvider>
        <Routes>
          <Route element={<TaskLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="tasks" element={<TasksList />} />
            <Route path="tagged" element={<TaggedTasks />} />
            {/* Not role-guarded — everyone has notifications. */}
            <Route path="notifications" element={<Notifications />} />
            <Route path="tasks/new" element={<CreateTask />} />
            <Route path="tasks/:id" element={<TaskDetail />} />

            <Route path="team" element={<RequireRole roles={[...MANAGER]}><TeamTasks /></RequireRole>} />
            <Route path="all" element={<RequireRole roles={["admin"]}><AllTasks /></RequireRole>} />

            <Route path="recurring" element={<RequireRole roles={[...MANAGER]}><RecurringList /></RequireRole>} />
            <Route path="recurring/new" element={<RequireRole roles={[...MANAGER]}><RecurringForm /></RequireRole>} />
            <Route path="recurring/:id/edit" element={<RequireRole roles={[...MANAGER]}><RecurringForm /></RequireRole>} />

            <Route path="reports" element={<Reports />} />
            <Route path="scorecard" element={<WeeklyScorecard />} />
            <Route path="history" element={<RequireRole roles={[...MANAGER]}><ActivityHistory /></RequireRole>} />

            {/* User/department/hierarchy setup moved to the portal Admin area (/admin). */}
            <Route path="settings" element={<RequireRole roles={["admin"]}><SettingsLayout /></RequireRole>}>
              <Route index element={<Organization />} />
              <Route path="locations" element={<Locations />} />
              <Route path="permissions" element={<Permissions />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Route>
          <Route path="*" element={<Navigate to="/task-management" replace />} />
        </Routes>
      </TaskStoreProvider>
  );
}
