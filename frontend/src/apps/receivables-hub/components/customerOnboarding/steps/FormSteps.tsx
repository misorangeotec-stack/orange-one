/**
 * The seven wizard panes.
 *
 * Kept in one file on purpose: they are small, they share every import, and
 * seven files of forty lines each would obscure rather than reveal. Each is a
 * pure function of the RHF form — no data fetching, no validation logic (that
 * lives in lib/customerOnboarding/schema.ts), no navigation.
 */
import { useEffect, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Input } from "@hub/components/ui/input";
import { Textarea } from "@hub/components/ui/textarea";
import { Checkbox } from "@hub/components/ui/checkbox";
import { Label } from "@hub/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@hub/components/ui/radio-group";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@hub/components/ui/select";
import { FieldShell, FormGrid } from "../FormField";
import GstinField from "../GstinField";
import SalespersonPicker from "../SalespersonPicker";
import Documents from "../Documents";
import { normaliseMobile, type CustomerFormValues } from "@hub/lib/customerOnboarding/schema";
import { useCustomerStore } from "@hub/lib/customerOnboarding/store";
import {
  customerTypeFrom, factoryAddressFrom, natureOfBusinessHint, toSnapshot,
} from "@hub/lib/customerOnboarding/gstin";
import {
  CONSUMPTION_BAND_OPTIONS, CUSTOMER_TYPE_OPTIONS, PAYMENT_TERMS_OPTIONS,
  PRINTING_APPLICATION_OPTIONS, SECURITY_OFFERED_OPTIONS,
  type CustomerRequest, type GstState,
} from "@hub/lib/customerOnboarding/types";

export interface StepProps {
  form: UseFormReturn<CustomerFormValues>;
  states: GstState[];
  disabled?: boolean;
  /** Step 2 only — the saved draft, once one exists. Uploads need somewhere to live. */
  requestId?: string | null;
  request?: CustomerRequest | null;
  /** Step 2 only — force an immediate save so the upload slots can appear. */
  onNeedSave?: () => void | Promise<unknown>;
}

const err = (form: UseFormReturn<CustomerFormValues>, k: keyof CustomerFormValues) =>
  form.formState.errors[k]?.message as string | undefined;

type TidyField = "contact_mobile" | "ref1_mobile" | "ref2_mobile" | "contact_email";

/**
 * Register a field AND rewrite it to its stored form when the user leaves it.
 *
 * ⚠ WHY THIS IS NEEDED: zod `.transform()` runs during resolution, and RHF does
 *   NOT write the resolver's output back into form state. Without this the
 *   Review pane (which reads getValues()) showed `+91 98765 43210` while the
 *   server stored `9876543210` — a review screen that quietly disagrees with
 *   what is about to be saved is worse than no review screen. Caught in browser
 *   testing, not by the type checker.
 *
 * ⚠ AND WHY IT COMPOSES: register() supplies its own onBlur, which is what marks
 *   a field touched and drives `mode: "onTouched"`. Spreading register() and
 *   THEN passing onBlur silently replaces it, so the field never becomes touched
 *   and its error never appears. Chain, never override.
 *
 * The server normalises too (fms_customer_norm_mobile). This is about showing the
 * user the truth, not about trusting the client.
 */
function tidyRegister(form: UseFormReturn<CustomerFormValues>, field: TidyField) {
  const reg = form.register(field);
  return {
    ...reg,
    onBlur: async (e: React.FocusEvent<HTMLInputElement>) => {
      await reg.onBlur(e);
      const raw = (form.getValues(field) ?? "") as string;
      const next = field === "contact_email" ? raw.trim().toLowerCase() : normaliseMobile(raw);
      if (next !== raw) form.setValue(field, next, { shouldDirty: true, shouldValidate: true });
    },
  };
}

/* ── 1. Customer information ───────────────────────────────────────────── */

