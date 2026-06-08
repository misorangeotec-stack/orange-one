import { Routes, Route, Navigate } from "react-router-dom";
import { FmsStoreProvider } from "./mock/store";
import FmsLayout from "./FmsLayout";
import RequireRole from "./components/RequireRole";
import Dashboard from "./pages/Dashboard";
import EntriesList from "./pages/EntriesList";
import MyQueue from "./pages/MyQueue";
import NewOrder from "./pages/NewOrder";
import EntryDetail from "./pages/EntryDetail";
import Reports from "./pages/Reports";
import SettingsLayout from "./pages/settings/SettingsLayout";
import WorkflowSetup from "./pages/settings/WorkflowSetup";
import Designations from "./pages/settings/Designations";
import Categories from "./pages/settings/Categories";
import NotFound from "./pages/system/NotFound";

/**
 * Root of the Purchase FMS app. Owns all routing under /purchase-fms. The session
 * lives in the portal core; this mounts the (mock) FMS store beneath it. Settings
 * are admin-only.
 */
export default function PurchaseFmsApp() {
  return (
    <FmsStoreProvider>
      <Routes>
        <Route element={<FmsLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="queue" element={<MyQueue />} />
          <Route path="entries" element={<EntriesList />} />
          <Route path="entries/new" element={<NewOrder />} />
          <Route path="entries/:id" element={<EntryDetail />} />

          <Route path="reports" element={<RequireRole roles={["admin", "hod", "sub_hod"]}><Reports /></RequireRole>} />

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
