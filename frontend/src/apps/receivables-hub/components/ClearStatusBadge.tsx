import { CheckCircle2, ShieldAlert } from "lucide-react";
import { describeClear, type ClearFields } from "@hub/lib/clearStatus";

/**
 * The clear status of one case, as a cell (RC-12).
 *
 * ⚠ IT IS NOT THE STEWARD "Status" COLUMN. The Muster Editor already has one of those (Verified /
 *   New / Unchecked, from `checked` and `source`), which answers "has a human looked at this row?".
 *   This answers "is the case closed?". They are different questions about the same row, which is
 *   why this column is headed "Clear status" everywhere and never just "Status".
 *
 * The date and the note live in the tooltip rather than the cell: on a 54-row master the column has
 * to stay scannable, and the note runs to a sentence.
 */
export function ClearStatusBadge({ row }: { row: ClearFields }) {
  const title = describeClear(row);
  return row.cleared ? (
    <span
      title={title}
      className="inline-flex items-center gap-1 rounded-full border border-emerald-600/30 bg-emerald-600/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400"
    >
      <CheckCircle2 className="h-3 w-3" /> Cleared
    </span>
  ) : (
    <span
      title={title}
      className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive"
    >
      <ShieldAlert className="h-3 w-3" /> Red Mark
    </span>
  );
}