export function Step1CustomerInfo({ form, disabled }: StepProps) {
  const { register, watch, setValue } = form;
  const s = useCustomerStore();
  // The portal's own words, shown when we would NOT auto-pick a type. Wholesale
  // vs retail is all GST knows; dealer/distributor/trader is the rep's call, and
  // one glance at this beats guessing or opening the certificate.
  const nbaHint = natureOfBusinessHint(watch("gstin_snapshot")?.compliance ?? null);
  const companyId = watch("company_id") ?? "";
  return (
    <FormGrid>
      {/**
        * ⚠ FIRST FIELD, ahead of the customer's own name — it is the framing
        *   question for the whole request, and the gate asks it first. Seeded
        *   there and left editable here, exactly like the GST number, so a draft
        *   or a reworked request can still correct it.
        */}
      <FieldShell
        id="company_id"
        label="Onboarding into"
        required
        error={err(form, "company_id")}
        hint="The Tally company whose books this customer's ledger will be created in."
      >
        <Select
          value={companyId}
          disabled={disabled}
          onValueChange={(v) => setValue("company_id", v, { shouldValidate: true, shouldDirty: true })}
        >
          <SelectTrigger id="company_id"><SelectValue placeholder="Choose a company" /></SelectTrigger>
          <SelectContent>
            {/* A company since deactivated is not in s.companies, but a request
                already onboarded into it must still show it rather than render
                blank and silently re-ask. */}
            {companyId && !s.companies.some((c) => c.id === companyId) && (
              <SelectItem value={companyId}>{s.companyName(companyId)}</SelectItem>
            )}
            {s.companies.map((c) => (
              <SelectItem key={c.id} value={c.id}>{s.companyName(c.id)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldShell>

      {/* The other half of "whose customer is this". Same column the Tally step
          writes, so there is one salesperson per request and not two. */}
      <FieldShell
        id="assigned_sales_exec_name"
        label="Salesperson"
        required
        error={err(form, "assigned_sales_exec_name")}
        hint="Who owns this customer. Not on the list? Choose “Other” and type the name."
      >
        <SalespersonPicker
          id="assigned_sales_exec_name"
          value={watch("assigned_sales_exec_name") ?? ""}
          disabled={disabled}
          onChange={(v) =>
            setValue("assigned_sales_exec_name", v, { shouldValidate: true, shouldDirty: true })
          }
        />
      </FieldShell>

      <FieldShell id="legal_name" label="Legal Company Name" required error={err(form, "legal_name")}
                  hint="Exactly as it appears on the GST certificate">
        <Input id="legal_name" disabled={disabled} placeholder="Orange Textiles Private Limited"
               {...register("legal_name")} />
      </FieldShell>

      <FieldShell id="trade_name" label="Trade Name" error={err(form, "trade_name")}
                  hint="The name they actually go by, if different">
        <Input id="trade_name" disabled={disabled} placeholder="Orange Textiles" {...register("trade_name")} />
      </FieldShell>

      <FieldShell
        id="customer_type"
        label="Customer Type"
        required
        error={err(form, "customer_type")}
        hint={nbaHint ? `GST portal says: ${nbaHint}` : undefined}
      >
        <Select
          value={watch("customer_type") ?? ""}
          disabled={disabled}
          onValueChange={(v) => setValue("customer_type", v as never, { shouldValidate: true, shouldDirty: true })}
        >
          <SelectTrigger id="customer_type"><SelectValue placeholder="Choose a type" /></SelectTrigger>
          <SelectContent>
            {CUSTOMER_TYPE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldShell>

      <FieldShell id="website" label="Website" error={err(form, "website")}>
        <Input id="website" disabled={disabled} placeholder="www.example.com" {...register("website")} />
      </FieldShell>
    </FormGrid>
  );
}

/* ── 2. Business & KYC ─────────────────────────────────────────────────── */

export function Step2Kyc({ form, states, disabled, requestId, request, onNeedSave }: StepProps) {
  const { register, watch, setValue } = form;
  const sameBilling = watch("billing_same_as_registered");
  const registered = watch("registered_address") ?? "";

  /**
   * "Factory address is the same as the registered address" — for the very many
   * small manufacturers whose only premises IS the registered one.
   *
   * ⚠ DELIBERATELY UNLIKE THE BILLING FLAG NEXT TO IT, in two ways.
   *
   *   1. It is LOCAL STATE, not a column. The tick is a claim that two strings
   *      are equal, so equality IS the stored fact — nothing is lost by deriving
   *      it. That means no migration, and it works on requests raised before
   *      this existed.
   *   2. It COPIES the address rather than storing null-and-resolving-later.
   *      Billing can be null because every reader resolves it. Factory cannot:
   *      the submit RPC requires it non-null (step 2 validation), and the Excel
   *      export, the request detail and the Tally ledger all read the column
   *      directly. Copying keeps every one of those correct with no changes.
   */
  const [sameFactory, setSameFactory] = useState(() => {
    const f = (form.getValues("factory_address") ?? "").trim();
    const r = (form.getValues("registered_address") ?? "").trim();
    return f.length > 0 && f === r;
  });

  // Keep the copy true while the box is ticked — including when the registered
  // address is edited afterwards, which is exactly when a stale copy would
  // otherwise ship a wrong factory address to Tally.
  useEffect(() => {
    if (!sameFactory) return;
    if ((form.getValues("factory_address") ?? "") === registered) return;
    setValue("factory_address", registered, { shouldDirty: true, shouldValidate: true });
  }, [sameFactory, registered, form, setValue]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Registration
        </h3>
        <FormGrid>
          <GstinField
            states={states}
            disabled={disabled}
            value={watch("gst_number") ?? ""}
            onChange={(v) => setValue("gst_number", v, { shouldDirty: true })}
            error={err(form, "gst_number")}
            panValue={watch("pan_number") ?? ""}
            onPanChange={(v) => setValue("pan_number", v, { shouldDirty: true, shouldValidate: true })}
            panError={err(form, "pan_number")}
            stateName={watch("state_name") ?? ""}
            // Already looked up at the gate (or on a previous visit to a draft).
            // Passing it prevents this pane re-buying the same paid answer.
            snapshot={watch("gstin_snapshot") ?? null}
            onDerived={({ pan, stateCode, stateName }) => {
              // Only fill the PAN when it is empty — never clobber a deliberate
              // manual override (the field offers its own "reset to derived").
              const current = (form.getValues("pan_number") ?? "").toUpperCase();
              if (!current) setValue("pan_number", pan, { shouldDirty: true });
              setValue("state_code", stateCode, { shouldDirty: true });
              setValue("state_name", stateName, { shouldDirty: true });
            }}
            onLookup={(d) => {
              // ⚠ SOFT-FILL: blanks only. A portal record is a suggestion, and
              //   silently overwriting something a rep typed on purpose is how
              //   people learn to fight a form instead of using it.
              const fillIfBlank = (
                field: "legal_name" | "trade_name" | "registered_address" | "city" | "factory_address",
                v: string | null,
              ) => {
                if (!v) return;
                const current = (form.getValues(field) ?? "").trim();
                if (current) return;
                setValue(field, v, { shouldDirty: true, shouldValidate: true });
              };
              fillIfBlank("legal_name", d.legalName);
              fillIfBlank("trade_name", d.tradeName);
              fillIfBlank("city", d.city);
              // Append the pincode: the portal keeps it separate, but an address
              // without one is not much use to a courier or a Tally ledger.
              fillIfBlank(
                "registered_address",
                d.registeredAddress
                  ? [d.registeredAddress, d.pincode].filter(Boolean).join(" - ")
                  : null,
              );
              // Only a premises the portal LABELS as manufacturing — anything
              // else (warehouse, branch, godown) stays the rep's to type.
              fillIfBlank("factory_address", factoryAddressFrom(d.additionalPlaces));
              // Only manufacturer/exporter, and only when unambiguous — see
              // customerTypeFrom. Step 1's field carries the portal's wording as
              // a hint for every case this declines to decide.
              const ct = customerTypeFrom(d.compliance?.natureOfBusiness);
              if (ct && !form.getValues("customer_type")) {
                setValue("customer_type", ct as never, { shouldDirty: true, shouldValidate: true });
              }
              // Freeze the evidence. This is what Accounts and the Director read
              // days later, and it is NOT a soft-fill: a fresh lookup for THIS
              // GSTIN always replaces an older one, because the newer answer is
              // strictly better and the old one was never edited by hand.
              setValue("gstin_snapshot", toSnapshot(form.getValues("gst_number") ?? "", d), {
                shouldDirty: true,
              });
            }}
          />
          <FieldShell id="msme_udyam_no" label="MSME / Udyam Registration" error={err(form, "msme_udyam_no")}>
            <Input id="msme_udyam_no" disabled={disabled} placeholder="UDYAM-MH-01-0000000"
                   {...register("msme_udyam_no")} />
          </FieldShell>
        </FormGrid>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Address
        </h3>
        <FormGrid cols={1}>
          <FieldShell id="registered_address" label="Registered Address" required
                      error={err(form, "registered_address")}>
            <Textarea id="registered_address" rows={2} disabled={disabled}
                      placeholder="Building, street, area" {...register("registered_address")} />
          </FieldShell>
        </FormGrid>
        <FormGrid>
          <FieldShell id="city" label="City" required error={err(form, "city")}>
            <Input id="city" disabled={disabled} placeholder="Mumbai" {...register("city")} />
          </FieldShell>
          <div />
        </FormGrid>
        <FormGrid cols={1}>
          <div className="flex items-center gap-2 pb-2">
            <Checkbox
              id="factory_same"
              disabled={disabled}
              checked={sameFactory}
              onCheckedChange={(c) => setSameFactory(c === true)}
            />
            <Label htmlFor="factory_same" className="text-sm font-normal cursor-pointer">
              Factory address is the same as the registered address
            </Label>
          </div>

          <FieldShell
            id="factory_address"
            label="Factory Address"
            required
            error={sameFactory ? undefined : err(form, "factory_address")}
            hint={sameFactory ? "Copied from the registered address above" : undefined}
          >
            <Textarea
              id="factory_address" rows={2}
              disabled={disabled || sameFactory}
              className={sameFactory ? "bg-muted/50" : undefined}
              placeholder="Where the printing actually happens"
              {...register("factory_address")}
            />
          </FieldShell>

          <div className="flex items-center gap-2 pb-3">
            <Checkbox
              id="billing_same"
              disabled={disabled}
              checked={sameBilling}
              onCheckedChange={(c) =>
                setValue("billing_same_as_registered", c === true, { shouldDirty: true, shouldValidate: true })}
            />
            <Label htmlFor="billing_same" className="text-sm font-normal cursor-pointer">
              Billing address is the same as the registered address
            </Label>
          </div>

          {!sameBilling && (
            <FieldShell id="billing_address" label="Billing Address" required
                        error={err(form, "billing_address")}>
              <Textarea id="billing_address" rows={2} disabled={disabled}
                        {...register("billing_address")} />
            </FieldShell>
          )}
        </FormGrid>
      </div>

      {/* Uploads need a request to belong to, so they appear as soon as the
          autosave has minted the draft row. Documents renders its own prompt
          until then rather than vanishing, which would read as "this form has
          no uploads". All four are optional and none of them gates submission. */}
      <div className="border-t pt-4">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-2">
          Documents <span className="normal-case font-normal">(all optional)</span>
        </div>
        <Documents
          request={request ?? null}
          requestId={requestId ?? null}
          onNeedSave={onNeedSave}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

/* ── 3. Contact ────────────────────────────────────────────────────────── */

export function Step3Contact({ form, disabled }: StepProps) {
  const { register } = form;
  return (
    <FormGrid>
      <FieldShell id="contact_name" label="Contact Person Name" required error={err(form, "contact_name")}>
        <Input id="contact_name" disabled={disabled} {...register("contact_name")} />
      </FieldShell>
      <FieldShell id="contact_designation" label="Designation" required
                  error={err(form, "contact_designation")}>
        <Input id="contact_designation" disabled={disabled} placeholder="Purchase Manager"
               {...register("contact_designation")} />
      </FieldShell>
      <FieldShell id="contact_mobile" label="Mobile Number" required error={err(form, "contact_mobile")}
                  hint="10 digits — paste it however you like, we tidy it up">
        <Input id="contact_mobile" type="tel" inputMode="numeric" disabled={disabled}
               placeholder="9876543210" {...tidyRegister(form, "contact_mobile")} />
      </FieldShell>
      <FieldShell id="contact_email" label="Email ID" required error={err(form, "contact_email")}>
        <Input id="contact_email" type="email" disabled={disabled} placeholder="name@company.com"
               {...tidyRegister(form, "contact_email")} />
      </FieldShell>
    </FormGrid>
  );
}

/* ── 4. Ink business profile — every field optional ────────────────────── */

export function Step4Ink({ form, disabled }: StepProps) {
  const { register, watch, setValue } = form;
  const apps = watch("printing_applications") ?? [];
  const toggle = (v: string, on: boolean) => {
    const next = on ? [...apps, v] : apps.filter((a) => a !== v);
    setValue("printing_applications", next as never, { shouldDirty: true, shouldValidate: true });
  };

  return (
    <div className="space-y-6">
      <div>
        <Label className="text-xs font-medium">
          Printing Application
          <span className="text-muted-foreground font-normal ml-1">(optional — tick any that apply)</span>
        </Label>
        <div className="mt-2 grid gap-2 grid-cols-2 sm:grid-cols-4">
          {PRINTING_APPLICATION_OPTIONS.map((o) => (
            <label
              key={o.value}
              className="flex items-center gap-2 rounded-md border px-3 py-2 cursor-pointer hover:bg-muted/50"
            >
              <Checkbox
                disabled={disabled}
                checked={apps.includes(o.value)}
                onCheckedChange={(c) => toggle(o.value, c === true)}
              />
              <span className="text-sm">{o.label}</span>
            </label>
          ))}
        </div>
        {apps.includes("other") && (
          <div className="mt-3 max-w-md">
            <FieldShell id="printing_application_other" label="Which other application?" required
                        error={err(form, "printing_application_other")}>
              <Input id="printing_application_other" disabled={disabled}
                     {...register("printing_application_other")} />
            </FieldShell>
          </div>
        )}
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Ink currently used
        </h3>
        <FormGrid>
          <FieldShell id="current_ink_brand" label="Current Ink Brand" error={err(form, "current_ink_brand")}>
            <Input id="current_ink_brand" disabled={disabled} {...register("current_ink_brand")} />
          </FieldShell>
          <FieldShell id="current_supplier" label="Current Supplier" error={err(form, "current_supplier")}>
            <Input id="current_supplier" disabled={disabled} {...register("current_supplier")} />
          </FieldShell>
          <FieldShell id="monthly_ink_consumption" label="Monthly Ink Consumption"
                      error={err(form, "monthly_ink_consumption")}>
            <Select
              value={watch("monthly_ink_consumption") ?? ""}
              disabled={disabled}
              onValueChange={(v) =>
                setValue("monthly_ink_consumption", v as never, { shouldDirty: true, shouldValidate: true })}
            >
              <SelectTrigger id="monthly_ink_consumption"><SelectValue placeholder="Choose a band" /></SelectTrigger>
              <SelectContent>
                {CONSUMPTION_BAND_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldShell>
        </FormGrid>
      </div>
    </div>
  );
}

/* ── 5. Business potential — optional ──────────────────────────────────── */

export function Step5Potential({ form, disabled }: StepProps) {
  const { register } = form;
  return (
    <FormGrid>
      <FieldShell id="est_monthly_purchase" label="Estimated Monthly Purchase (₹)"
                  error={err(form, "est_monthly_purchase")} hint="A rough figure is fine">
        <Input id="est_monthly_purchase" inputMode="decimal" disabled={disabled}
               placeholder="450000" {...register("est_monthly_purchase")} />
      </FieldShell>
      <FieldShell id="expected_first_order" label="Expected First Order Value (₹)"
                  error={err(form, "expected_first_order")}>
        <Input id="expected_first_order" inputMode="decimal" disabled={disabled}
               placeholder="150000" {...register("expected_first_order")} />
      </FieldShell>
    </FormGrid>
  );
}

/* ── 6. Trade references ───────────────────────────────────────────────── */

export function Step6References({ form, disabled }: StepProps) {
  const { register } = form;
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div className="rounded-md border p-4">
        <h3 className="text-xs font-semibold mb-3">
          Reference 1 <span className="text-destructive">*</span>
        </h3>
        <FormGrid cols={1}>
          <FieldShell id="ref1_company" label="Company Name" required error={err(form, "ref1_company")}>
            <Input id="ref1_company" disabled={disabled} {...register("ref1_company")} />
          </FieldShell>
          <FieldShell id="ref1_contact" label="Contact Person" required error={err(form, "ref1_contact")}>
            <Input id="ref1_contact" disabled={disabled} {...register("ref1_contact")} />
          </FieldShell>
          <FieldShell id="ref1_mobile" label="Mobile Number" required error={err(form, "ref1_mobile")}>
            <Input id="ref1_mobile" type="tel" inputMode="numeric" disabled={disabled}
                   {...tidyRegister(form, "ref1_mobile")} />
          </FieldShell>
        </FormGrid>
      </div>

      <div className="rounded-md border border-dashed p-4">
        <h3 className="text-xs font-semibold mb-3">
          Reference 2 <span className="font-normal text-muted-foreground">(optional)</span>
        </h3>
        <FormGrid cols={1}>
          <FieldShell id="ref2_company" label="Company Name" error={err(form, "ref2_company")}>
            <Input id="ref2_company" disabled={disabled} {...register("ref2_company")} />
          </FieldShell>
          <FieldShell id="ref2_contact" label="Contact Person" error={err(form, "ref2_contact")}>
            <Input id="ref2_contact" disabled={disabled} {...register("ref2_contact")} />
          </FieldShell>
          <FieldShell id="ref2_mobile" label="Mobile Number" error={err(form, "ref2_mobile")}>
            <Input id="ref2_mobile" type="tel" inputMode="numeric" disabled={disabled}
                   {...tidyRegister(form, "ref2_mobile")} />
          </FieldShell>
        </FormGrid>
        <p className="text-[11px] text-muted-foreground">
          A second reference makes a credit request much easier to approve.
        </p>
      </div>
    </div>
  );
}

/* ── 7. Credit request ─────────────────────────────────────────────────── */

export function Step7Credit({ form, disabled }: StepProps) {
  const { register, watch, setValue } = form;
  const terms = watch("payment_terms");
  const wantsCredit = terms === "credit";

  return (
    <div className="space-y-6">
      <div>
        <Label className="text-xs font-medium">
          Payment Terms <span className="text-destructive">*</span>
        </Label>
        <RadioGroup
          className="mt-2 flex gap-3"
          value={terms ?? ""}
          disabled={disabled}
          onValueChange={(v) => setValue("payment_terms", v as never, { shouldDirty: true, shouldValidate: true })}
        >
          {PAYMENT_TERMS_OPTIONS.map((o) => (
            <label
              key={o.value}
              className="flex items-center gap-2 rounded-md border px-4 py-2.5 cursor-pointer hover:bg-muted/50"
            >
              <RadioGroupItem value={o.value} id={`terms-${o.value}`} />
              <span className="text-sm">{o.label}</span>
            </label>
          ))}
        </RadioGroup>
        {err(form, "payment_terms") && (
          <p className="text-[11px] text-destructive mt-1">{err(form, "payment_terms")}</p>
        )}
      </div>

      {wantsCredit && (
        <div className="rounded-md border p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            What they are asking for
          </h3>
          <FormGrid>
            <FieldShell id="requested_credit_limit" label="Requested Credit Limit (₹)"
                        error={err(form, "requested_credit_limit")}
                        hint="Leave blank and Accounts will propose one">
              <Input id="requested_credit_limit" inputMode="decimal" disabled={disabled}
                     placeholder="500000" {...register("requested_credit_limit")} />
            </FieldShell>
            <FieldShell id="requested_credit_days" label="Requested Credit Period (days)"
                        error={err(form, "requested_credit_days")}>
              <Input id="requested_credit_days" inputMode="numeric" disabled={disabled}
                     placeholder="30" {...register("requested_credit_days")} />
            </FieldShell>
            <FieldShell id="security_offered" label="Security Offered" error={err(form, "security_offered")}>
              <RadioGroup
                className="flex flex-wrap gap-2"
                value={watch("security_offered") ?? ""}
                disabled={disabled}
                onValueChange={(v) => setValue("security_offered", v as never, { shouldDirty: true })}
              >
                {SECURITY_OFFERED_OPTIONS.map((o) => (
                  <label
                    key={o.value}
                    className="flex items-center gap-2 rounded-md border px-3 py-2 cursor-pointer hover:bg-muted/50"
                  >
                    <RadioGroupItem value={o.value} id={`security-${o.value}`} />
                    <span className="text-sm">{o.label}</span>
                  </label>
                ))}
              </RadioGroup>
              {(watch("security_offered") ?? "") !== "" && !disabled && (
                <button
                  type="button"
                  className="mt-1 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  onClick={() => setValue("security_offered", "" as never, { shouldDirty: true })}
                >
                  Clear — none specified
                </button>
              )}
            </FieldShell>
          </FormGrid>
          <FormGrid cols={1}>
            <FieldShell id="credit_reason" label="Reason for Credit Request"
                        error={err(form, "credit_reason")}
                        hint="Anything that helps Accounts and the Sales Head decide">
              <Textarea id="credit_reason" rows={3} disabled={disabled} {...register("credit_reason")} />
            </FieldShell>
          </FormGrid>
        </div>
      )}

      {terms === "advance" && (
        <p className="text-sm text-muted-foreground">
          Advance-payment customers carry no credit exposure, so there is nothing else to fill
          in here — and they usually skip director approval.
        </p>
      )}
    </div>
  );
}
