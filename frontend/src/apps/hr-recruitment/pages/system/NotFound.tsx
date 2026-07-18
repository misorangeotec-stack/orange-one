import EmptyState from "@/shared/components/ui/EmptyState";
import { appName } from "@/apps/appInfo";

/** Fallback for an unknown HR Recruitment route. */
export default function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      message={`This ${appName("hr-recruitment")} screen doesn't exist or has moved.`}
      actionLabel={`Back to ${appName("hr-recruitment")}`}
      actionTo="/hr-recruitment"
    />
  );
}
