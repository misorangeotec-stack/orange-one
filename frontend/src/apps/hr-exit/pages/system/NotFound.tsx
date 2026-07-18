import EmptyState from "@/shared/components/ui/EmptyState";
import { appName } from "@/apps/appInfo";

/** Fallback for an unknown HR Exit route. */
export default function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      message={`This ${appName("hr-exit")} screen doesn't exist or has moved.`}
      actionLabel={`Back to ${appName("hr-exit")}`}
      actionTo="/hr-exit"
    />
  );
}
