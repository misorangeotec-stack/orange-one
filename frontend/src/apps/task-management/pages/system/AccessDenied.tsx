import { useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";

/** Shown when the current role isn't allowed to view a screen. */
export default function AccessDenied() {
  const navigate = useNavigate();
  return (
    <Card className="p-12 text-center max-w-md mx-auto mt-6">
      <div className="mx-auto mb-5 w-14 h-14 rounded-card bg-[#FDECEA] text-[#d4493f] flex items-center justify-center">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      </div>
      <h2 className="text-xl font-bold text-navy">Access denied</h2>
      <p className="text-grey mt-2 text-sm max-w-sm mx-auto leading-relaxed">
        You don't have permission to view this page with your current role. If you think this is a
        mistake, contact your workspace admin.
      </p>
      <Button variant="outline" className="mt-7" onClick={() => navigate("/task-management")}>
        ← Back to Dashboard
      </Button>
    </Card>
  );
}
