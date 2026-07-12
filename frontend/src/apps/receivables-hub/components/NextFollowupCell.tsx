import { Plus } from "lucide-react";
import { formatDateDMY } from "@hub/lib/utils";
import { dueBucketFor, type Followup } from "@hub/lib/followupTypes";

/**
 * The shared "Next Follow-up" table cell, used by the Risk Register and the Follow-ups page.
 *
 * Shows the open next date (the one on the entity's LATEST entry) with an Overdue / Today /
 * Upcoming badge, or a "Log" affordance when nothing is scheduled — so an empty cell is an
 * invitation to act rather than a dead end.
 */

interface Props {
  /** The entity's most recent follow-up, if it has one. */
  latest: Followup | undefined;
  onLog: () => void;
}

const BUCKET_STYLE = {
  overdue: "bg-red-50 text-red-700 border-red-200",
  today: "bg-amber-50 text-amber-700 border-amber-200",
  upcoming: "bg-muted text-muted-foreground border-border",
} as const;

const BUCKET_LABEL = {
  overdue: "Overdue",
  today: "Today",
  upcoming: "",
} as const;

export function NextFollowupCell({ latest, onLog }: Props) {
  const next = latest?.nextFollowupDate;

  if (!next) {
    return (
      <button
        type="button"
        onClick={onLog}
        className="inline-flex items-center gap-1 rounded-button border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-primary"
      >
        <Plus className="h-3 w-3" />
        Log
      </button>
    );
  }

  const bucket = dueBucketFor(next);
  const label = BUCKET_LABEL[bucket];

  return (
    <button
      type="button"
      onClick={onLog}
      title="Log a follow-up"
      className="inline-flex items-center gap-1.5 text-left transition-opacity hover:opacity-70"
    >
      <span className="whitespace-nowrap text-xs font-medium text-foreground">{formatDateDMY(next)}</span>
      {label && (
        <span className={`rounded border px-1 py-0.5 text-[10px] font-semibold uppercase ${BUCKET_STYLE[bucket]}`}>
          {label}
        </span>
      )}
    </button>
  );
}
