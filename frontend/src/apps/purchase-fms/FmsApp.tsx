import type { ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useSession } from "@/core/platform/session";
import { FmsStoreProvider } from "./mock/store";
import FmsLayout from "./FmsLayout";
import RequireRole from "./components/RequireRole";
import Dashboard from "./pages/Dashboard";
import MyTasks from "./pages/MyTasks";
import EntriesList from "./pages/EntriesList";
import MyQueue from "./pages/MyQueue";
import NewOrder from "./pages/NewOrder";
import EntryDetail from "./pages/EntryDetail";
import Reports from "./pages/Reports";
import TestMode from "./pages/TestMode";
import SettingsLayout from "./pages/settings/SettingsLayout";
import WorkflowSetup from "./pages/settings/WorkflowSetup";
import Designations from "./pages/settings/Designations";
import Categories from "./pages/settings/Categories";
import NotFound from "./pages/system/NotFound";

/** Home branches by role: admins get the full pipeline Dashboard; everyone else
 *  gets the simplified "My Tasks" inbox. */
function Home() {
  const { isAdmin } = useSession();
  return isAdmin ? <Dashboard /> : <MyTasks />;
}

/** Non-admins never see the full pipeline; bounce them back to their inbox. */
function AdminOnlyRoute({ children }: { children: ReactNode }) {
  const { isAdmin } = useSession();
  if (!isAdmin) return <Navigate to="/purchase-fms" replace />;
  return <>{children}</>;
}

/**
 * Root of the Purchase FMS app. Owns all routing under /purchase-fms. The session
 * lives in the portal core; this mounts the (mock) FMS store beneath it. The full
 * 9-stage pipeline screens (Dashboard, My Queue, All Entries, Entry Detail) are
 * admin-only; individual users get the focused My Tasks inbox. Settings are admin-only.
 */
export default function PurchaseFmsApp() {
  return (
    <FmsStoreProvider>
      <Routes>
        <Route element={<FmsLayout />}>
          <Route index element={<Home />} />
          <Route path="queue" element={<AdminOnlyRoute><MyQueue /></AdminOnlyRoute>} />
          <Route path="entries" element={<AdminOnlyRoute><EntriesList /></AdminOnlyRoute>} />
          <Route path="entries/new" element={<NewOrder />} />
          <Route path="entries/:id" element={<AdminOnlyRoute><EntryDetail /></AdminOnlyRoute>} />

          <Route path="reports" element={<RequireRole roles={["admin"]}><Reports /></RequireRole>} />

          <Route path="test" element={<RequireRole roles={["admin"]}><TestMode /></RequireRole>} />

          <Route path="settings" element={<RequireRole roles={["admin"]}><SettingsLayout /></RequireRole>}>
            <Route index element={<WorkflowSetup />} />
            <Route path="designations" element={<Designations />} />
            <Route path="categories" element={<Categories />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="*" element={<Navigate to="/purchase-fms" replace />} />
      </Routes>
    </FmsStoreProvider>
  );
}
