/**
 * Step 8a — Accounts verification.
 *
 * Two tick-boxes and two numbers, but the two numbers are the important part:
 * `acc_recommended_limit` is what the Director threshold routes on, NOT what the
 * customer asked for. Routing on the ask would let a rep trigger — or dodge — a
 * Director review by typing a different figure, so this field is where the
 * business actually decides how much exposure it is considering.
 *
 * The recommendation is PRE-FILLED from the request, because in the common case
 * Accounts agree with it and re-typing an agreed number is pure friction. It is
 * an editable default, not a submission.
 */
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Checkbox } from "@hub/components/ui/checkbox";
import { Input } from "@hub/components/ui/input";
import { Textarea } from "@hub/components/ui/textarea";
import { useToast } from "@hub/hooks/use-toast";
import {
  CorrectionBar, DecisionBar, PanelField, StepActionPanel, type PanelDecision,
} from "./StepActionPanel";
import CompanyChip from "./CompanyChip";
import GstComplianceCard from "./GstComplianceCard";
import { useCustomerAction, useCustomerStore } from "@hub/lib/customerOnboarding/store";
import { inr, requestSubject } from "@hub/lib/customerOnboarding/format";
import { localDateIso } from "@/shared/lib/workingDays";
import type { CustomerRequest } from "@hub/lib/customerOnboarding/types";

