import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";

export default function NotFound() {
  return (
    <Card className="max-w-lg mx-auto mt-10 p-8 text-center">
      <h1 className="text-[18px] font-bold text-navy">Page not found</h1>
      <Link to="/production-entry" className="mt-3 inline-block text-[13px] font-semibold text-orange hover:underline">Back to dashboard</Link>
    </Card>
  );
}
