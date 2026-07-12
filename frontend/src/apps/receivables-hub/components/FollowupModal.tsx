import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@hub/components/ui/dialog";
import { Button } from "@hub/components/ui/button";
import { Textarea } from "@hub/components/ui/textarea";
import { Input } from "@hub/components/ui/input";
import { Label } from "@hub/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@hub/components/ui/select";
import { useToast } from "@hub/hooks/use-toast";
import { useFollowups } from "@hub/lib/useFollowups";
import { fmtINRMoney } from "@hub/lib/utils";
import {
  OUTCOME_OPTIONS, todayISO,
  type Followup, type FollowupEntityType, type FollowupOutcome,
} from "@hub/lib/followupTypes";

/**
 * The ONE add/edit follow-up dialog. Opened from the Risk Register (the worklist), the
 * Customer/Group Detail page (the case file) and the Follow-ups page, always prefilled with
 * the entity from its context — so the user never has to pick a customer at logging time.
 *
 * On save it stamps the entity's CURRENT outstanding/overdue/salesperson onto the row, so
 * the history still reads true months later when the pipeline has moved those numbers.
 */

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: FollowupEntityType;
  entityName: string;
  /** Pass an existing entry to edit it; omit to log a new one. */
  editing?: Followup | null;
}

export function FollowupModal({ open, onOpenChange, entityType, entityName, editing }: Props) {
  const { add, edit, statsFor } = useFollowups();
  const { toast } = useToast();

  const [remarks, setRemarks] = useState("");
  const [outcome, setOutcome] = useState<FollowupOutcome>("connected");
  const [nextDate, setNextDate] = useState("");
  const [promisedAmount, setPromisedAmount] = useState("");
  const [promisedDate, setPromisedDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset/prefill whenever the dialog opens (or the entity behind it changes).
  useEffect(() => {
    if (!open) return;
    setRemarks(editing?.remarks ?? "");
    setOutcome(editing?.outcome ?? "connected");
    setNextDate(editing?.nextFollowupDate ?? "");
    setPromisedAmount(editing?.promisedAmount != null ? String(editing.promisedAmount) : "");
    setPromisedDate(editing?.promisedDate ?? "");
    setError(null);
    setSaving(false);
  }, [open, editing, entityType, entityName]);

  const stats = statsFor(entityType, entityName);
  const showPromise = outcome === "promised_payment";

  const handleSave = async () => {
    const text = remarks.trim();
    if (!text) {
      setError("Please enter a remark describing the discussion.");
      return;
    }
    const amount = promisedAmount.trim() ? Number(promisedAmount) : null;
    if (amount != null && (!Number.isFinite(amount) || amount < 0)) {
      setError("Promised amount must be a positive number.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await edit(editing.id, {
          remarks: text,
          outcome,
          nextFollowupDate: nextDate || null,
          promisedAmount: showPromise ? amount : null,
          promisedDate: showPromise ? promisedDate || null : null,
        });
        toast({ title: "Follow-up updated" });
      } else {
        await add({
          entityType,
          entityName,
          remarks: text,
          outcome,
          nextFollowupDate: nextDate || null,
          promisedAmount: showPromise ? amount : null,
          promisedDate: showPromise ? promisedDate || null : null,
          // Frozen context — the figures as they stood when this conversation happened.
          outstandingAtEntry: stats.outstanding,
          overdueAtEntry: stats.overdue,
          salesperson: stats.salesperson,
        });
        toast({
          title: "Follow-up logged",
          description: nextDate ? `Next follow-up set for ${nextDate}.` : "No further follow-up scheduled.",
        });
      }
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save the follow-up.";
      setError(msg);
      toast({ variant: "destructive", title: "Save failed", description: msg });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">
            {editing ? "Edit follow-up" : "Log follow-up"}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="font-semibold text-foreground">{entityName}</span>
            {entityType === "group" && (
              <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase">
                Group
              </span>
            )}
            <span className="text-muted-foreground">
              Outstanding {fmtINRMoney(stats.outstanding)} · Overdue {fmtINRMoney(stats.overdue)}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="fu-remarks" className="text-xs font-semibold">
              Remarks <span className="text-red-600">*</span>
            </Label>
            <Textarea
              id="fu-remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="What was discussed? e.g. Spoke to Mr. Sharma — says payment held up by a GST mismatch on invoice 1042, will revert Friday."
              rows={4}
              className="text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Outcome</Label>
              <Select value={outcome} onValueChange={(v) => setOutcome(v as FollowupOutcome)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OUTCOME_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-sm">
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="fu-next" className="text-xs font-semibold">Next follow-up date</Label>
              <Input
                id="fu-next"
                type="date"
                value={nextDate}
                min={todayISO()}
                onChange={(e) => setNextDate(e.target.value)}
                className="h-9 text-sm"
              />
              <p className="text-[11px] text-muted-foreground">
                Leave blank if no further follow-up is needed.
              </p>
            </div>
          </div>

          {showPromise && (
            <div className="grid grid-cols-2 gap-3 rounded-md border border-emerald-200 bg-emerald-50/50 p-3">
              <div className="space-y-1.5">
                <Label htmlFor="fu-amt" className="text-xs font-semibold">Promised amount (₹)</Label>
                <Input
                  id="fu-amt"
                  type="number"
                  min={0}
                  value={promisedAmount}
                  onChange={(e) => setPromisedAmount(e.target.value)}
                  placeholder="e.g. 250000"
                  className="h-9 text-sm bg-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fu-pdate" className="text-xs font-semibold">Promised by</Label>
                <Input
                  id="fu-pdate"
                  type="date"
                  value={promisedDate}
                  onChange={(e) => setPromisedDate(e.target.value)}
                  className="h-9 text-sm bg-white"
                />
              </div>
            </div>
          )}

          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {editing ? "Save changes" : "Log follow-up"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
