/**
 * Step 8c — Director approval.
 *
 * Only reached when the sales head's approval froze `dir_required = true`. There
 * is nothing to fill in beyond a decision and a reason: the Director is
 * ratifying an exposure, not adding data. So the panel's real job is to put the
 * whole credit picture on one card — the ask, the recommendation, the grade, and
 * WHY this landed on their desk.
 */
import { useState } from "react";
import { Gavel } from "lucide-react";
import { Input } from "@hub/components/ui/input";
import { Textarea } from "@hub/components/ui/textarea";
import { useToast } from "@hub/hooks/use-toast";
import {
  CorrectionBar, DecisionBar, PanelField, StepActionPanel, type PanelDecision,
} from "./StepActionPanel";
import { useCustomerAction, useCustomerStore } from "@hub/lib/customerOnboarding/store";
import { customerTypeLabel, inr, paymentTermsLabel, requestSubject, securityLabel } from "@hub/lib/customerOnboarding/format";
import { localDateIso } from "@/shared/lib/workingDays";
import type { CustomerRequest } from "@hub/lib/customerOnboarding/types";

export default function DirectorPanel({
  request, mode = "decide", onDone,
}: {
  request: CustomerRequest;
  /** `edit` corrects the remarks and date. The decision itself is not editable. */
  mode?: "decide" | "edit";
  onDone?: () => void;
}) {
  const r = request;
  const s = useCustomerStore();
  const run = useCustomerAction();
  const { toast } = useToast();

  const [date, setDate] = useState(r.dirDecidedDate ?? localDateIso(new Date()));
  const [remarks, setRemarks] = useState(r.dirRemarks ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (d: PanelDecision) => {
    setBusy(true);
    setError(null);
    try {
      await run(() =>
        s.writes.decideDirector(r.id, {
          decision: d === "go" ? "approve" : d,
          remarks,
          decidedDate: date,
        }),
      );
      toast({
        title:
          d === "go" ? "Approved — ready for the Tally ledger"
          : d === "reject" ? "Request rejected"
          : "Sent back to the person who raised it",
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const correct = async () => {
    setBusy(true);
    setError(null);
    try {
      await run(() => s.writes.updateDirector(r.id, { remarks, decidedDate: date }));
      toast({ title: "Director's record corrected" });
      onDone?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepActionPanel
      title={mode === "edit" ? "Correct the director's record" : "Director approval"}
      blurb={
        mode === "edit"
          ? "Fix the remarks or the date. The decision itself stands — reversing it is a reject or a reopen, not a correction."
          : r.dirRequiredReason === "forced"
            ? "The sales head asked for your approval on this one."
            : `The recommended limit is above the ${inr(r.dirThresholdAtDecision)} threshold that was in force when the sales head approved.`
      }
      error={error}
      footer={
        mode === "edit" ? (
          <CorrectionBar onSave={() => void correct()} onCancel={onDone} busy={busy} />
        ) : (
          <DecisionBar
            goLabel="Approve"
            goIcon={<Gavel className="h-4 w-4" />}
            remarks={remarks}
            onRemarksChange={setRemarks}
            onDecide={decide}
            busy={busy}
            subject={requestSubject(r)}
            remarksLabel="Director's remarks"
          />
        )
      }
    >
      <div className="rounded-md border bg-muted/40 p-4 grid gap-4 sm:grid-cols-3 text-sm">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Requested</div>
          <div className="font-medium">{inr(r.requestedCreditLimit)}</div>
          <div className="text-xs text-muted-foreground">
            {r.requestedCreditDays !== null ? `${r.requestedCreditDays} days` : "no period named"}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Accounts recommend</div>
          <div className="font-medium text-foreground">{inr(r.accRecommendedLimit)}</div>
          <div className="text-xs text-muted-foreground">
            {r.accRecommendedDays !== null ? `${r.accRecommendedDays} days` : "no period recommended"}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Grade</div>
          <div className="font-medium">{r.shCustomerCategory ?? "—"}</div>
          <div className="text-xs text-muted-foreground">by {s.personName(r.shDecidedBy)}</div>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Terms</div>
          <div className="font-medium">{paymentTermsLabel(r.paymentTerms)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Security offered</div>
          <div className="font-medium">{securityLabel(r.securityOffered)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Customer</div>
          <div className="font-medium">{customerTypeLabel(r.customerType)}</div>
          <div className="text-xs text-muted-foreground">{[r.city, r.stateName].filter(Boolean).join(", ") || "—"}</div>
        </div>

        {(r.shBusinessPotential || r.accRemarks || r.shRemarks) && (
          <div className="sm:col-span-3 border-t pt-3 space-y-1.5 text-xs text-muted-foreground">
            {r.accRemarks && <p><span className="font-medium text-foreground">Accounts:</span> {r.accRemarks}</p>}
            {r.shRemarks && <p><span className="font-medium text-foreground">Sales head:</span> {r.shRemarks}</p>}
            {r.shBusinessPotential && <p><span className="font-medium text-foreground">Potential:</span> {r.shBusinessPotential}</p>}
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <PanelField id="dir-date" label="Decided on">
          <Input id="dir-date" type="date" value={date} disabled={busy}
                 onChange={(e) => setDate(e.target.value)} />
        </PanelField>
        {mode === "edit" && (
          <PanelField id="dir-decision-readout" label="Decision">
            <Input id="dir-decision-readout" value={r.dirDecision ?? "—"} readOnly disabled
                   className="bg-muted/50 capitalize" />
          </PanelField>
        )}
      </div>

      {mode === "edit" && (
        <PanelField id="dir-remarks-edit" label="Director's remarks">
          <Textarea
            id="dir-remarks-edit" rows={3} value={remarks} disabled={busy}
            onChange={(e) => setRemarks(e.target.value)}
          />
        </PanelField>
      )}
    </StepActionPanel>
  );
}
