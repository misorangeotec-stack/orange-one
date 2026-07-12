import { PhoneCall, PlusCircle } from "lucide-react";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@hub/components/ui/tooltip";
import { formatDateDMY } from "@hub/lib/utils";
import { dueBucketFor, type Followup } from "@hub/lib/followupTypes";

/**
 * The per-row follow-up affordance in the Risk Register — the worklist screen where someone
 * scans hundreds of overdue customers deciding who to call. Logging a chase has to be one
 * click on the row you're already reading, not a scroll to a column off the right edge.
 *
 * Two states, deliberately different in prominence:
 *   - A chase is SCHEDULED → the icon is ALWAYS visible and colour-coded by urgency, so
 *     pending follow-ups jump out while scanning the table.
 *   - Nothing scheduled  → a "+" that only appears on row hover, so 700 idle rows stay quiet.
 *
 * Lives inside the (frozen) customer-name cell. The row's own onClick opens the customer in a
 * new tab, so every click here MUST stopPropagation.
 */

interface Props {
  /** The entity's most recent follow-up — its nextFollowupDate is the open one. */
  latest: Followup | undefined;
  onLog: () => void;
}

const BUCKET_TINT = {
  overdue: "text-red-600 hover:text-red-700",
  today: "text-amber-600 hover:text-amber-700",
  upcoming: "text-muted-foreground hover:text-foreground",
} as const;

export function FollowupRowAction({ latest, onLog }: Props) {
  const next = latest?.nextFollowupDate;

  // The row carries `group` (see renderRow), so `group-hover:` reveals the idle "+".
  // focus-visible keeps it reachable by keyboard, where there is no hover.
  const className = next
    ? `ml-1.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors ${BUCKET_TINT[dueBucketFor(next)]}`
    : "ml-1.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-primary focus-visible:opacity-100 group-hover:opacity-100";

  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={next ? "Follow-up scheduled — log another" : "Log follow-up"}
          className={className}
          onClick={(e) => {
            e.stopPropagation();
            onLog();
          }}
        >
          {next ? <PhoneCall className="h-3.5 w-3.5" /> : <PlusCircle className="h-4 w-4" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-[20rem] whitespace-normal break-words p-2 text-xs">
        {next ? (
          <>
            <p className="font-semibold">Next follow-up {formatDateDMY(next)}</p>
            {latest?.remarks && (
              <p className="mt-1 text-muted-foreground">{latest.remarks}</p>
            )}
            <p className="mt-1 text-[10px] text-muted-foreground">Click to log another</p>
          </>
        ) : (
          <p className="font-medium">Log follow-up</p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
