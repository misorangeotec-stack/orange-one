import { UserX } from "lucide-react";

/**
 * What a scoped report shows when the viewer's salespeople own no customers at all.
 *
 * This is the visible half of the empty-scope rule (see lib/scopeParties.ts). The dangerous
 * alternative is not an ugly screen — it is a report that quietly falls back to company-wide
 * figures because an empty filter array was read as "no filter". So this panel exists to give
 * every scoped report somewhere safe to land, and to say WHY it is empty: an unexplained blank
 * report gets reported as a bug, and the usual "fix" for that bug is to remove the filter.
 *
 * The most common real cause is not an empty territory but a tag mismatch — the salesperson
 * name on the user's profile is matched exactly and case-sensitively against
 * ext_ledger_tags.salesperson, so "Others" and "OTHERS" are different people.
 */
export default function NothingInScope({ label = "report" }: { label?: string }) {
  return (
    <div className="p-6">
      <div className="rounded-lg border border-border bg-surface px-4 py-12 text-center">
        <UserX className="mx-auto h-6 w-6 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium text-foreground">
          No customers are assigned to your salespeople.
        </p>
        <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
          This {label} is filtered to the salespeople on your profile, and none of them currently
          has a customer tagged to them. Ask an administrator to check your salesperson access, or
          the salesperson tags in Settings → Masters.
        </p>
      </div>
    </div>
  );
}
