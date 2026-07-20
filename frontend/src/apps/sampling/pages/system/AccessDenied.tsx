import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";

export default function AccessDenied() {
  return (
    <Card className="max-w-lg mx-auto mt-10 p-8 text-center">
      <h1 className="text-[20px] font-bold text-navy">Access denied</h1>
      <p className="text-[13.5px] text-grey-2 mt-2">
        You don't have access to this screen. If you think this is a mistake, ask an admin to grant you the right role.
      </p>
      <Link to="/sampling" className="mt-5 inline-block text-[13px] font-semibold text-orange hover:underline">
        Back to the dashboard
      </Link>
    </Card>
  );
}
