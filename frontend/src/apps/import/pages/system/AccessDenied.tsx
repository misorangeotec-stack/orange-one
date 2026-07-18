import EmptyState from "@/shared/components/ui/EmptyState";
import { appName } from "@/apps/appInfo";

/** Shown when a user reaches a import route their role can't see. */
export default function AccessDenied() {
  return (
    <EmptyState
      title="Access denied"
      message="You don't have permission to view this screen. If you think this is a mistake, contact an administrator."
      actionLabel={`Back to ${appName("import")}`}
      actionTo="/import"
      icon={
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
      }
    />
  );
}
