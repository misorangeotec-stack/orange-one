/**
 * One onboarding request, in full — the case file every approver reads before
 * deciding, with the decision itself at the top of it.
 *
 * ⚠ House rule: Progress is ALWAYS the first block on a detail page.
 *
 * Deliberately NOT a modal-per-step, unlike the other FMS modules. A sampling
 * "record collection" modal captures two fields; an Accounts verifier here has
 * to read forty-odd fields and open four documents before they can honestly tick
 * "GST verified". The decision belongs at the bottom of the evidence, not in a
 * box floating on top of it — so the panel is part of the page, immediately
 * under Progress and above everything it is a decision about.
 *
 * ⚠ ONE PANEL COMPONENT PER STEP, USED FOR BOTH DECIDING AND CORRECTING.
 *   `?correct=<step>` renders the same component in edit mode. A separate
 *   correction dialog would be a second place for each step's rules to live,
 *   and the two would drift the first time a field moved.
 */
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, AlertTriangle, Pencil } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent } from "@hub/components/ui/card";
import { useCustomerStore } from "@hub/lib/customerOnboarding/store";
import RequestStageRail from "@hub/components/customerOnboarding/RequestStageRail";
import StatusBadge from "@hub/components/customerOnboarding/StatusBadge";
import CompanyChip from "@hub/components/customerOnboarding/CompanyChip";
import ActivityTimeline from "@hub/components/customerOnboarding/ActivityTimeline";
import AssignSalesExecCard from "@hub/components/customerOnboarding/AssignSalesExecCard";
import HoldCancelMenu from "@hub/components/customerOnboarding/HoldCancelMenu";
import Documents from "@hub/components/customerOnboarding/Documents";
import AccountsPanel from "@hub/components/customerOnboarding/AccountsPanel";
import SalesHeadPanel from "@hub/components/customerOnboarding/SalesHeadPanel";
import DirectorPanel from "@hub/components/customerOnboarding/DirectorPanel";
import TallyPanel from "@hub/components/customerOnboarding/TallyPanel";
import { Field, FieldGrid, SectionHeading } from "@hub/components/customerOnboarding/Readout";
import { allHref, detailHref, editHref } from "@hub/lib/customerOnboarding/routes";
import { formLockReason, stageLockReason } from "@hub/lib/customerOnboarding/queues";
import { stepTitle, type StepKey } from "@hub/lib/customerOnboarding/steps";
import {
  consumptionLabel, customerCategoryMeaning, customerTypeLabel, dmy, inr, liveStatusLabel,
  paymentTermsLabel, printingListLabel, requestSubject, securityLabel, stageLabel, yesNo,
} from "@hub/lib/customerOnboarding/format";
import type { CustomerRequest } from "@hub/lib/customerOnboarding/types";

const CORRECTABLE: StepKey[] = [
  "accounts_verification", "sales_head_approval", "director_approval", "tally_creation",
];

