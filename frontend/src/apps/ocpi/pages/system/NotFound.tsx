import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="rounded-xl border border-line bg-white p-6">
      <h1 className="text-[18px] font-bold text-navy">That page does not exist</h1>
      <p className="mt-1 text-[13.5px] text-grey-2">
        <Link to="/ocpi" className="font-semibold text-orange hover:underline">
          Back to the dashboard
        </Link>
      </p>
    </div>
  );
}
