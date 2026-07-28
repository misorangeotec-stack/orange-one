/**
 * The Director gate.
 *
 * ⚠ THE THRESHOLD IS COMPARED AGAINST THE ACCOUNTS-RECOMMENDED LIMIT, falling
 *   back to what the customer asked for. Routing on the customer's ask would let
 *   a rep trigger — or dodge — a Director review by typing a different figure.
 *   fms_customer_director_required() is the authority; this screen only sets the
 *   number it compares against.
 *
 * ⚠ CHANGING THIS NEVER REWRITES HISTORY. Each approved request freezes
 *   dir_required, dir_required_reason and the threshold then in force onto its
 *   own row, so a request that went to the Director last month still says why,
 *   with the number that actually applied.
 *
 * A threshold of 0 with both exemptions on is the shipped default: every credit
 * customer with a limit goes to the Director. That is deliberately the strictest
 * setting — loosening it should be a decision someone makes, not one they
 * inherit.
 */
import { useEffect, useState } from "react";
import { Loader2, Save, ShieldCheck } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent } from "@hub/components/ui/card";
import { Checkbox } from "@hub/components/ui/checkbox";
import { Input } from "@hub/components/ui/input";
import { Label } from "@hub/components/ui/label";
import { useToast } from "@hub/hooks/use-toast";
import { useCustomerAction, useCustomerStore } from "@hub/lib/customerOnboarding/store";
import { inr } from "@hub/lib/customerOnboarding/format";

export default function ApprovalRulesSection() {
  const s = useCustomerStore();
  const run = useCustomerAction();
  const { toast } = useToast();
  const rules = s.approvalRules;

  const [threshold, setThreshold] = useState(String(rules.directorThreshold));
  const [exemptAdvance, setExemptAdvance] = useState(rules.exemptAdvanceTerms);
  const [exemptNoLimit, setExemptNoLimit] = useState(rules.exemptWhenNoLimitRequested);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setThreshold(String(rules.directorThreshold));
    setExemptAdvance(rules.exemptAdvanceTerms);
    setExemptNoLimit(rules.exemptWhenNoLimitRequested);
  }, [rules.directorThreshold, rules.exemptAdvanceTerms, rules.exemptWhenNoLimitRequested]);

  const parsed = Number(threshold);
  const valid = Number.isFinite(parsed) && parsed >= 0;
  const dirty =
    parsed !== rules.directorThreshold ||
    exemptAdvance !== rules.exemptAdvanceTerms ||
    exemptNoLimit !== rules.exemptWhenNoLimitRequested;

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await run(() =>
        s.writes.setConfig("approval", {
          director_threshold: parsed,
          exempt_advance_terms: exemptAdvance,
          exempt_when_no_limit_requested: exemptNoLimit,
        }),
      );
      toast({
        title: "Approval rules saved",
        description: "Requests already approved keep the rule that applied to them.",
      });
    } catch (e) {
      toast({ variant: "destructive", title: "Could not save", description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-5 space-y-5">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> When a Director must approve
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Compared against the limit <strong>Accounts recommend</strong>, not the one the
            customer asks for. The sales head can always escalate a request that falls below it.
          </p>
        </div>

        <div className="max-w-xs">
          <Label htmlFor="dir-threshold" className="text-xs font-medium">Credit limit threshold (₹)</Label>
          <Input
            id="dir-threshold"
            inputMode="numeric"
            value={threshold}
            disabled={busy}
            onChange={(e) => setThreshold(e.target.value.replace(/[^\d.]/g, ""))}
            className="mt-1.5 tabular-nums"
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            {valid
              ? parsed === 0
                ? "Every credit customer with a limit goes to the Director."
                : `Anything above ${inr(parsed)} goes to the Director.`
              : "Enter a number."}
          </p>
        </div>

        <div className="space-y-3">
          <label className="flex items-start gap-2.5 cursor-pointer max-w-xl">
            <Checkbox
              checked={exemptAdvance} disabled={busy}
              onCheckedChange={(v) => setExemptAdvance(v === true)}
              className="mt-0.5"
            />
            <span className="text-sm">
              Skip the Director for advance-payment customers
              <span className="block text-xs text-muted-foreground">
                They carry no credit exposure, so the threshold has nothing to measure.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2.5 cursor-pointer max-w-xl">
            <Checkbox
              checked={exemptNoLimit} disabled={busy}
              onCheckedChange={(v) => setExemptNoLimit(v === true)}
              className="mt-0.5"
            />
            <span className="text-sm">
              Skip the Director when no limit was asked for or recommended
              <span className="block text-xs text-muted-foreground">
                Untick to send these to the Director anyway — with a zero threshold that is what
                happens to every request with no figure on it.
              </span>
            </span>
          </label>
        </div>

        <Button size="sm" onClick={() => void save()} disabled={busy || !dirty || !valid} className="gap-1.5">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
        </Button>
      </CardContent>
    </Card>
  );
}
