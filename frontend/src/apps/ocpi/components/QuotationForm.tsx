import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Combobox from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { useOcpiStore } from "../store";
import CustomerPicker from "./CustomerPicker";
import GstinField from "./GstinField";
import RequestMasterModal from "./RequestMasterModal";
import { isVisible } from "../lib/branching";
import {
  COST_BEARERS, CURRENCIES, DOLLAR_CLAUSE, HIGH_SEAS_VIA,
  PAYMENT_TYPES, TRANSPORT_TERMS, type QuotationDraft,
} from "../lib/fieldSpec";
import type { OcpiMasterType } from "../types";

/**
 * Part A — everything the printed quotation needs.
 *
 * The grouping mirrors the printed sheet (Machine Details / Deal Inclusions /
 * Commercial Terms / Remarks), not the Microsoft form's question order, so
 * someone checking a generated PDF against the paper finds the fields where they
 * expect them.
 *
 * ⚠ CONDITIONAL FIELDS ARE HIDDEN, NEVER DISABLED. `isVisible` (lib/branching)
 *   answers what applies; a greyed-out box still reads as a question you failed
 *   to answer. The server clears whatever a branch hides on every write, so the
 *   row can never keep an answer the form stopped showing.
 */

/** A yes/no, as the source form asks them. Null until answered — not false. */
function YesNo({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <FieldLabel label={label}>
      <div className="flex gap-2">
        {[
          { v: true, t: "Yes" },
          { v: false, t: "No" },
        ].map((o) => (
          <button
            key={o.t}
            type="button"
            disabled={disabled}
            onClick={() => onChange(o.v)}
            className={[
              "h-9 min-w-[72px] rounded-lg border px-3 text-[13px] font-medium transition",
              value === o.v
                ? "border-orange bg-orange text-white"
                : "border-line bg-white text-navy hover:border-orange/50",
              disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
            ].join(" ")}
          >
            {o.t}
          </button>
        ))}
      </div>
    </FieldLabel>
  );
}

const opts = (xs: readonly string[]) => xs.map((x) => ({ value: x, label: x }));

/**
 * A master list as combobox options, plus whatever this deal already holds.
 *
 * ⚠ THE CURRENT VALUE IS ALWAYS AN OPTION, even when it is not on the list. A
 *   deal quoted last year against a head type since switched off would
 *   otherwise open with the field looking empty, and saving would silently
 *   clear it. Deactivating a master must never rewrite a deal.
 */
const masterOpts = (rows: { name: string; active: boolean }[], current: string) => {
  const live = rows.filter((r) => r.active).map((r) => r.name);
  const all = current && !live.includes(current) ? [...live, current] : live;
  return all.map((x) => ({ value: x, label: x }));
};
const optsKV = (xs: readonly { value: string; label: string }[]) =>
  xs.map((x) => ({ value: x.value, label: x.label }));

