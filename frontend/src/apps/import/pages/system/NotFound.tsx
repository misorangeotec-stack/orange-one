import EmptyState from "@/shared/components/ui/EmptyState";

/** Fallback for an unknown import route. */
export default function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      message="This import screen doesn't exist or has moved."
      actionLabel="Back to Import"
      actionTo="/import"
    />
  );
}
