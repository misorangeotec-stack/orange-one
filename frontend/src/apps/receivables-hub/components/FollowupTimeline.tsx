import { useState } from "react";
import { CalendarClock, HandCoins, Pencil, Trash2, MessageSquareOff } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { useToast } from "@hub/hooks/use-toast";
import { useFollowups, followupsForEntity } from "@hub/lib/useFollowups";
import { FollowupModal } from "@hub/components/FollowupModal";
import { formatDateDMY, formatDateTimeDMY, fmtINRMoney } from "@hub/lib/utils";
import {
  dueBucketFor, outcomeBadgeClass, outcomeLabel,
  type Followup, type FollowupEntityType,
} from "@hub/lib/followupTypes";

/**
 * Reverse-chronological history of every follow-up on one customer or group.
 *
 * On a GROUP it also merges in entries logged against the group's child customers (tagged
 * with the child name), so opening the parent never hides a conversation recorded one level
 * down. Own entries (and, for admins, any entry) can be corrected or removed.
 */

interface Props {
  entityType: FollowupEntityType;
  entityName: string;
  /** For a group: its child customer names, so their entries roll up into this timeline. */
  childNames?: string[];
}

export function FollowupTimeline({ entityType, entityName, childNames = [] }: Props) {
  const { byEntity, personName, canModify, remove } = useFollowups();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Followup | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const entries = followupsForEntity(byEntity, entityType, entityName, childNames);

  const handleDelete = async (f: Followup) => {
    if (!window.confirm("Delete this follow-up? The remark and its history will be removed.")) return;
    setDeletingId(f.id);
    try {
      await remove(f.id);
      toast({ title: "Follow-up deleted" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not delete",
        description: e instanceof Error ? e.message : "Please try again.",
      });
    } finally {
      setDeletingId(null);
    }
  };

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border py-10 text-center">
        <MessageSquareOff className="h-6 w-6 text-muted-foreground/60" />
        <p className="text-sm font-medium text-foreground">No follow-ups logged yet</p>
        <p className="text-xs text-muted-foreground">
          Record what was discussed on your next payment call, and set a date to chase again.
        </p>
      </div>
    );
  }

  return (
    <>
      <ol className="space-y-3">
        {entries.map((f) => {
          // On a group timeline, an entry logged against a child customer is labelled with it.
          const fromChild = entityType === "group" && f.entityType === "customer" && f.entityName !== entityName;
          return (
            <li
              key={f.id}
              className="rounded-md border border-border bg-surface p-3 shadow-sm"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span
                  className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${outcomeBadgeClass(f.outcome)}`}
                >
                  {outcomeLabel(f.outcome)}
                </span>
                <span className="font-semibold text-foreground">{personName(f.createdBy)}</span>
                <span className="text-muted-foreground">{formatDateTimeDMY(f.createdAt)}</span>
                {fromChild && (
                  <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    on {f.entityName}
                  </span>
                )}
                {canModify(f) && (
                  <span className="ml-auto flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      title="Edit this follow-up"
                      onClick={() => setEditing(f)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-red-600 hover:text-red-700"
                      title="Delete this follow-up"
                      disabled={deletingId === f.id}
                      onClick={() => handleDelete(f)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </span>
                )}
              </div>

              <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{f.remarks}</p>

              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                {f.nextFollowupDate && (
                  <span className="inline-flex items-center gap-1">
                    <CalendarClock className="h-3 w-3" />
                    Next follow-up{" "}
                    <span
                      className={`font-semibold ${
                        dueBucketFor(f.nextFollowupDate) === "overdue"
                          ? "text-red-600"
                          : dueBucketFor(f.nextFollowupDate) === "today"
                            ? "text-amber-600"
                            : "text-foreground"
                      }`}
                    >
                      {formatDateDMY(f.nextFollowupDate)}
                    </span>
                  </span>
                )}
                {f.promisedAmount != null && (
                  <span className="inline-flex items-center gap-1 text-emerald-700">
                    <HandCoins className="h-3 w-3" />
                    Promised {fmtINRMoney(f.promisedAmount)}
                    {f.promisedDate && ` by ${formatDateDMY(f.promisedDate)}`}
                  </span>
                )}
                {f.outstandingAtEntry != null && (
                  <span title="The customer's outstanding when this follow-up was logged">
                    Outstanding then: {fmtINRMoney(f.outstandingAtEntry)}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {editing && (
        <FollowupModal
          open={!!editing}
          onOpenChange={(o) => !o && setEditing(null)}
          entityType={editing.entityType}
          entityName={editing.entityName}
          editing={editing}
        />
      )}
    </>
  );
}
