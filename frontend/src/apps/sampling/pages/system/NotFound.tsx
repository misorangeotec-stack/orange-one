import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";

export default function NotFound() {
  return (
    <Card className="max-w-lg mx-auto mt-10 p-8 text-center">
      <h1 className="text-[20px] font-bold text-navy">Page not found</h1>
      <p className="text-[13.5px] text-grey-2 mt-2">The page you're looking for doesn't exist in this app.</p>
      <Link to="/sampling" className="mt-5 inline-block text-[13px] font-semibold text-orange hover:underline">
        Back to the dashboard
      </Link>
    </Card>
  );
}
