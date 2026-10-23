import { Navigate, Route, Routes, Link, useLocation } from "react-router-dom";
import { MrStoreProvider } from "./store";
import MachineResaleLayout from "./MachineResaleLayout";
import Loaded from "./components/Loaded";
import Dashboard from "./pages/Dashboard";
import MachinesList from "./pages/MachinesList";
import MachineForm from "./pages/MachineForm";
import InquiriesList from "./pages/InquiriesList";
import InquiryDetail from "./pages/InquiryDetail";
import Categories from "./pages/Categories";
import PrintHeads from "./pages/PrintHeads";
import Masters from "./pages/Masters";
import FieldVisibility from "./pages/FieldVisibility";
import Settings from "./pages/Settings";
import { B } from "./nav";

/**
 * A new form for every machine URL. Both routes render MachineForm and the shell's
 * Outlet has no key, so without this React keeps one form across "new", a saved
 * machine and "Copy machine": its new-machine id, created flag and edits carried
 * over, and a Copy saved straight over the original machine.
 */
function FreshMachineForm() {
  const loc = useLocation();
  return <MachineForm key={loc.pathname + loc.search} />;
}

function NotFound() {
  return (
    <div className="rounded-xl border border-line bg-white p-6">
      <h1 className="text-[18px] font-bold text-navy">That page does not exist</h1>
      <p className="mt-1 text-[13.5px] text-grey-2">
        <Link to={B} className="font-semibold text-orange hover:underline">
          Back to the dashboard
        </Link>
      </p>
    </div>
  );
}

/**
 * Root of Machine Resale (MR-1C), the admin side of the pre-owned printer website.
 * Mounted per user by App.tsx (RequireModule); what a user may change is decided
 * by the portal pass's level and, authoritatively, by the portal's row rules.
 */
export default function MachineResaleApp() {
  return (
    <MrStoreProvider>
      <Routes>
        <Route element={<MachineResaleLayout />}>
          <Route index element={<Loaded><Dashboard /></Loaded>} />
          <Route path="machines" element={<Loaded><MachinesList /></Loaded>} />
          <Route path="machines/new" element={<Loaded><FreshMachineForm /></Loaded>} />
          <Route path="machines/:id" element={<Loaded><FreshMachineForm /></Loaded>} />
          <Route path="inquiries" element={<Loaded><InquiriesList /></Loaded>} />
          <Route path="inquiries/:key" element={<Loaded><InquiryDetail /></Loaded>} />
          <Route path="categories" element={<Loaded><Categories /></Loaded>} />
          <Route path="print-heads" element={<Loaded><PrintHeads /></Loaded>} />
          <Route path="masters" element={<Loaded><Masters /></Loaded>} />
          <Route path="field-visibility" element={<Loaded><FieldVisibility /></Loaded>} />
          <Route path="settings" element={<Loaded><Settings /></Loaded>} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="*" element={<Navigate to={B} replace />} />
      </Routes>
    </MrStoreProvider>
  );
}
