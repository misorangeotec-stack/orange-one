import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@hub/components/ui/dialog";
import { Button } from "@hub/components/ui/button";
import { Textarea } from "@hub/components/ui/textarea";
import { Input } from "@hub/components/ui/input";
import { Label } from "@hub/components/ui/label";
import { useToast } from "@hub/hooks/use-toast";
import { fmtINRMoney, formatDateDMY } from "@hub/lib/utils";
import { monthStartISO, monthEndISO } from "@hub/lib/months";
import type { UseCollectionPlan } from "@hub/lib/useCollectionPlan";

/**
 * Set or revise the planned collection for ONE customer in ONE month.
 *
 * Unlike FollowupModal this takes its context as PROPS rather than reading a hook: Due and
 * Received for the selected month are computed by the report page's `metricsForMonth`, which no
 * hook can reach. The hook only supplies the plan itself.
 *
 * A plan is a SHARED cell — one row per (month, customer) that anyone may revise — so when a plan
 * already exists the dialog names who last touched it. Clearing the amount deletes the row, which
 * is what keeps "unplanned" and "planned nothing" from being the same state.
 */

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Trend month label, e.g. "Aug-26". */
  month: string;
  /** The consolidated customer name — the plan's entity key. */
  entityName: string;
  /** True when `month` is the current (as-of) month; drives the closed-month hint. */
  isCurrentMonth: boolean;
  /** Context for this customer in this month, from the page's metrics. */
  dueThisMonth: number;
  receivedThisMonth: number;
  outstanding: number;
  salesperson: string | null;
  /** True when the customer name spans more than one ledger — the plan covers all of them. */
  multiLedger: boolean;
  plans: UseCollectionPlan;
}

export function CollectionPlanModal({
  open, onOpenChange, month, entityName, isCurrentMonth,
  dueThisMonth, receivedThisMonth, outstanding, salesperson, multiLedger, plans,
}: Props) {
  const { toast } = useToast();
  const existing = plans.planFor(month, "customer", entityName);

  const [amount, setAmount] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset/prefill whenever the dialog opens (or the entity/month behind it changes).
  useEffect(() => {
    if (!open) return;
    setAmount(existing?.plannedAmount ? String(existing.plannedAmount) : "");
    setExpectedDate(existing?.expectedDate ?? "");
    setNote(existing?.note ?? "");
    setError(null);
    setSaving(false);
    // `existing` is intentionally not a dep: re-running on a background refetch would discard
    // whatever the user has typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, month, entityName]);

  const parsed = amount.trim() === "" ? 0 : Number(amount);
  const clearing = amount.trim() === "" || parsed === 0;

  const handleSave = async () => {
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError("Planned amount must be a positive number.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // A zero/blank amount deletes the row (handled in collectionPlanApi), so "no plan" stays a
      // single unambiguous state rather than a stored 0.
      await plans.save({
        month,
        entityType: "customer",
        entityName,
        plannedAmount: parsed,
        expectedDate: expectedDate || null,
        note: note.trim() || null,
        // Frozen context — the figures as they stood when this plan was set.
        salesperson,
        dueAtPlan: dueThisMonth,
        outstandingAtPlan: outstanding,
      });
      toast({
        title: clearing ? "Plan cleared" : existing ? "Plan updated" : "Plan set",
        description: clearing
          ? `${entityName} has no plan for ${month}.`
          : `${fmtINRMoney(parsed)} planned for ${entityName} in ${month}.`,
      });
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save the plan.";
      setError(msg);
      toast({ variant: "destructive", title: "Save failed", description: msg });
    } finally {
      setSaving(false);
    }
  };

  const gap = parsed - receivedThisMonth;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">
            {existing ? "Revise plan" : "Plan collection"} — {month}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="font-semibold text-foreground">{entityName}</span>
            {/* The plan is keyed on the customer NAME, but the table lists one row per Tally
                ledger. Say so, or saving from one company's row looks like it should only
                affect that company. */}
            {multiLedger && (
              <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase">
                All companies &amp; locations
              </span>
            )}
            <span className="text-muted-foreground">
              Due {fmtINRMoney(dueThisMonth)} · Received {fmtINRMoney(receivedThisMonth)}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {!isCurrentMonth && (
            <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
              {month} is not the current month. You can still record or correct a plan against it —
              back-filling is useful — but it no longer changes what gets chased.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cp-amt" className="text-xs font-semibold">Planned amount (₹)</Label>
              <Input
                id="cp-amt"
                type="number"
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 250000"
                className="h-9 text-sm"
              />
              <p className="text-[11px] text-muted-foreground">Leave blank to clear the plan.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cp-date" className="text-xs font-semibold">Expected by</Label>
              <Input
                id="cp-date"
                type="date"
                value={expectedDate}
                min={monthStartISO(month)}
                max={monthEndISO(month)}
                onChange={(e) => setExpectedDate(e.target.value)}
                className="h-9 text-sm"
              />
              <p className="text-[11px] text-muted-foreground">Optional — within {month}.</p>
            </div>
          </div>

          {!clearing && (
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
              Against {fmtINRMoney(receivedThisMonth)} already received this month, that leaves a
              gap of{" "}
              <span className={`font-semibold ${gap > 0 ? "text-destructive" : "text-emerald-600"}`}>
                {fmtINRMoney(Math.abs(gap))}
              </span>
              {gap > 0 ? " still to collect." : " already collected beyond plan."}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="cp-note" className="text-xs font-semibold">Note</Label>
            <Textarea
              id="cp-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why this number? e.g. Two bills agreed for release after their GST filing on the 20th."
              rows={3}
              className="text-sm"
            />
          </div>

          {/* A shared cell: anyone may revise it, so name who last did. */}
          {existing && (
            <p className="text-[11px] text-muted-foreground">
              Last revised by {plans.personName(existing.updatedBy)} on {formatDateDMY(existing.updatedAt.slice(0, 10))}
              {existing.revision > 1 && ` · revision ${existing.revision}`}
            </p>
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
            {clearing ? "Clear plan" : existing ? "Save changes" : "Set plan"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
