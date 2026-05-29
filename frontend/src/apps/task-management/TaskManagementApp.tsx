import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import Button from "@/shared/components/ui/Button";

/**
 * Root of the Task Management app. Owns all routing under /task-management.
 * Phase 1: a themed placeholder so navigation works end-to-end.
 * Phase 2+: replaced by the AppShell (sidebar + topbar) wrapping the real screens
 * (Dashboard, Tasks, Reports, Setup, ...) — all built inside this app folder.
 */
function Placeholder() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-page-grad flex items-center justify-center px-6">
      <div className="bg-white rounded-card-lg shadow-card border border-line max-w-md w-full p-10 text-center">
        <div className="mx-auto mb-5 w-14 h-14 rounded-card bg-orange-soft text-navy flex items-center justify-center">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="4" width="14" height="17" rx="2" />
            <path d="M9 4.5V3.5h6v1" />
            <path d="M8.5 12l2.1 2.1L15.5 9.5" stroke="#FF6A1F" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-navy">Task Management</h1>
        <p className="text-grey mt-3 leading-relaxed">
          The app shell and screens land in the next phase. Navigation and the module
          structure are wired and ready.
        </p>
        <Button variant="outline" className="mt-7" onClick={() => navigate("/home")}>
          ← Back to Workspace
        </Button>
      </div>
    </div>
  );
}

export default function TaskManagementApp() {
  return (
    <Routes>
      <Route index element={<Placeholder />} />
      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  );
}
