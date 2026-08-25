import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { useOcpiStore } from "../store";
import { OCPI_MASTERS_QK, fetchOcpiMasters } from "../data/ocpiMasters";
import CustomerPicker from "./CustomerPicker";
import GstinField from "./GstinField";
import RequestMasterModal from "./RequestMasterModal";
import { isVisible } from "../lib/branching";
import { fetchFxRate } from "@/shared/lib/fx";
import {
  COST_BEARERS, CURRENCIES, DOLLAR_CLAUSE, HEAD_SHIP_MODES, HEAD_SHIP_VIA,
  HIGH_SEAS_VIA, INSURANCE_CLAUSE, PAYMENT_TYPES, PLATTER_OPTIONS,
  PRINTER_WARRANTY, TRADE_TERMS, TRANSPORT_TERMS, WARRANTY_MONTHS,
  type QuotationDraft,
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
  // quotable and still goes all the way through — it issues the summary sheet
  // alone, and the editor names it before anything is sent.
  const machineOptions = useMemo(
    () =>
      s.machines
        .filter((m) => m.active)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
        .map((m) => ({
          value: m.id,
          label: m.name,
          sublabel: m.hasTemplate ? undefined : "summary sheet only — no detailed template yet",
        })),
    [s.machines],
  );

  /**
   * Which of our own companies is selling.
   *
   * ⚠ THIS WAS SET SILENTLY AND SHOWN NOWHERE. `CustomerPicker` copies the Tally
   *   party's company onto the draft, and that value alone decides which bank
   *   account, CIN, registered address and letterhead the contract prints. Two
   *   cases it cannot answer: a NEW LEAD has no Tally party at all, so the field
   *   stayed empty and the default entity printed with no warning (`isFallback`
   *   is false for a null company — correctly, since it cannot know it is
   *   wrong); and a customer who genuinely buys from a different arm than the
   *   one Tally files them under could not be corrected without editing Tally.
   *   So the value is now a visible, editable field that merely DEFAULTS to the
   *   customer's company.
   */
  const { data: masters } = useQuery({
    queryKey: OCPI_MASTERS_QK,
    queryFn: fetchOcpiMasters,
    staleTime: 30 * 60 * 1000,
  });

  /**
   * ⚠ ONLY COMPANIES THAT HAVE A SELLING-ENTITY PROFILE ARE OFFERED.
   *
   *   Tally carries five companies; four of them have no profile, and picking
   *   one used to be allowed with a warning — the document then printed the
   *   DEFAULT entity's bank account, CIN and registered address on a contract
   *   the customer pays against. A warning is the wrong instrument for that:
   *   it is read once and clicked past, and the consequence is money sent to
   *   the wrong company. So the choice is removed rather than annotated, and
   *   Settings → Selling entities is the single place that decides what may
   *   be quoted under. Add the profile there and the company appears here.
   *
   *   The one exception is a company ALREADY on this deal, kept so an existing
   *   draft does not silently lose its entity — it is offered, and labelled as
   *   not set up, so the reader can see what has to change.
   */
  const companyOptions = useMemo<ComboOption[]>(() => {
    const opts: ComboOption[] = [];
    for (const c of masters?.companies ?? []) {
      const own = s.companyProfiles.find((p) => p.companyId === c.id && p.active);
      if (!own) continue;
      opts.push({
        value: c.id,
        label: c.name,
        // Say what this choice will actually print, since that is the whole
        // consequence of the field and it is otherwise invisible until the PDF.
        sublabel:
          [own.legalName, own.bankName, own.exWorksCity && `Ex-Works ${own.exWorksCity}`]
            .filter(Boolean)
            .join(" · ") || undefined,
      });
    }
    if (draft.companyId && !opts.some((o) => o.value === draft.companyId)) {
      const c = masters?.companies.find((x) => x.id === draft.companyId);
      opts.unshift({
        value: draft.companyId,
        label: c?.name ?? "Company no longer listed",
        sublabel: "not set up as a selling entity — choose another, or add its details in Settings",
      });
    }
    return opts;
  }, [masters?.companies, s.companyProfiles, draft.companyId]);

  const defaultEntityName = useMemo(() => {
    const d = s.companyProfiles.find((p) => p.isDefault && p.active);
    return d?.legalName ?? null;
  }, [s.companyProfiles]);

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
   *   text box this replaces.
   *
   *   Machines can be asked for too, but they CANNOT be typed onto the deal —
   *   see the machine picker below. Same modal, different landing.
   */
  const [ask, setAsk] = useState<{ type: OcpiMasterType; name: string } | null>(null);

  /** The machine just asked for, so the still-empty picker does not read as a no-op. */
  const [machineAsked, setMachineAsked] = useState<string | null>(null);

  /**
   * A high seas sale is a dollar deal with no GST, both fixed by the deal type.
   * The currency picker is disabled rather than hidden — a reader still needs to
   * see WHICH currency, and hiding it would make the rule look like a bug.
   */
  const isHighSeas = draft.transportTerms === "high_seas";

  const [fxBusy, setFxBusy] = useState(false);
  const [fxError, setFxError] = useState<string | null>(null);

  /**
   * Pull the live rate.
   *
   * ⚠ A FAILURE MUST NOT BLOCK THE QUOTATION. The field stays editable and the
   *   error is a sentence under it — a hand-typed rate is always a legitimate
   *   answer, and often the correct one, since deals are struck at an agreed rate
   *   rather than at whatever the market says this minute.
   */
  const pullRate = async () => {
    setFxBusy(true);
    setFxError(null);
    try {
      const r = await fetchFxRate("USD", "INR");
      patch({
        fxRate: String(r.rate),
        fxRateSource: r.source,
        fxRateAt: r.fetchedAt,
        fxRateOverridden: false,
      });
    } catch (e) {
      setFxError(
        `${e instanceof Error ? e.message : "Could not fetch a live rate"} — type the rate you agreed instead.`,
      );
    } finally {
      setFxBusy(false);
    }
  };

  /** The rupee equivalent, shown beside the rate so the figure is never a surprise. */
  const inrEquivalent = useMemo(() => {
    const amt = Number(draft.dealValueAmount);
    const rate = Number(draft.fxRate);
    if (!Number.isFinite(amt) || !Number.isFinite(rate) || !draft.dealValueAmount || !draft.fxRate) {
      return null;
    }
    return `₹${Math.round(amt * rate).toLocaleString("en-IN")}`;
  }, [draft.dealValueAmount, draft.fxRate]);

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

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <FieldLabel label="Selling entity" hint="whose bank account this prints">
              <Combobox
                value={draft.companyId}
                onChange={(v) => patch({ companyId: v })}
                options={companyOptions}
                placeholder="Which of our companies is selling"
                searchable
                clearable
                disabled={disabled}
              />
            </FieldLabel>
            {/* ⚠ BLANK IS A LEGITIMATE ANSWER and is NOT marked required, because
                Tally leaves ~10 of 1,888 customers with no company at all and the
                default row exists precisely to cover them (see store.tsx
                `profileStatusFor`). What blank must not be is SILENT — it decides
                a bank account. So it names the entity it will fall back to. */}
            {!draft.companyId && defaultEntityName && (
              <p className="mt-1.5 text-[12px] text-grey-2">
                Left blank, this prints <b className="text-navy">{defaultEntityName}</b>.
              </p>
            )}
          </div>
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
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-bold text-navy">
          Machine details <span className="text-[12px] font-normal text-grey-2">· section A</span>
        </h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <FieldLabel label="Machine" required>
              <Combobox
                value={draft.machineId}
                onChange={(v) => patch({ machineId: v })}
                options={machineOptions}
                placeholder={machineOptions.length ? "Choose the model" : "Nothing set up yet — ask for one"}
                searchable
                clearable
                disabled={disabled}
                onCreate={(label) => {
                  // ⚠ UNLIKE head / ink / dryer, THIS DOES NOT PUT THE TYPED NAME ON
                  //   THE DEAL. Those three are text columns, so the typed value IS
                  //   the answer. A deal points at a machine BY ID, and no id exists
                  //   until somebody approves the request — so the field stays empty
                  //   on purpose. Returning nothing is the Combobox's own "asked for,
                  //   not chosen"; the note below says so, because an empty picker
                  //   otherwise reads as nothing having happened.
                  setAsk({ type: "machine", name: label });
                }}
                createLabel={(q) => `Ask for “${q}”`}
              />
            </FieldLabel>
            {machineAsked && !draft.machineId && (
              <p className="mt-1.5 text-[12px] text-grey-2">
                Asked for <b className="text-navy">“{machineAsked}”</b> — pick it here once it
                is approved. Save this as a draft meanwhile.
              </p>
            )}
          </div>
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

        {/*
          ⚠ THE DEAL TYPE LEADS THE SECTION, because everything commercial follows
            from it: High Seas is always a dollar deal and carries NO GST; Others
            is taxed. It is the SAME `transport_terms` column the module has
            always had — relabelled, not replaced, so every existing row and every
            frozen version still reads correctly.
        */}
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel label="Deal type" required>
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

        {isHighSeas && (
          <p className="rounded-lg border border-line bg-[#FBFCFE] px-3 py-2 text-[12.5px] text-grey">
            A high seas sale is in <span className="font-medium text-navy">US dollars</span> and carries{" "}
            <span className="font-medium text-navy">no GST</span>. Both are set for you, and the papers
            print no tax line at all.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <FieldLabel label="Currency" required hint={isHighSeas ? "fixed by the deal type" : undefined}>
            <Combobox
              value={draft.dealValueCurrency}
              onChange={(v) => patch({ dealValueCurrency: v })}
              options={opts(CURRENCIES)}
              disabled={disabled || isHighSeas}
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

        {/*
          ⚠ THE RATE IS A STARTING POINT, NEVER A LOCK. Deals are negotiated at an
            agreed rate; showing the live one instead would misstate the contract.
            Whichever rate is used is frozen onto the revision when the quotation
            is generated, so a paper keeps the arithmetic it was issued under.
        */}
        {show("fxRate") && (
          <div className="space-y-2 rounded-lg border border-line bg-[#FBFCFE] p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[9rem]">
                <FieldLabel label="USD → INR rate">
                  <TextInput
                    inputMode="decimal"
                    value={draft.fxRate}
                    onChange={(e) =>
                      patch({
                        fxRate: e.target.value.replace(/[^\d.]/g, ""),
                        fxRateOverridden: true,
                        fxRateSource: "manual",
                        fxRateAt: new Date().toISOString(),
                      })
                    }
                    placeholder="e.g. 87.4250"
                    disabled={disabled}
                  />
                </FieldLabel>
              </div>
              <Button variant="outline" size="sm" onClick={pullRate} disabled={disabled || fxBusy}>
                {fxBusy ? "Fetching…" : "Get live rate"}
              </Button>
              {inrEquivalent && (
                <p className="pb-2 text-[13px] text-grey">
                  ≈ <span className="font-semibold text-navy">{inrEquivalent}</span>
                </p>
              )}
            </div>
            <p className="text-[12px] text-grey-2">
              {fxError
                ? fxError
                : draft.fxRate
                  ? draft.fxRateOverridden
                    ? "Entered by hand. This is the rate the papers will use."
                    : `Live rate from ${draft.fxRateSource || "the FX service"}${draft.fxRateAt ? ` · ${new Date(draft.fxRateAt).toLocaleString()}` : ""}. Type over it to use the rate you agreed.`
                  : "Fetch the live rate, or type the rate you agreed with the customer."}
            </p>
          </div>
        )}

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
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-bold text-navy">
          Special remarks <span className="text-[12px] font-normal text-grey-2">· section D</span>
        </h2>

        {/*
          ⚠ THREE BOXES, ONE GROUP. The master form scattered its free text across
            Q23 (balance heads), Q43 (other commitments) and Q46 (remarks), under
            three unrelated headings, so a salesperson had to remember which one
            a note belonged in. They are one section now, and Q46 takes the name
            the whole group carries.
        */}
        <FieldLabel label="Special remarks" hint="prints on both sheets">
          <TextArea
            rows={3}
            value={draft.remarks}
            onChange={(e) => patch({ remarks: e.target.value })}
            disabled={disabled}
          />
        </FieldLabel>

        {show("headBalanceRemarks") && (
          <FieldLabel label="Remarks — balance heads to be sold later">
            <TextArea
              rows={2}
              value={draft.headBalanceRemarks}
              onChange={(e) => patch({ headBalanceRemarks: e.target.value })}
              disabled={disabled}
            />
          </FieldLabel>
        )}

        <FieldLabel label="Any other commitments on charges made by us">
          <TextArea
            rows={2}
            value={draft.otherCommitments}
            onChange={(e) => patch({ otherCommitments: e.target.value })}
            disabled={disabled}
          />
        </FieldLabel>

        {/*
          ⚠ A DOLLAR TERM, ASKED ONLY OF DOLLAR DEALS. It used to be asked on
            every quotation, including rupee ones it cannot apply to — and the
            answer printed. `fms_ocpi_write_quotation` clears it on a non-USD
            deal, so switching currency cannot leave a stale "Yes" behind.
        */}
        {show("dollarClauseAgreed") && (
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
        )}
      </Card>

      {/*
        ═══ THE DETAILED SHEET'S OWN QUESTIONS ═══════════════════════════════
        Everything below was a SECOND FORM until the revision: the order
        confirmation was filled in later, at its own step, from its own screen.
        The client asked for one form, so it lives here.

        ⚠ EVERY FIELD BELOW IS OPTIONAL, DELIBERATELY. A quotation goes out
          during a negotiation, often before the warranty and delivery terms are
          settled. Anything left blank prints as a ruled blank on the detailed
          sheet, and the editor names those lines before the salesperson sends
          anything — see `missingForDetailSheet`. None of it blocks.
      */}
      <Card className="space-y-4 p-5">
        <div>
          <h2 className="text-[15px] font-bold text-navy">Document details</h2>
          <p className="mt-0.5 text-[12.5px] text-grey">
            Only the detailed sheet needs these. Leave any of them blank for now — the sheet prints a
            ruled blank, and you will be told which lines are empty before you send it.
          </p>
        </div>

        <div className="space-y-3">
          <h3 className="text-[13px] font-semibold text-ink">Warranty &amp; service</h3>
          <FieldLabel label="Printer warranty period">
            <Combobox
              value={draft.printerWarranty}
              onChange={(v) => patch({ printerWarranty: v })}
              options={opts(PRINTER_WARRANTY)}
              placeholder="Choose"
              clearable
              disabled={disabled}
            />
          </FieldLabel>
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldLabel label="Print-head warranty period">
              <Combobox
                value={draft.headWarranty}
                onChange={(v) => patch({ headWarranty: v })}
                options={opts(WARRANTY_MONTHS)}
                placeholder="Choose"
                clearable
                disabled={disabled}
              />
            </FieldLabel>
            <FieldLabel label="Head price after the warranty" hint="per head, plus GST">
              <TextInput
                value={draft.postWarrantyHeadPrice}
                onChange={(e) => patch({ postWarrantyHeadPrice: e.target.value.replace(/[^\d.]/g, "") })}
                inputMode="decimal"
                disabled={disabled}
              />
            </FieldLabel>
          </div>
          <FieldLabel label="Consumables to be bought from">
            <TextInput
              value={draft.consumablesSupplier}
              onChange={(e) => patch({ consumablesSupplier: e.target.value })}
              disabled={disabled}
            />
          </FieldLabel>
          <div className="rounded-lg border border-line bg-[#FBFCFE] p-3">
            <p className="text-[12.5px] leading-relaxed text-grey">{INSURANCE_CLAUSE}</p>
            <div className="mt-2">
              <YesNo
                label="Agreed with the customer"
                value={draft.insuranceClauseAgreed}
                onChange={(v) => patch({ insuranceClauseAgreed: v })}
                disabled={disabled}
              />
            </div>
          </div>
        </div>

        <div className="space-y-3 border-t border-line pt-4">
          <h3 className="text-[13px] font-semibold text-ink">Delivery &amp; tax</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <FieldLabel label="Delivery days">
              <TextInput
                value={draft.deliveryDays}
                onChange={(e) => patch({ deliveryDays: e.target.value })}
                placeholder="e.g. 45-60 days"
                disabled={disabled}
              />
            </FieldLabel>
            <FieldLabel label="Delivery term">
              <Combobox
                value={draft.tradeTerm}
                onChange={(v) => patch({ tradeTerm: v })}
                options={opts(TRADE_TERMS)}
                placeholder="Choose"
                clearable
                disabled={disabled}
              />
            </FieldLabel>
            {/* Hidden on a high seas sale — no GST applies, so no rate to ask for. */}
            {show("gstRate") && (
              <FieldLabel label="GST %">
                <TextInput
                  value={draft.gstRate}
                  onChange={(e) => patch({ gstRate: e.target.value.replace(/[^\d.]/g, "") })}
                  inputMode="decimal"
                  disabled={disabled}
                />
              </FieldLabel>
            )}
          </div>
        </div>

        {show("headShipMode") && (
          <div className="space-y-3 border-t border-line pt-4">
            <h3 className="text-[13px] font-semibold text-ink">The head</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldLabel label="How to ship the included head">
                <Combobox
                  value={draft.headShipMode}
                  onChange={(v) => patch({ headShipMode: v })}
                  options={optsKV(HEAD_SHIP_MODES)}
                  placeholder="Choose"
                  clearable
                  disabled={disabled}
                />
              </FieldLabel>
              {show("headShipVia") && (
                <FieldLabel label="Later shipment sent via">
                  <Combobox
                    value={draft.headShipVia}
                    onChange={(v) => patch({ headShipVia: v })}
                    options={optsKV(HEAD_SHIP_VIA)}
                    placeholder="Choose"
                    clearable
                    disabled={disabled}
                  />
                </FieldLabel>
              )}
            </div>
            <YesNo
              label="Separate invoice for the head"
              value={draft.headSeparateInvoice}
              onChange={(v) => patch({ headSeparateInvoice: v })}
              disabled={disabled}
            />
          </div>
        )}

        {show("dryerChambers") && (
          <div className="space-y-3 border-t border-line pt-4">
            <h3 className="text-[13px] font-semibold text-ink">The dryer</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldLabel label="How many chambers with the dryer">
                <TextInput
                  value={draft.dryerChambers}
                  onChange={(e) => patch({ dryerChambers: e.target.value })}
                  disabled={disabled}
                />
              </FieldLabel>
              <FieldLabel label="Heating mode">
                <TextInput
                  value={draft.heatingMode}
                  onChange={(e) => patch({ heatingMode: e.target.value })}
                  disabled={disabled}
                />
              </FieldLabel>
              <FieldLabel label="Platter">
                <Combobox
                  value={draft.platterDetails}
                  onChange={(v) => patch({ platterDetails: v })}
                  options={opts(PLATTER_OPTIONS)}
                  placeholder="Choose"
                  clearable
                  disabled={disabled}
                />
              </FieldLabel>
              <FieldLabel label="Dryer warranty period">
                <Combobox
                  value={draft.dryerWarranty}
                  onChange={(v) => patch({ dryerWarranty: v })}
                  options={opts(WARRANTY_MONTHS)}
                  placeholder="Choose"
                  clearable
                  disabled={disabled}
                />
              </FieldLabel>
            </div>
          </div>
        )}

        <div className="space-y-3 border-t border-line pt-4">
          <h3 className="text-[13px] font-semibold text-ink">Options included</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <YesNo
              label="Air blade"
              value={draft.airBlade}
              onChange={(v) => patch({ airBlade: v })}
              disabled={disabled}
            />
            <YesNo
              label="External centering system"
              value={draft.externalCentering}
              onChange={(v) => patch({ externalCentering: v })}
              disabled={disabled}
            />
            <YesNo
              label="Ink dust exhauster"
              value={draft.inkDustExhauster}
              onChange={(v) => patch({ inkDustExhauster: v })}
              disabled={disabled}
            />
            <YesNo
              label="Chilling system"
              value={draft.chillingSystem}
              onChange={(v) => patch({ chillingSystem: v })}
              disabled={disabled}
            />
          </div>
        </div>

        <div className="space-y-3 border-t border-line pt-4">
          <h3 className="text-[13px] font-semibold text-ink">Sign-off</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldLabel label="Reference no." hint="the customer's own reference, if they have one">
              <TextInput
                value={draft.refNo}
                onChange={(e) => patch({ refNo: e.target.value })}
                disabled={disabled}
              />
            </FieldLabel>
            <FieldLabel label="Manufacturer's model no." hint="pre-filled from the machine's template">
              <TextInput
                value={draft.machineModelNo}
                onChange={(e) => patch({ machineModelNo: e.target.value })}
                disabled={disabled}
              />
            </FieldLabel>
            <FieldLabel label="Prepared by">
              <TextInput
                value={draft.preparedBy}
                onChange={(e) => patch({ preparedBy: e.target.value })}
                disabled={disabled}
              />
            </FieldLabel>
            <FieldLabel label="Approved by">
              <TextInput
                value={draft.approvedBy}
                onChange={(e) => patch({ approvedBy: e.target.value })}
                disabled={disabled}
              />
            </FieldLabel>
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
        onRequested={(type, name) => {
          if (type === "machine") setMachineAsked(name);
        }}
      />

    </div>
  );
}