export default function RequestDetail() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const s = useCustomerStore();
  const r = s.requestById(id);

  if (s.loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!r) {
    return (
      <div className="p-6 max-w-[900px] mx-auto">
        <Card>
          <CardContent className="p-8 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              This request does not exist, or you do not have access to it.
            </p>
            <Button variant="outline" asChild><Link to={allHref()}>Back to all requests</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const activity = s.activityFor(r.id);
  // Editable = the form is still unlocked AND this viewer is the one who may touch it.
  const editable = s.canEdit && formLockReason(r) === null && (s.canActOn("submission", r) || s.isCoordinator);
  const openStepKey = s.openStepOf(r);

  // The step whose ALREADY-RECORDED decision is being corrected, if any. Every
  // condition here is also enforced by the server: the URL alone grants nothing.
  const wanted = params.get("correct");
  const correcting: StepKey | null =
    wanted && (CORRECTABLE as string[]).includes(wanted)
      && stageLockReason(wanted as StepKey, r) === null
      && s.canActOn(wanted as StepKey, r)
      ? (wanted as StepKey)
      : null;
  const stopCorrecting = () => setParams({}, { replace: true });

  // The panel for the step this request currently owes — shown only to someone
  // who may actually act on it, and never while the request is parked.
  const actionable =
    openStepKey && openStepKey !== "submission" && r.status !== "on_hold" && s.canActOn(openStepKey, r)
      ? openStepKey
      : null;

  // Documents stay attachable while the request is open; they lock once it
  // closes, matching fms_customer_set_document.
  const docsLocked =
    r.status === "completed" || r.status === "cancelled" || r.status === "rejected"
    || !(s.canActOn("submission", r) || s.isAnyStepOwner || s.isCoordinator);

  return (
    <div className="p-6 space-y-5 max-w-[1100px] mx-auto">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" asChild className="-ml-2 mb-1 gap-1 text-muted-foreground">
            <Link to={allHref()}><ArrowLeft className="h-4 w-4" /> All requests</Link>
          </Button>
          <h1 className="text-2xl font-bold text-foreground">{requestSubject(r)}</h1>
          {/* ⚠ IN THE HEADER, not buried in the step-2 card, because this page is
              where all four decision panels render. Putting it here is what keeps
              the company on screen at Accounts, Sales Head, Director and Tally
              without threading it through each of them. */}
          <p className="text-sm mt-1">
            <CompanyChip companyId={r.companyId} />
          </p>
          <p className="text-sm text-muted-foreground mt-0.5">
            {r.reqNo ?? "Draft"}
            {r.raisedByName && <> · raised by {r.raisedByName}</>}
            {r.submittedAt && <> on {dmy(r.submittedAt)}</>}
            {r.reworkCount > 0 && <> · sent back {r.reworkCount}×</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={r.status} />
          {editable && (
            <Button variant="outline" size="sm" asChild className="gap-1">
              <Link to={editHref(r.id)}><Pencil className="h-3.5 w-3.5" /> Edit</Link>
            </Button>
          )}
          <HoldCancelMenu request={r} />
        </div>
      </div>

      {/* ── Banners for the exceptional states ────────────────────────── */}
      {r.status === "rework" && (
        <Banner tone="warn" title={`Sent back by ${stageLabel(r.reworkStage)}`}>
          {r.reworkReason} — update the details and submit again.
        </Banner>
      )}
      {r.status === "rejected" && (
        <Banner tone="error" title={`Rejected by ${stageLabel(r.rejectStage)}`}>
          {r.rejectReason}
        </Banner>
      )}
      {r.status === "on_hold" && (
        <Banner tone="warn" title="On hold">
          {r.holdReason} — nobody can act on it until a coordinator resumes it.
        </Banner>
      )}
      {r.status === "cancelled" && (
        <Banner tone="error" title="Cancelled">{r.cancelReason}</Banner>
      )}

      {/* ── Progress: ALWAYS first ────────────────────────────────────── */}
      <Card>
        <CardContent className="p-5">
          <SectionHeading>Progress</SectionHeading>
          <RequestStageRail request={r} personName={s.personName} />
          {openStepKey && r.status !== "on_hold" && (
            <p className="text-xs text-muted-foreground mt-4 text-center">
              Currently with <span className="font-medium text-foreground">{stepTitle(openStepKey)}</span>
              {(() => {
                const owners = s.stepOwnerIds(openStepKey).map(s.personName).filter(Boolean);
                return owners.length ? <> — {owners.join(", ")}</> : null;
              })()}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── The decision, or the correction ───────────────────────────── */}
      {correcting
        ? <StagePanel step={correcting} request={r} mode="edit" onDone={stopCorrecting} />
        : actionable
          ? <StagePanel step={actionable} request={r} mode="decide" />
          : null}

      {/* ── Step 1 ────────────────────────────────────────────────────── */}
      <Card><CardContent className="p-5">
        <SectionHeading>Customer information</SectionHeading>
        <FieldGrid>
          <Field label="Onboarding into" value={s.companyName(r.companyId)} />
          {/* The same column the Tally step shows further down as "Salesperson
              in Tally" — one answer, restated where step 1 is recapped. */}
          <Field label="Salesperson" value={r.assignedSalesExecName} />
          <Field label="Legal company name" value={r.legalName} />
          <Field label="Trade name" value={r.tradeName} />
          <Field label="Customer type" value={customerTypeLabel(r.customerType)} />
          <Field label="Website" value={r.website} />
        </FieldGrid>
      </CardContent></Card>

      {/* ── Step 2 ────────────────────────────────────────────────────── */}
      <Card><CardContent className="p-5">
        <SectionHeading>Business &amp; KYC</SectionHeading>
        <FieldGrid>
          <Field label="GST number" value={<span className="font-mono">{r.gstNumber ?? "—"}</span>} />
          <Field label="PAN number" value={<span className="font-mono">{r.panNumber ?? "—"}</span>}
                 hint={r.gstNumber ? "Derived from the GST number" : undefined} />
          <Field label="MSME / Udyam" value={r.msmeUdyamNo} />
          <Field label="City" value={r.city} />
          <Field label="State" value={r.stateName} hint={r.stateCode ? `GST code ${r.stateCode}` : undefined} />
          <div />
          <Field label="Registered address" value={r.registeredAddress} className="sm:col-span-2" />
          <Field label="Factory address" value={r.factoryAddress} />
          <Field
            label="Billing address"
            value={r.billingSameAsRegistered ? "Same as registered" : r.billingAddress}
            className="sm:col-span-2"
          />
        </FieldGrid>

        <div className="mt-5 pt-4 border-t">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-2">
            Documents <span className="normal-case font-normal">(all optional)</span>
          </div>
          <Documents request={r} requestId={r.id} disabled={docsLocked} />
        </div>
      </CardContent></Card>

      {/* ── Step 3 ────────────────────────────────────────────────────── */}
      <Card><CardContent className="p-5">
        <SectionHeading>Contact</SectionHeading>
        <FieldGrid>
          <Field label="Contact person" value={r.contactName} />
          <Field label="Designation" value={r.contactDesignation} />
          <Field label="Mobile" value={r.contactMobile} />
          <Field label="Email" value={r.contactEmail} />
        </FieldGrid>
      </CardContent></Card>

      {/* ── Steps 4 + 5 ───────────────────────────────────────────────── */}
      <Card><CardContent className="p-5">
        <SectionHeading>Ink profile &amp; potential</SectionHeading>
        <FieldGrid>
          <Field
            label="Printing applications"
            value={printingListLabel(r.printingApplications)}
            hint={r.printingApplicationOther ? `Other: ${r.printingApplicationOther}` : undefined}
            className="sm:col-span-2"
          />
          <Field label="Monthly ink consumption" value={consumptionLabel(r.monthlyInkConsumption)} />
          <Field label="Current ink brand" value={r.currentInkBrand} />
          <Field label="Current supplier" value={r.currentSupplier} />
          <div />
          <Field label="Estimated monthly purchase" value={inr(r.estMonthlyPurchase)} />
          <Field label="Expected first order" value={inr(r.expectedFirstOrder)} />
        </FieldGrid>
      </CardContent></Card>

      {/* ── Step 6 ────────────────────────────────────────────────────── */}
      <Card><CardContent className="p-5">
        <SectionHeading>Trade references</SectionHeading>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="rounded-md border p-4">
            <div className="text-xs font-semibold mb-3">Reference 1</div>
            <div className="space-y-3">
              <Field label="Company" value={r.ref1Company} />
              <Field label="Contact person" value={r.ref1Contact} />
              <Field label="Mobile" value={r.ref1Mobile} />
            </div>
          </div>
          <div className="rounded-md border p-4">
            <div className="text-xs font-semibold mb-3">
              Reference 2 <span className="font-normal text-muted-foreground">(optional)</span>
            </div>
            <div className="space-y-3">
              <Field label="Company" value={r.ref2Company} />
              <Field label="Contact person" value={r.ref2Contact} />
              <Field label="Mobile" value={r.ref2Mobile} />
            </div>
          </div>
        </div>
      </CardContent></Card>

      {/* ── Step 7 ────────────────────────────────────────────────────── */}
      <Card><CardContent className="p-5">
        <SectionHeading>Credit request</SectionHeading>
        <FieldGrid>
          <Field label="Payment terms" value={paymentTermsLabel(r.paymentTerms)} />
          <Field label="Requested credit limit" value={inr(r.requestedCreditLimit)} />
          <Field label="Requested credit period" value={r.requestedCreditDays ? `${r.requestedCreditDays} days` : "—"} />
          <Field label="Security offered" value={securityLabel(r.securityOffered)} />
          <Field label="Reason for credit" value={r.creditReason} className="sm:col-span-2" />
        </FieldGrid>
        {r.paymentTerms === "credit" && r.requestedCreditLimit === null && (
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-3">
            Credit terms were requested without naming a limit — Accounts will need to propose one.
          </p>
        )}
      </CardContent></Card>

      {/* ── Who owns this customer ────────────────────────────────────── */}
      <AssignSalesExecCard request={r} />

      {/* ── Step 8: whatever has been decided so far ──────────────────── */}
      {(r.accVerifiedAt || r.shDecidedAt || r.dirDecidedAt) && (
        <Card><CardContent className="p-5 space-y-5">
          <SectionHeading>Internal approval</SectionHeading>

          {r.accVerifiedAt && (
            <div>
              <StageHeading
                request={r}
                step="accounts_verification"
                label={`Accounts — ${s.personName(r.accVerifiedBy)}, ${dmy(r.accVerifiedDate ?? r.accVerifiedAt)}`}
                correcting={correcting}
              />
              <FieldGrid>
                <Field label="GST verified" value={yesNo(r.accGstVerified)} />
                <Field label="Trade references verified" value={yesNo(r.accRefsVerified)} />
                <Field label="Recommended limit" value={inr(r.accRecommendedLimit)} />
                <Field label="Recommended period" value={r.accRecommendedDays ? `${r.accRecommendedDays} days` : "—"} />
                <Field label="Remarks" value={r.accRemarks} className="sm:col-span-2" />
              </FieldGrid>
            </div>
          )}

          {r.shDecidedAt && (
            <div className="pt-4 border-t">
              <StageHeading
                request={r}
                step="sales_head_approval"
                label={`Sales head — ${s.personName(r.shDecidedBy)}, ${dmy(r.shDecidedDate ?? r.shDecidedAt)}`}
                correcting={correcting}
              />
              <FieldGrid>
                <Field
                  label="Customer category"
                  value={r.shCustomerCategory}
                  hint={customerCategoryMeaning(r.shCustomerCategory) ?? undefined}
                />
                <Field label="Decision" value={r.shDecision} />
                <Field
                  label="Director approval"
                  value={r.dirRequired ? "Required" : "Not required"}
                  hint={
                    r.dirRequired
                      ? r.dirRequiredReason === "forced"
                        ? "Escalated by the sales head"
                        : `Limit exceeded the ${inr(r.dirThresholdAtDecision)} threshold in force`
                      : undefined
                  }
                />
                <Field label="Business potential" value={r.shBusinessPotential} className="sm:col-span-2" />
                <Field label="Remarks" value={r.shRemarks} className="sm:col-span-2" />
              </FieldGrid>
            </div>
          )}

          {r.dirDecidedAt && (
            <div className="pt-4 border-t">
              <StageHeading
                request={r}
                step="director_approval"
                label={`Director — ${s.personName(r.dirDecidedBy)}, ${dmy(r.dirDecidedDate ?? r.dirDecidedAt)}`}
                correcting={correcting}
              />
              <FieldGrid>
                <Field label="Decision" value={r.dirDecision} />
                <Field label="Remarks" value={r.dirRemarks} className="sm:col-span-2" />
              </FieldGrid>
            </div>
          )}
        </CardContent></Card>
      )}

      {/* ── Step 9 ────────────────────────────────────────────────────── */}
      {r.tallyAt && (
        <Card><CardContent className="p-5">
          <StageHeading
            request={r}
            step="tally_creation"
            label="Customer created"
            correcting={correcting}
            heading
          />
          <FieldGrid>
            <Field label="Customer code" value={<span className="font-mono">{r.customerCode ?? "—"}</span>} />
            <Field label="Tally ledger created" value={yesNo(r.tallyLedgerCreated)} />
            <Field label="Tally ledger name" value={r.tallyLedgerName} />
            <Field label="Assigned sales executive" value={r.assignedSalesExecName} />
            <Field label="Customer status" value={liveStatusLabel(r.customerStatus)} />
            <Field label="Created on" value={dmy(r.tallyDate ?? r.tallyAt)}
                   hint={`Recorded by ${s.personName(r.tallyBy)}`} />
          </FieldGrid>
        </CardContent></Card>
      )}

      {/* ── Activity ──────────────────────────────────────────────────── */}
      <Card><CardContent className="p-5">
        <SectionHeading
          right={
            r.editedAt
              ? <span className="text-xs text-muted-foreground">
                  Last corrected {dmy(r.editedAt)} by {s.personName(r.editedBy)}
                </span>
              : undefined
          }
        >
          Activity
        </SectionHeading>
        <ActivityTimeline items={activity} personName={s.personName} />
      </CardContent></Card>
    </div>
  );
}

/** Routes a step key to its panel. One place, so a new step is one line here. */
function StagePanel({
  step, request, mode, onDone,
}: {
  step: StepKey;
  request: CustomerRequest;
  mode: "decide" | "edit";
  onDone?: () => void;
}) {
  switch (step) {
    case "accounts_verification": return <AccountsPanel request={request} mode={mode} onDone={onDone} />;
    case "sales_head_approval":   return <SalesHeadPanel request={request} mode={mode} onDone={onDone} />;
    case "director_approval":     return <DirectorPanel request={request} mode={mode} onDone={onDone} />;
    case "tally_creation":        return <TallyPanel request={request} mode={mode} onDone={onDone} />;
    default:                      return null;
  }
}

/**
 * A recorded stage's caption, with a Correct link when this viewer may still
 * change it. The link is hidden — not disabled — when they may not: a greyed
 * control on someone else's decision only invites a question.
 */
function StageHeading({
  request, step, label, correcting, heading,
}: {
  request: CustomerRequest;
  step: StepKey;
  label: string;
  correcting: StepKey | null;
  /** Render as a section heading rather than an inline stage caption. */
  heading?: boolean;
}) {
  const s = useCustomerStore();
  const [, setParams] = useSearchParams();
  const may = s.canActOn(step, request) && stageLockReason(step, request) === null;
  const active = correcting === step;

  const action = may && !active ? (
    <Button
      variant="ghost" size="sm"
      className="h-auto py-1 px-2 gap-1 text-xs font-normal text-muted-foreground hover:text-foreground"
      onClick={() => {
        setParams({ correct: step }, { replace: true });
        window.scrollTo({ top: 0, behavior: "smooth" });
      }}
    >
      <Pencil className="h-3 w-3" /> Correct
    </Button>
  ) : undefined;

  if (heading) return <SectionHeading right={action}>{label}</SectionHeading>;

  return (
    <div className="flex items-center justify-between gap-3 mb-2">
      <div className="text-xs font-semibold">{label}</div>
      {action}
    </div>
  );
}

function Banner({
  tone, title, children,
}: { tone: "warn" | "error"; title: string; children: React.ReactNode }) {
  return (
    <div
      className={
        tone === "error"
          ? "rounded-md border border-destructive/30 bg-destructive/10 p-4"
          : "rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40"
      }
    >
      <div className="flex gap-2">
        <AlertTriangle
          className={`h-4 w-4 shrink-0 mt-0.5 ${tone === "error" ? "text-destructive" : "text-amber-600 dark:text-amber-400"}`}
        />
        <div className="min-w-0">
          <div className={`text-sm font-medium ${tone === "error" ? "text-destructive" : "text-amber-900 dark:text-amber-200"}`}>
            {title}
          </div>
          <div className={`text-sm mt-0.5 ${tone === "error" ? "text-destructive/90" : "text-amber-800 dark:text-amber-300"}`}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
