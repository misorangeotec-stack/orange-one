import { useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";

/** In-app 404 for unknown task-management routes. */
export default function NotFound() {
  const navigate = useNavigate();
  return (
    <Card className="p-12 text-center max-w-md mx-auto mt-6">
      <div className="mx-auto mb-4 text-orange font-bold text-[44px] leading-none">404</div>
      <h2 className="text-xl font-bold text-navy">Page not found</h2>
      <p className="text-grey mt-2 text-sm max-w-sm mx-auto leading-relaxed">
        The page you're looking for doesn't exist or may have moved.
      </p>
      <Button variant="outline" className="mt-7" onClick={() => navigate("/task-management")}>
        ← Back to Dashboard
      </Button>
    </Card>
  );
}
