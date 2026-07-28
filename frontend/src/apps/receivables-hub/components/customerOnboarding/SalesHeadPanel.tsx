/**
 * Step 8b — Sales head approval.
 *
 * Grades the customer (A–E, the hub's live category vocabulary — NOT the source
 * document's A/B/C, or the customer could never be placed on the Category
 * report) and decides whether it goes to the Director.
 *
 * ⚠ THE ESCALATION BOX CAN ONLY ADD A DIRECTOR, NEVER REMOVE ONE.
 *   The server computes `dir_required = threshold_fires OR force_director`, so
 *   when the threshold already fires this box renders TICKED AND DISABLED, with
 *   the threshold named underneath. A control that looks optional but isn't is
 *   worse than no control — the reader has to be told which of the two is
 *   driving it.
 *
 * ⚠ Whatever is decided here is FROZEN onto the row together with the threshold
 *   then in force (`dir_threshold_at_decision`), so retuning the threshold later
 *   can never rewrite why a past request did or did not need a Director.
 */
import { useState } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Checkbox } from "@hub/components/ui/checkbox";
import { Input } from "@hub/components/ui/input";
import { Textarea } from "@hub/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@hub/components/ui/select";
import { useToast } from "@hub/hooks/use-toast";
import {
  CorrectionBar, DecisionBar, PanelField, StepActionPanel, type PanelDecision,
} from "./StepActionPanel";
import { useCustomerAction, useCustomerStore } from "@hub/lib/customerOnboarding/store";
import { inr, requestSubject } from "@hub/lib/customerOnboarding/format";
import { localDateIso } from "@/shared/lib/workingDays";
import { CUSTOMER_CATEGORY_OPTIONS, type CustomerRequest } from "@hub/lib/customerOnboarding/types";

/** What each grade means, so five bare letters are not a guessing game. */
const CATEGORY_HINT: Record<string, string> = {
  A: "Key account — highest volume and reliability",
  B: "Strong, regular buyer",
  C: "Steady but modest",
  D: "Occasional or unproven",
  E: "Marginal — watch the exposure",
};

