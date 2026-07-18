import EmptyState from "@/shared/components/ui/EmptyState";
import { appName } from "@/apps/appInfo";

/**
 * Placeholder behind the two ungated nav items ("Raise an Exit / Resign", "My
 * Resignation"). Those items must be visible to every employee from day one — that
 * is the whole reason this app is `universal` — but the case screens they lead to
 * arrive with the case table in Phase 2. Better an honest "not yet" than a nav entry
 * that lands on "page not found".
 */
export default function ComingSoon({ what }: { what: string }) {
  return (
    <EmptyState
      title={`${what} is not open yet`}
      message="The exit process is being brought into the portal. Until it is, raise your resignation with HR directly — this screen will take over shortly."
      actionLabel={`Back to ${appName("hr-exit")}`}
      actionTo="/hr-exit"
      icon={
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      }
    />
  );
}