export default function AccountsPanel({
  request, mode = "decide", onDone,
}: {
  request: CustomerRequest;
  /** `edit` corrects a verification already recorded — no decision, no routing. */
  mode?: "decide" | "edit";
  onDone?: () => void;
}) {
  const r = request;
  const s = useCustomerStore();
  const run = useCustomerAction();
  const { toast } = useToast();

  const [gstOk, setGstOk] = useState(r.accGstVerified ?? false);
  const [refsOk, setRefsOk] = useState(r.accRefsVerified ?? false);
  const [limit, setLimit] = useState(
    r.accRecommendedLimit !== null ? String(r.accRecommendedLimit)
      : r.requestedCreditLimit !== null ? String(r.requestedCreditLimit) : "",
  );
  const [days, setDays] = useState(
    r.accRecommendedDays !== null ? String(r.accRecommendedDays)
      : r.requestedCreditDays !== null ? String(r.requestedCreditDays) : "",
  );
  const [date, setDate] = useState(r.accVerifiedDate ?? localDateIso(new Date()));
  const [remarks, setRemarks] = useState(r.accRemarks ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // What the Director gate will do with the number currently typed. Recomputed as
  // it is typed so nobody is surprised by an escalation after pressing Forward.
  const preview = { ...r, accRecommendedLimit: limit.trim() === "" ? null : Number(limit) };
  const willEscalate = s.wouldNeedDirector(preview);

  const decide = async (d: PanelDecision) => {
    setBusy(true);
    setError(null);
    try {
      await run(() =>
        s.writes.decideAccounts(r.id, {
          gstVerified: gstOk,
          refsVerified: refsOk,
          recommendedLimit: limit.trim(),
          recommendedDays: days.trim(),
          remarks,
          verifiedDate: date,
          decision: d === "go" ? "forward" : d,
        }),
      );
      toast({
        title:
          d === "go" ? "Verified and sent to the sales head"
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
      await run(() =>
        s.writes.updateAccounts(r.id, {
          gstVerified: gstOk,
          refsVerified: refsOk,
          recommendedLimit: limit.trim(),
          recommendedDays: days.trim(),
          remarks,
          verifiedDate: date,
        }),
      );
      toast({ title: "Verification corrected" });
      onDone?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepActionPanel
      subhead={<CompanyChip companyId={r.companyId} />}
      title={mode === "edit" ? "Correct the accounts verification" : "Accounts verification"}
      blurb={
        mode === "edit"
          ? "Fix what was recorded. The original verifier and timestamp stay on the record; you are logged as the corrector."
          : "Confirm the GST registration and the trade references, then recommend what credit you are comfortable with."
      }
      error={error}
      footer={
        mode === "edit" ? (
          <CorrectionBar onSave={() => void correct()} onCancel={onDone} busy={busy} />
        ) : (
          <DecisionBar
            goLabel="Verified — send to sales head"
            goIcon={<ArrowRight className="h-4 w-4" />}
            remarks={remarks}
            onRemarksChange={setRemarks}
            onDecide={decide}
            busy={busy}
            subject={requestSubject(r)}
            remarksLabel="Verification remarks"
          />
        )
      }
    >
      <div className="space-y-3">
        {/* The evidence for the checkbox immediately below it, frozen when Sales
            raised the request. Renders nothing for requests raised before the
            GSTIN gate shipped, which is most of the backlog. */}
        <GstComplianceCard snapshot={r.gstinSnapshot} compact />

        <label className="flex items-start gap-2.5 cursor-pointer">
          <Checkbox
            checked={gstOk}
            onCheckedChange={(v) => setGstOk(v === true)}
            disabled={busy}
            className="mt-0.5"
          />
          <span className="text-sm">
            GST registration verified
            <span className="block text-xs text-muted-foreground">
              {r.gstNumber ? <>Checked <span className="font-mono">{r.gstNumber}</span> on the GST portal</> : "No GST number on this request"}
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2.5 cursor-pointer">
          <Checkbox
            checked={refsOk}
            onCheckedChange={(v) => setRefsOk(v === true)}
            disabled={busy}
            className="mt-0.5"
          />
          <span className="text-sm">
            Trade references verified
            <span className="block text-xs text-muted-foreground">
              {r.ref1Company
                ? <>Spoke to {r.ref1Contact ?? "the contact"} at {r.ref1Company}{r.ref2Company ? ` and ${r.ref2Company}` : ""}</>
                : "No reference on this request"}
            </span>
          </span>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <PanelField
          id="acc-limit"
          label="Recommended credit limit"
          hint={
            r.requestedCreditLimit !== null
              ? `They asked for ${inr(r.requestedCreditLimit)}`
              : "They did not name a figure"
          }
        >
          <Input
            id="acc-limit"
            inputMode="numeric"
            value={limit}
            disabled={busy}
            onChange={(e) => setLimit(e.target.value.replace(/[^\d.]/g, ""))}
            placeholder="0"
            className="tabular-nums"
          />
        </PanelField>

        <PanelField
          id="acc-days"
          label="Recommended credit period"
          hint={r.requestedCreditDays !== null ? `They asked for ${r.requestedCreditDays} days` : "In days"}
        >
          <Input
            id="acc-days"
            inputMode="numeric"
            value={days}
            disabled={busy}
            onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))}
            placeholder="0"
            className="tabular-nums"
          />
        </PanelField>

        <PanelField id="acc-date" label="Verified on">
          {/* From the browser, not Postgres: current_date is UTC, so between
              00:00 and 05:30 IST the server would stamp yesterday. */}
          <Input
            id="acc-date"
            type="date"
            value={date}
            disabled={busy}
            onChange={(e) => setDate(e.target.value)}
          />
        </PanelField>
      </div>

      {/* In decide mode the remarks box lives in the decision bar, next to the
          buttons whose reason it supplies. A correction has no decision, so it
          gets a plain field here instead of an orphaned bar. */}
      {mode === "edit" && (
        <PanelField id="acc-remarks-edit" label="Verification remarks">
          <Textarea
            id="acc-remarks-edit" rows={3} value={remarks} disabled={busy}
            onChange={(e) => setRemarks(e.target.value)}
          />
        </PanelField>
      )}

      {/* Non-blocking notes. Neither of these stops a forward — they are the two
          things a verifier most often wants flagged, not rules. */}
      {r.paymentTerms === "credit" && limit.trim() === "" && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Credit terms with no recommended limit. That is allowed, but nobody downstream will
          have a number to approve.
        </p>
      )}
      {willEscalate && (
        <p className="text-xs text-muted-foreground">
          At {inr(preview.accRecommendedLimit)} this will need Director approval after the sales head
          (the threshold in force is {inr(s.approvalRules.directorThreshold)}).
        </p>
      )}
    </StepActionPanel>
  );
}
