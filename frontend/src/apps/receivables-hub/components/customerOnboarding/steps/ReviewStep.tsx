/**
 * The eighth pane: everything typed so far, read-only, grouped by step, with an
 * Edit link per group.
 *
 * This is what makes a seven-pane form trustworthy enough that people actually
 * press Submit. It is cheap to build and it is the difference between "I think I
 * filled that in" and knowing.
 */
import { Pencil, AlertTriangle } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";
import { Field, FieldGrid } from "../Readout";
import type { CustomerFormValues } from "@hub/lib/customerOnboarding/schema";
import { FORM_STEPS } from "@hub/lib/customerOnboarding/steps";
import {
  CONSUMPTION_BAND_OPTIONS, CUSTOMER_TYPE_OPTIONS, PAYMENT_TERMS_OPTIONS,
  PRINTING_APPLICATION_OPTIONS, SECURITY_OFFERED_OPTIONS,
} from "@hub/lib/customerOnboarding/types";
import { inr } from "@hub/lib/customerOnboarding/format";

const label = (opts: readonly { value: string; label: string }[], v: string | undefined) =>
  v ? (opts.find((o) => o.value === v)?.label ?? v) : "—";

export default function ReviewStep({
  form, onJump, invalidSteps,
}: {
  form: UseFormReturn<CustomerFormValues>;
  onJump: (stepIndex: number) => void;
  invalidSteps: Set<number>;
}) {
  const v = form.getValues();

  const Group = ({ index, children }: { index: number; children: React.ReactNode }) => {
    const step = FORM_STEPS.find((s) => s.index === index)!;
    const bad = invalidSteps.has(index);
    return (
      <div className={bad ? "rounded-md border border-destructive/40 p-4" : "rounded-md border p-4"}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="text-xs font-semibold flex items-center gap-2">
            {step.title}
            {bad && (
              <span className="inline-flex items-center gap-1 text-destructive font-normal">
                <AlertTriangle className="h-3 w-3" /> needs attention
              </span>
            )}
          </h3>
          <button
            type="button"
            onClick={() => onJump(index)}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <Pencil className="h-3 w-3" /> Edit
          </button>
        </div>
        {children}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Check everything below, then submit. Accounts will verify the GST number and the trade
        references before this goes any further.
      </p>

      <Group index={1}>
        <FieldGrid>
          <Field label="Legal company name" value={v.legal_name} />
          <Field label="Trade name" value={v.trade_name} />
          <Field label="Customer type" value={label(CUSTOMER_TYPE_OPTIONS, v.customer_type)} />
          <Field label="Website" value={v.website} />
        </FieldGrid>
      </Group>

      <Group index={2}>
        <FieldGrid>
          <Field label="GST number" value={<span className="font-mono">{v.gst_number || "—"}</span>} />
          <Field label="PAN number" value={<span className="font-mono">{v.pan_number || "—"}</span>} />
          <Field label="MSME / Udyam" value={v.msme_udyam_no} />
          <Field label="City" value={v.city} />
          <Field label="State" value={v.state_name} />
          <div />
          <Field label="Registered address" value={v.registered_address} className="sm:col-span-2" />
          <Field label="Factory address" value={v.factory_address} />
          <Field
            label="Billing address"
            value={v.billing_same_as_registered ? "Same as registered" : v.billing_address}
            className="sm:col-span-2"
          />
        </FieldGrid>
      </Group>

      <Group index={3}>
        <FieldGrid>
          <Field label="Contact person" value={v.contact_name} />
          <Field label="Designation" value={v.contact_designation} />
          <Field label="Mobile" value={v.contact_mobile} />
          <Field label="Email" value={v.contact_email} />
        </FieldGrid>
      </Group>

      <Group index={4}>
        <FieldGrid>
          <Field
            label="Printing applications"
            value={
              v.printing_applications?.length
                ? v.printing_applications.map((a) => label(PRINTING_APPLICATION_OPTIONS, a)).join(", ")
                : "—"
            }
            hint={v.printing_application_other ? `Other: ${v.printing_application_other}` : undefined}
            className="sm:col-span-2"
          />
          <Field label="Monthly consumption" value={label(CONSUMPTION_BAND_OPTIONS, v.monthly_ink_consumption)} />
          <Field label="Current ink brand" value={v.current_ink_brand} />
          <Field label="Current supplier" value={v.current_supplier} />
        </FieldGrid>
      </Group>

      <Group index={5}>
        <FieldGrid>
          <Field label="Estimated monthly purchase" value={inr(v.est_monthly_purchase)} />
          <Field label="Expected first order" value={inr(v.expected_first_order)} />
        </FieldGrid>
      </Group>

      <Group index={6}>
        <FieldGrid cols={2}>
          <Field label="Reference 1"
                 value={[v.ref1_company, v.ref1_contact, v.ref1_mobile].filter(Boolean).join(" · ")} />
          <Field label="Reference 2"
                 value={[v.ref2_company, v.ref2_contact, v.ref2_mobile].filter(Boolean).join(" · ")} />
        </FieldGrid>
      </Group>

      <Group index={7}>
        <FieldGrid>
          <Field label="Payment terms" value={label(PAYMENT_TERMS_OPTIONS, v.payment_terms)} />
          <Field label="Requested credit limit" value={inr(v.requested_credit_limit)} />
          <Field label="Requested credit period" value={v.requested_credit_days ? `${v.requested_credit_days} days` : "—"} />
          <Field label="Security offered" value={label(SECURITY_OFFERED_OPTIONS, v.security_offered)} />
          <Field label="Reason for credit" value={v.credit_reason} className="sm:col-span-2" />
        </FieldGrid>

        {/* Deliberately a note, not an error — Accounts are the ones who propose a
            number, so blocking here would stop a legitimate submission. */}
        {v.payment_terms === "credit" && !v.requested_credit_limit && (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/40">
            <p className="text-xs text-amber-900 dark:text-amber-200">
              You have asked for credit terms without naming a limit. That is fine — Accounts will
              propose one — but saying what the customer asked for usually speeds up approval.
            </p>
          </div>
        )}
      </Group>

      <p className="text-xs text-muted-foreground">
        GST certificate, PAN card, cancelled cheque and MSME certificate are all optional and can
        be attached from the request page after you submit.
      </p>
    </div>
  );
}
