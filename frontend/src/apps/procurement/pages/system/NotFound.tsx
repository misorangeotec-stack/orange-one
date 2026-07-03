import EmptyState from "@/shared/components/ui/EmptyState";

/** Fallback for an unknown procurement route. */
export default function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      message="This procurement screen doesn't exist or has moved."
      actionLabel="Back to Procurement"
      actionTo="/procurement"
    />
  );
}