export default function SalesHeadPanel({
  request, mode = "decide", onDone,
}: {
  request: CustomerRequest;
  /** `edit` corrects the grade and remarks. The routing stays frozen. */
  mode?: "decide" | "edit";
  onDone?: () => void;
}) {
  const r = request;
  const s = useCustomerStore();
  const run = useCustomerAction();
  const { toast } = useToast();

  const [category, setCategory] = useState(r.shCustomerCategory ?? "");
  const [potential, setPotential] = useState(r.shBusinessPotential ?? "");
  const [forceDirector, setForceDirector] = useState(r.shForceDirector);
  const [date, setDate] = useState(r.shDecidedDate ?? localDateIso(new Date()));
  const [remarks, setRemarks] = useState(r.shRemarks ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mirrors fms_customer_director_required(). The server recomputes it — this
  // only drives the caption and the ticked-and-disabled state.
  const byThreshold = s.wouldNeedDirector(r);
  const willEscalate = byThreshold || forceDirector;
  const limit = r.accRecommendedLimit ?? r.requestedCreditLimit;

  const decide = async (d: PanelDecision) => {
    if (d === "go" && !category) {
      setError("Choose a customer category (A–E) before approving.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await run(() =>
        s.writes.decideSalesHead(r.id, {
          customerCategory: category,
          businessPotential: potential,
          decision: d === "go" ? "approve" : d,
          forceDirector,
          remarks,
          decidedDate: date,
        }),
      );
      toast({
        title:
          d === "reject" ? "Request rejected"
          : d === "rework" ? "Sent back to the person who raised it"
          : willEscalate ? "Approved — sent to the Director"
          : "Approved — ready for the Tally ledger",
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const correct = async () => {
    if (r.shDecision === "approve" && !category) {
      setError("An approved customer must carry a grade — choose one before saving.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await run(() =>
        s.writes.updateSalesHead(r.id, {
          customerCategory: category,
          businessPotential: potential,
          remarks,
          decidedDate: date,
        }),
      );
      toast({ title: "Approval corrected" });
      onDone?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepActionPanel
      title={mode === "edit" ? "Correct the sales-head approval" : "Sales head approval"}
      blurb={
        mode === "edit"
          ? "Fix the grade, the potential or the remarks. Where this request was routed is frozen and cannot be changed here."
          : "Grade the customer and approve the credit Accounts have recommended."
      }
      error={error}
      footer={
        mode === "edit" ? (
          <CorrectionBar onSave={() => void correct()} onCancel={onDone} busy={busy} />
        ) : (
          <DecisionBar
            goLabel={willEscalate ? "Approve — send to Director" : "Approve"}
            goIcon={willEscalate ? <ArrowRight className="h-4 w-4" /> : undefined}
            remarks={remarks}
            onRemarksChange={setRemarks}
            onDecide={decide}
            busy={busy}
            subject={requestSubject(r)}
            remarksLabel="Approval remarks"
          />
        )
      }
    >
      {/* What Accounts concluded — the basis of this decision, restated so the
          approver is not scrolling back up to find it. */}
      <div className="rounded-md border bg-muted/40 p-3 grid gap-3 sm:grid-cols-3 text-sm">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Accounts recommend</div>
          <div className="font-medium">{inr(r.accRecommendedLimit)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Credit period</div>
          <div className="font-medium">{r.accRecommendedDays !== null ? `${r.accRecommendedDays} days` : "—"}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Checks</div>
          <div className="font-medium">
            {r.accGstVerified ? "GST ✓" : "GST ✗"} · {r.accRefsVerified ? "References ✓" : "References ✗"}
          </div>
        </div>
        {r.accRemarks && (
          <p className="sm:col-span-3 text-xs text-muted-foreground border-t pt-2">{r.accRemarks}</p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <PanelField
          id="sh-category"
          label="Customer category"
          required
          hint={category ? CATEGORY_HINT[category] : "Required before you can approve"}
        >
          <Select value={category} onValueChange={setCategory} disabled={busy}>
            <SelectTrigger id="sh-category"><SelectValue placeholder="Choose a grade" /></SelectTrigger>
            <SelectContent>
              {CUSTOMER_CATEGORY_OPTIONS.map((c) => (
                <SelectItem key={c} value={c}>{c} — {CATEGORY_HINT[c]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PanelField>

        <PanelField id="sh-date" label="Decided on">
          <Input id="sh-date" type="date" value={date} disabled={busy}
                 onChange={(e) => setDate(e.target.value)} />
        </PanelField>
      </div>

      <PanelField
        id="sh-potential"
        label="Business potential"
        hint="What you expect from this account — read by the Director and kept on the record."
      >
        <Textarea
          id="sh-potential"
          rows={2}
          value={potential}
          disabled={busy}
          onChange={(e) => setPotential(e.target.value)}
          placeholder="e.g. 400–500 kg a month within two quarters, mostly DTF."
        />
      </PanelField>

      {mode === "edit" && (
        <PanelField id="sh-remarks-edit" label="Approval remarks">
          <Textarea
            id="sh-remarks-edit" rows={3} value={remarks} disabled={busy}
            onChange={(e) => setRemarks(e.target.value)}
          />
        </PanelField>
      )}

      {/* The escalation control. Ticked-and-disabled when the threshold already
          fires, because force_director is OR-ed with it server-side and
          un-ticking it would do nothing.

          In edit mode it is a READOUT: dir_required was frozen at the moment of
          approval, so a tickbox here would promise a re-route the server
          correctly refuses. */}
      <div className="rounded-md border p-3">
        <label className={`flex items-start gap-2.5 ${mode === "edit" ? "" : "cursor-pointer"}`}>
          <Checkbox
            checked={mode === "edit" ? r.dirRequired : willEscalate}
            disabled={busy || byThreshold || mode === "edit"}
            onCheckedChange={(v) => setForceDirector(v === true)}
            className="mt-0.5"
          />
          <span className="text-sm min-w-0">
            <span className="font-medium flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Send to the Director
            </span>
            <span className="block text-xs text-muted-foreground mt-0.5">
              {mode === "edit" ? (
                r.dirRequired ? (
                  <>
                    {r.dirRequiredReason === "forced"
                      ? "Escalated by the sales head at the time of approval."
                      : `The limit was above the ${inr(r.dirThresholdAtDecision)} threshold in force at the time of approval.`}
                    {" "}Frozen — correcting this record cannot re-route the request.
                  </>
                ) : (
                  <>No Director was needed. Frozen — correcting this record cannot re-route the request.</>
                )
              ) : byThreshold ? (
                <>
                  Required: {inr(limit)} is above the {inr(s.approvalRules.directorThreshold)} threshold
                  currently in force. This cannot be turned off here.
                </>
              ) : (
                <>
                  Optional. {limit !== null ? `${inr(limit)} is` : "This is"} within the{" "}
                  {inr(s.approvalRules.directorThreshold)} threshold, so no Director is needed —
                  tick this to ask for one anyway.
                </>
              )}
            </span>
          </span>
        </label>
      </div>
    </StepActionPanel>
  );
}