export default function QuotationForm({
  draft,
  patch,
  disabled,
}: {
  draft: QuotationDraft;
  patch: (p: Partial<QuotationDraft>) => void;
  disabled?: boolean;
}) {
  const s = useOcpiStore();

  // Only machines an admin has switched on. A machine with no template is still
  // quotable — it simply cannot reach the order-confirmation step, which is
  // where the missing template actually bites.
  const machineOptions = useMemo(
    () =>
      s.machines
        .filter((m) => m.active)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
        .map((m) => ({
          value: m.id,
          label: m.name,
          sublabel: m.hasTemplate ? undefined : "no order-confirmation template yet",
        })),
    [s.machines],
  );

  const salespersonOptions = useMemo(() => {
    const names = new Set<string>();
    for (const d of s.deals) if (d.salespersonName) names.add(d.salespersonName);
    if (draft.salespersonName) names.add(draft.salespersonName);
    return [...names].sort((a, b) => a.localeCompare(b)).map((n) => ({ value: n, label: n }));
  }, [s.deals, draft.salespersonName]);

  /**
   * A pending "please add this to the list" prompt.
   *
   * ⚠ TYPING A NEW VALUE NEVER BLOCKS THE QUOTATION. The typed text is written
   *   straight onto the draft — these three columns hold TEXT, not a foreign
   *   key — and the modal only offers to add it to the master so the next
   *   person can pick it. Making a salesperson wait for somebody to approve a
   *   vocabulary entry mid-negotiation would be a worse product than the free
   *   text box this replaces. Machines are the opposite case and are chosen
   *   from the list only, because a deal points at one by id.
   */
  const [ask, setAsk] = useState<{ type: OcpiMasterType; name: string } | null>(null);

  const show = (k: keyof QuotationDraft) => isVisible(k, draft);

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-bold text-navy">Customer</h2>
        <CustomerPicker draft={draft} patch={patch} disabled={disabled} />

        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel label="Contact person (Attn)">
            <TextInput
              value={draft.customerAttn}
              onChange={(e) => patch({ customerAttn: e.target.value })}
              placeholder="Who the quotation is addressed to"
              disabled={disabled}
            />
          </FieldLabel>
          <FieldLabel label="Mobile">
            <TextInput
              value={draft.customerMobile}
              onChange={(e) => patch({ customerMobile: e.target.value })}
              placeholder="10 digits"
              disabled={disabled}
            />
          </FieldLabel>
        </div>

        <FieldLabel label="Address">
          <TextArea
            rows={2}
            value={draft.customerAddress}
            onChange={(e) => patch({ customerAddress: e.target.value })}
            placeholder="Printed on the quotation under To,"
            disabled={disabled}
          />
        </FieldLabel>

        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel label="Email">
            <TextInput
              type="email"
              value={draft.customerEmail}
              onChange={(e) => patch({ customerEmail: e.target.value })}
              disabled={disabled}
            />
          </FieldLabel>
          <YesNo
            label="GST registered"
            value={draft.gstAvailable}
            onChange={(v) => patch({ gstAvailable: v })}
            disabled={disabled}
          />
        </div>

        {show("gstNo") && <GstinField draft={draft} patch={patch} disabled={disabled} />}

        <FieldLabel label="Salesperson" required>
          <Combobox
            value={draft.salespersonName}
            onChange={(v) => patch({ salespersonName: v })}
            options={salespersonOptions}
            placeholder="Who owns this deal"
            searchable
            clearable
            disabled={disabled}
            onCreate={(label) => {
              patch({ salespersonName: label });
              return label;
            }}
            createLabel={(q) => `Use “${q}”`}
          />
        </FieldLabel>
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-bold text-navy">
          Machine details <span className="text-[12px] font-normal text-grey-2">· section A</span>
        </h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel label="Machine" required>
            <Combobox
              value={draft.machineId}
              onChange={(v) => patch({ machineId: v })}
              options={machineOptions}
              placeholder={machineOptions.length ? "Choose the model" : "No machines set up yet"}
              searchable
              clearable
              disabled={disabled || machineOptions.length === 0}
            />
          </FieldLabel>
          <FieldLabel label="No. of machines" required>
            <TextInput
              inputMode="numeric"
              value={draft.machineCount}
              onChange={(e) => patch({ machineCount: e.target.value.replace(/\D/g, "") })}
              disabled={disabled}
            />
          </FieldLabel>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel label="Type of head">
            <Combobox
              value={draft.headType}
              onChange={(v) => patch({ headType: v })}
              options={masterOpts(s.headTypes, draft.headType)}
              placeholder="Choose or type"
              searchable
              clearable
              disabled={disabled}
              onCreate={(label) => {
                // Non-blocking: the typed value is KEPT on the deal, and the
                // list is asked to grow so the next person can pick it.
                patch({ headType: label });
                setAsk({ type: "head_type", name: label });
                return label;
              }}
              createLabel={(q) => `Use “${q}”`}
            />
          </FieldLabel>
          <FieldLabel label="No. of print heads required">
            <TextInput
              inputMode="numeric"
              value={draft.headCount}
              onChange={(e) => patch({ headCount: e.target.value.replace(/\D/g, "") })}
              disabled={disabled}
            />
          </FieldLabel>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel label="Type of ink">
            <Combobox
              value={draft.inkType}
              onChange={(v) => patch({ inkType: v })}
              options={masterOpts(s.inkTypes, draft.inkType)}
              placeholder="Choose or type"
              searchable
              clearable
              disabled={disabled}
              onCreate={(label) => {
                // Non-blocking: the typed value is KEPT on the deal, and the
                // list is asked to grow so the next person can pick it.
                patch({ inkType: label });
                setAsk({ type: "ink_type", name: label });
                return label;
              }}
              createLabel={(q) => `Use “${q}”`}
            />
          </FieldLabel>
          <FieldLabel label="Dryer required">
            <Combobox
              value={draft.dryerType}
              onChange={(v) => patch({ dryerType: v })}
              options={masterOpts(s.dryerTypes, draft.dryerType)}
              placeholder="Choose or type"
              searchable
              clearable
              disabled={disabled}
              onCreate={(label) => {
                // Non-blocking: the typed value is KEPT on the deal, and the
                // list is asked to grow so the next person can pick it.
                patch({ dryerType: label });
                setAsk({ type: "dryer_type", name: label });
                return label;
              }}
              createLabel={(q) => `Use “${q}”`}
            />
          </FieldLabel>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel label="Ink price" hint="free text — “N/A” is a real answer">
            <TextInput
              value={draft.inkPrice}
              onChange={(e) => patch({ inkPrice: e.target.value })}
              disabled={disabled}
            />
          </FieldLabel>
          <FieldLabel label="Ink credit terms (future)">
            <TextInput
              value={draft.inkCreditTerms}
              onChange={(e) => patch({ inkCreditTerms: e.target.value })}
              placeholder="e.g. 30"
              disabled={disabled}
            />
          </FieldLabel>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-bold text-navy">
          Deal inclusions <span className="text-[12px] font-normal text-grey-2">· section B</span>
        </h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <YesNo
            label="Deal includes ink"
            value={draft.inclInk}
            onChange={(v) => patch({ inclInk: v })}
            disabled={disabled}
          />
          {show("inkQtyIncluded") && (
            <FieldLabel label="Quantity of ink included">
              <TextInput
                value={draft.inkQtyIncluded}
                onChange={(e) => patch({ inkQtyIncluded: e.target.value })}
                disabled={disabled}
              />
            </FieldLabel>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <YesNo
            label="Deal includes spare parts"
            value={draft.inclSpares}
            onChange={(v) => patch({ inclSpares: v })}
            disabled={disabled}
          />
          {show("spareDetails") && (
            <FieldLabel label="Spare part details" hint="item name & quantity">
              <TextInput
                value={draft.spareDetails}
                onChange={(e) => patch({ spareDetails: e.target.value })}
                disabled={disabled}
              />
            </FieldLabel>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <YesNo
            label="Deal includes head"
            value={draft.inclHead}
            onChange={(v) => patch({ inclHead: v })}
            disabled={disabled}
          />
          {show("headsIncluded") && (
            <FieldLabel label="No. of heads included">
              <TextInput
                inputMode="numeric"
                value={draft.headsIncluded}
                onChange={(e) => patch({ headsIncluded: e.target.value.replace(/\D/g, "") })}
                disabled={disabled}
              />
            </FieldLabel>
          )}
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-bold text-navy">
          Commercial terms <span className="text-[12px] font-normal text-grey-2">· section C</span>
        </h2>

        <div className="grid gap-3 sm:grid-cols-3">
          <FieldLabel label="Currency" required>
            <Combobox
              value={draft.dealValueCurrency}
              onChange={(v) => patch({ dealValueCurrency: v })}
              options={opts(CURRENCIES)}
              disabled={disabled}
            />
          </FieldLabel>
          <div className="sm:col-span-2">
            <FieldLabel label="Total deal value (excluding GST)" required>
              <TextInput
                inputMode="decimal"
                value={draft.dealValueAmount}
                onChange={(e) => patch({ dealValueAmount: e.target.value.replace(/[^\d.]/g, "") })}
                placeholder="Figures only"
                disabled={disabled}
              />
            </FieldLabel>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel label="Type of payment">
            <Combobox
              value={draft.paymentType}
              onChange={(v) => patch({ paymentType: v })}
              options={optsKV(PAYMENT_TYPES)}
              placeholder="Choose"
              clearable
              disabled={disabled}
            />
          </FieldLabel>
          <FieldLabel label="Machine delivery date" hint="tentative, committed to the customer">
            <TextInput
              type="date"
              value={draft.deliveryDate}
              onChange={(e) => patch({ deliveryDate: e.target.value })}
              disabled={disabled}
            />
          </FieldLabel>
        </div>

        <FieldLabel label="Terms of payment">
          <TextArea
            rows={2}
            value={draft.paymentTerms}
            onChange={(e) => patch({ paymentTerms: e.target.value })}
            placeholder="e.g. 25% advance, 75% before delivery"
            disabled={disabled}
          />
        </FieldLabel>

        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel label="Transportation terms">
            <Combobox
              value={draft.transportTerms}
              onChange={(v) => patch({ transportTerms: v })}
              options={optsKV(TRANSPORT_TERMS)}
              placeholder="Choose"
              clearable
              disabled={disabled}
            />
          </FieldLabel>
          {show("highSeasVia") && (
            <FieldLabel label="High seas delivery via">
              <Combobox
                value={draft.highSeasVia}
                onChange={(v) => patch({ highSeasVia: v })}
                options={opts(HIGH_SEAS_VIA)}
                placeholder="Choose"
                clearable
                disabled={disabled}
              />
            </FieldLabel>
          )}
          {show("highSeasCostBy") && (
            <FieldLabel label="High seas cost borne by">
              <Combobox
                value={draft.highSeasCostBy}
                onChange={(v) => patch({ highSeasCostBy: v })}
                options={optsKV(COST_BEARERS)}
                placeholder="Choose"
                clearable
                disabled={disabled}
              />
            </FieldLabel>
          )}
          {show("localCostBy") && (
            <FieldLabel
              label="Local delivery cost borne by"
              hint="transport, clearance, loading / unloading"
            >
              <Combobox
                value={draft.localCostBy}
                onChange={(v) => patch({ localCostBy: v })}
                options={optsKV(COST_BEARERS)}
                placeholder="Choose"
                clearable
                disabled={disabled}
              />
            </FieldLabel>
          )}
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-bold text-navy">
          Remarks &amp; terms <span className="text-[12px] font-normal text-grey-2">· section D</span>
        </h2>

        <FieldLabel label="Remarks / additional information">
          <TextArea
            rows={3}
            value={draft.remarks}
            onChange={(e) => patch({ remarks: e.target.value })}
            disabled={disabled}
          />
        </FieldLabel>

        <div className="rounded-lg border border-line bg-[#FBFCFE] p-3">
          <p className="text-[12.5px] leading-relaxed text-grey">{DOLLAR_CLAUSE}</p>
          <div className="mt-2">
            <YesNo
              label="Agreed with the customer"
              value={draft.dollarClauseAgreed}
              onChange={(v) => patch({ dollarClauseAgreed: v })}
              disabled={disabled}
            />
          </div>
        </div>
      </Card>
      <RequestMasterModal
        open={!!ask}
        onClose={() => setAsk(null)}
        masterType={ask?.type ?? null}
        lockType
        prefillName={ask?.name}
        stacked
      />

    </div>
  );
}
