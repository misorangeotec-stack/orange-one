import EmptyState from "@/shared/components/ui/EmptyState";
import { appName } from "@/apps/appInfo";

/** Fallback for an unknown procurement route. */
export default function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      message={`This ${appName("procurement")} screen doesn't exist or has moved.`}
      actionLabel={`Back to ${appName("procurement")}`}
      actionTo="/procurement"
    />
  );
}
