import EmptyState from "@/shared/components/ui/EmptyState";

/** Fallback for an unknown HR Exit route. */
export default function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      message="This HR Exit screen doesn't exist or has moved."
      actionLabel="Back to HR Exit"
      actionTo="/hr-exit"
    />
  );
}
