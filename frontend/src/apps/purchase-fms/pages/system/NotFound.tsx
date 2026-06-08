import { Link } from "react-router-dom";

/** Catch-all for unknown Purchase FMS routes. */
export default function NotFound() {
  return (
    <div className="flex flex-col items-center text-center px-6 py-20">
      <h2 className="text-[18px] font-bold text-navy">Page not found</h2>
      <p className="text-[13px] text-grey-2 mt-1 max-w-xs">The page you're looking for doesn't exist in Purchase FMS.</p>
      <Link to="/purchase-fms" className="mt-4 text-[13px] font-semibold text-orange hover:underline">Back to dashboard</Link>
    </div>
  );
}
