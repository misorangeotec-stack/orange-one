/**
 * Status pill for an onboarding request. Hub-native tokens only.
 *
 * Colour carries meaning: amber = someone owes work, emerald = done, red =
 * refused, slate = parked or not started. A reader should be able to scan a
 * column of these and see where the pipeline is stuck without reading a word.
 */
import { Badge } from "@hub/components/ui/badge";
import { cn } from "@hub/lib/utils";
import { statusLabel } from "@hub/lib/customerOnboarding/format";
import type { CustomerStatus } from "@hub/lib/customerOnboarding/types";

const TONE: Record<CustomerStatus, string> = {
  draft:              "bg-muted text-muted-foreground border-transparent",
  pending_accounts:   "bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-900",
  pending_sales_head: "bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-900",
  pending_director:   "bg-orange-100 text-orange-900 border-orange-200 dark:bg-orange-950 dark:text-orange-200 dark:border-orange-900",
  pending_tally:      "bg-sky-100 text-sky-900 border-sky-200 dark:bg-sky-950 dark:text-sky-200 dark:border-sky-900",
  completed:          "bg-emerald-100 text-emerald-900 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-900",
  rejected:           "bg-destructive/10 text-destructive border-destructive/30",
  rework:             "bg-rose-100 text-rose-900 border-rose-200 dark:bg-rose-950 dark:text-rose-200 dark:border-rose-900",
  on_hold:            "bg-slate-200 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700",
  cancelled:          "bg-muted text-muted-foreground border-transparent line-through",
};

export default function StatusBadge({
  status, className,
}: { status: CustomerStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn("font-medium whitespace-nowrap", TONE[status], className)}>
      {statusLabel(status)}
    </Badge>
  );
}
