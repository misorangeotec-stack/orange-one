import EmptyState from "@/shared/components/ui/EmptyState";

/** Fallback for an unknown HR Recruitment route. */
export default function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      message="This HR Recruitment screen doesn't exist or has moved."
      actionLabel="Back to HR Recruitment"
      actionTo="/hr-recruitment"
    />
  );
}
