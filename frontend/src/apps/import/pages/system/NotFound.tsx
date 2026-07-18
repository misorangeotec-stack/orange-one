import EmptyState from "@/shared/components/ui/EmptyState";
import { appName } from "@/apps/appInfo";

/** Fallback for an unknown import route. */
export default function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      message={`This ${appName("import")} screen doesn't exist or has moved.`}
      actionLabel={`Back to ${appName("import")}`}
      actionTo="/import"
    />
  );
}
