import { Link } from "react-router-dom";

/** Shown when a user's role isn't permitted to view a Purchase FMS screen. */
export default function AccessDenied() {
  return (
    <div className="flex flex-col items-center text-center px-6 py-20">
      <div className="w-12 h-12 rounded-card bg-orange-soft text-orange flex items-center justify-center mb-4">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
      </div>
      <h2 className="text-[18px] font-bold text-navy">Access denied</h2>
      <p className="text-[13px] text-grey-2 mt-1 max-w-xs">You don't have permission to view this page.</p>
      <Link to="/purchase-fms" className="mt-4 text-[13px] font-semibold text-orange hover:underline">Back to dashboard</Link>
    </div>
  );
}
