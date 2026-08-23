import Card from "@/shared/components/ui/Card";
import Combobox from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { fmtDealValue } from "../lib/format";
import {
  HEAD_SHIP_MODES, HEAD_SHIP_VIA, INSURANCE_CLAUSE, PLATTER_OPTIONS, PRINTER_WARRANTY,
  TRADE_TERMS, WARRANTY_MONTHS, ocVisible, type OcDraft,
} from "../lib/ocFieldSpec";
import type { OcpiDeal, OcpiMachine } from "../types";

/**
 * Part B — everything the order confirmation needs that the quotation did not
 * already answer.
 *
 * ⚠ THE QUOTATION'S ANSWERS ARE SHOWN, NOT ASKED AGAIN. The panel at the top is
 *   read-only and exists so the person filling this in can see what was agreed
 *   without opening another screen. Re-asking any of it would invite two
 *   answers to one question on a single contract.
 *
 * ⚠ WHOLE GROUPS DISAPPEAR BASED ON THE QUOTATION. No head in the deal ⇒ no
 *   head-shipment questions. "Not Applicable" dryer ⇒ no chambers, no heating
 *   mode, no dryer warranty. The database nulls the same fields on write, so a
 *   changed answer cannot leave a stale one behind on a contract.
 */

function YesNo({
  label, value, onChange, disabled, hint,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <FieldLabel label={label} hint={hint}>
      <div className="flex gap-2">
        {[{ v: true, t: "Yes" }, { v: false, t: "No" }].map((o) => (
          <button
            key={o.t}
            type="button"
            disabled={disabled}
            onClick={() => onChange(o.v)}
            className={[
              "h-9 min-w-[68px] rounded-lg border px-3 text-[13px] font-medium transition",
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
const optsKV = (xs: readonly { value: string; label: string }[]) =>
  xs.map((x) => ({ value: x.value, label: x.label }));

const money = (v: string): string => {
  const n = Number(v);
  return Number.isFinite(n) && v.trim() !== "" ? `₹ ${n.toLocaleString("en-IN")}` : "—";
};

export default function OrderConfirmationForm({
  deal,
  machine,
  draft,
  patch,
  disabled,
}: {
  deal: OcpiDeal;
  machine?: OcpiMachine;
  draft: OcDraft;
  patch: (p: Partial<OcDraft>) => void;
  disabled?: boolean;
}) {
  const show = (k: keyof OcDraft) => ocVisible(k, deal, draft);

  return (
    <div className="space-y-4">
      {/* ── What the quotation already settled ──────────────────────────── */}
      <Card className="p-5">
        <h2 className="text-[15px] font-bold text-navy">Carried over from the quotation</h2>
        <p className="mt-0.5 text-[13px] text-grey-2">
          Agreed on {deal.quotationNo ?? "the quotation"}. Change any of it by editing the quotation
          itself, not here.
        </p>
        <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-3">
          {[
            ["Customer", deal.customerName ?? "—"],
            ["Machine", machine?.name ?? "—"],
            ["No. of machines", deal.machineCount === null ? "—" : String(deal.machineCount)],
            ["Print heads", deal.headCount === null ? "—" : String(deal.headCount)],
            ["Ink", deal.inkType ?? "—"],
            ["Dryer", deal.dryerType ?? "—"],
            ["Head included", deal.inclHead === null ? "—" : deal.inclHead ? "Yes" : "No"],
            ["Deal value", fmtDealValue(deal.dealValueAmount, deal.dealValueCurrency) || "—"],
            ["Transport", deal.transportTerms === "high_seas" ? "High Seas" : deal.transportTerms === "local" ? "Local Delivery" : "—"],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">{k}</dt>
              <dd className="mt-0.5 text-[13.5px] font-medium text-navy">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {/* ── Document header ─────────────────────────────────────────────── */}
      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-bold text-navy">Document details</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel label="Reference no." hint="printed as Ref: on the confirmation">
            <TextInput value={draft.refNo} onChange={(e) => patch({ refNo: e.target.value })} disabled={disabled} />
          </FieldLabel>
          <FieldLabel label="Manufacturer's model no." hint={machine?.machineModelNo ? `template default: ${machine.machineModelNo}` : undefined}>
            <TextInput
              value={draft.machineModelNo}
              onChange={(e) => patch({ machineModelNo: e.target.value })}
              placeholder={machine?.machineModelNo ?? ""}
              disabled={disabled}
            />
          </FieldLabel>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel label="Delivery term" required>
            <Combobox
              value={draft.tradeTerm}
              onChange={(v) => patch({ tradeTerm: v })}
              options={opts(TRADE_TERMS)}
              placeholder="Choose or type"
              searchable
              clearable
              disabled={disabled}
              onCreate={(l) => { patch({ tradeTerm: l }); return l; }}
              createLabel={(q) => `Use “${q}”`}
            />
          </FieldLabel>
          <FieldLabel label="Delivery days" required hint="how long after the order">
            <TextInput
              value={draft.deliveryDays}
              onChange={(e) => patch({ deliveryDays: e.target.value })}
              placeholder="e.g. 60 days"
              disabled={disabled}
            />
          </FieldLabel>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel label="Prepared by">
            <TextInput value={draft.preparedBy} onChange={(e) => patch({ preparedBy: e.target.value })} disabled={disabled} />
          </FieldLabel>
          <FieldLabel
            label={machine?.signoffStyle === "checked_by" ? "Checked by" : "Approved by"}
            hint="as it should print on the signature block"
          >
            <TextInput value={draft.approvedBy} onChange={(e) => patch({ approvedBy: e.target.value })} disabled={disabled} />
          </FieldLabel>
        </div>
      </Card>

      {/* ── The money ───────────────────────────────────────────────────── */}
      <Card className="space-y-4 p-5">
        <div>
          <h2 className="text-[15px] font-bold text-navy">Value in rupees</h2>
          <p className="mt-0.5 text-[13px] text-grey-2">
            The confirmation prints in rupees.{" "}
            {deal.dealValueCurrency === "USD"
              ? `The quotation was agreed in dollars (${fmtDealValue(deal.dealValueAmount, "USD")}), so the rupee figure has to be stated here.`
              : "It defaults to nothing rather than copying the quoted figure, so somebody has to confirm it."}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <FieldLabel label="Machine value (₹)" required>
            <TextInput
              inputMode="decimal"
              value={draft.machineValueInr}
              onChange={(e) => patch({ machineValueInr: e.target.value.replace(/[^\d.]/g, "") })}
              disabled={disabled}
            />
          </FieldLabel>
          <FieldLabel label="GST %">
            <TextInput
              inputMode="decimal"
              value={draft.gstRate}
              onChange={(e) => patch({ gstRate: e.target.value.replace(/[^\d.]/g, "") })}
              disabled={disabled}
            />
          </FieldLabel>
          <div>
            <span className="mb-1.5 block text-[13px] font-medium text-navy">Total</span>
            <div className="rounded-xl border border-line bg-[#FBFCFE] px-3.5 py-2.5 text-[13.5px]">
              <div className="text-grey-2">GST {money(draft.gstAmountInr)}</div>
              <div className="font-semibold text-navy">{money(draft.totalInr)}</div>
            </div>
          </div>
        </div>
      </Card>

      {/* ── Head shipment ───────────────────────────────────────────────── */}
      {show("headShipMode") && (
        <Card className="space-y-4 p-5">
          <div>
            <h2 className="text-[15px] font-bold text-navy">The included head</h2>
            <p className="mt-0.5 text-[13px] text-grey-2">
              The quotation included {deal.headsIncluded ?? "some"} head
              {deal.headsIncluded === 1 ? "" : "s"} in the deal.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldLabel label="How to ship it">
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
          <FieldLabel label="Remarks — balance heads to be sold later">
            <TextArea
              rows={2}
              value={draft.headBalanceRemarks}
              onChange={(e) => patch({ headBalanceRemarks: e.target.value })}
              disabled={disabled}
            />
          </FieldLabel>
        </Card>
      )}

      {/* ── Dryer ───────────────────────────────────────────────────────── */}
      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-bold text-navy">Dryer &amp; platter</h2>
        {show("dryerChambers") ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <FieldLabel label="How many chambers">
              <TextInput value={draft.dryerChambers} onChange={(e) => patch({ dryerChambers: e.target.value })} disabled={disabled} />
            </FieldLabel>
            <FieldLabel label="Heating mode" hint="e.g. Gas, Electric, Oil">
              <TextInput value={draft.heatingMode} onChange={(e) => patch({ heatingMode: e.target.value })} disabled={disabled} />
            </FieldLabel>
            <FieldLabel label="Dryer warranty">
              <Combobox
                value={draft.dryerWarranty}
                onChange={(v) => patch({ dryerWarranty: v })}
                options={opts(WARRANTY_MONTHS)}
                placeholder="Choose or type"
                searchable
                clearable
                disabled={disabled}
                onCreate={(l) => { patch({ dryerWarranty: l }); return l; }}
                createLabel={(q) => `Use “${q}”`}
              />
            </FieldLabel>
          </div>
        ) : (
          <p className="text-[13px] text-grey-2">
            The quotation says no dryer applies, so the chamber, heating and dryer-warranty questions
            do not arise.
          </p>
        )}
        <FieldLabel label="Platter">
          <Combobox
            value={draft.platterDetails}
            onChange={(v) => patch({ platterDetails: v })}
            options={opts(PLATTER_OPTIONS)}
            placeholder="Choose or type"
            searchable
            clearable
            disabled={disabled}
            onCreate={(l) => { patch({ platterDetails: l }); return l; }}
            createLabel={(q) => `Use “${q}”`}
          />
        </FieldLabel>
      </Card>

      {/* ── Options ─────────────────────────────────────────────────────── */}
      <Card className="space-y-4 p-5">
        <div>
          <h2 className="text-[15px] font-bold text-navy">Optional equipment</h2>
          <p className="mt-0.5 text-[13px] text-grey-2">
            Only what this customer is buying. These print on the confirmation as part of what is
            supplied, so a Yes here is a promise.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <YesNo label="Air blade" value={draft.airBlade} onChange={(v) => patch({ airBlade: v })} disabled={disabled} />
          <YesNo label="External centering" value={draft.externalCentering} onChange={(v) => patch({ externalCentering: v })} disabled={disabled} />
          <YesNo label="Ink dust exhauster" value={draft.inkDustExhauster} onChange={(v) => patch({ inkDustExhauster: v })} disabled={disabled} />
          <YesNo label="Chilling system" value={draft.chillingSystem} onChange={(v) => patch({ chillingSystem: v })} disabled={disabled} />
        </div>
      </Card>

      {/* ── Warranty ────────────────────────────────────────────────────── */}
      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-bold text-navy">Warranty &amp; commitments</h2>
        <FieldLabel label="Printer warranty period" required>
          <Combobox
            value={draft.printerWarranty}
            onChange={(v) => patch({ printerWarranty: v })}
            options={opts(PRINTER_WARRANTY)}
            placeholder="Choose or type"
            searchable
            clearable
            wrapLabel
            disabled={disabled}
            onCreate={(l) => { patch({ printerWarranty: l }); return l; }}
            createLabel={(q) => `Use “${q}”`}
          />
        </FieldLabel>
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel label="Print-head warranty period">
            <Combobox
              value={draft.headWarranty}
              onChange={(v) => patch({ headWarranty: v })}
              options={opts(WARRANTY_MONTHS)}
              placeholder="Choose or type"
              searchable
              clearable
              disabled={disabled}
              onCreate={(l) => { patch({ headWarranty: l }); return l; }}
              createLabel={(q) => `Use “${q}”`}
            />
          </FieldLabel>
          <FieldLabel label="Head price after the warranty (₹)" hint="prints in the print-head policy">
            <TextInput
              inputMode="decimal"
              value={draft.postWarrantyHeadPrice}
              onChange={(e) => patch({ postWarrantyHeadPrice: e.target.value.replace(/[^\d.]/g, "") })}
              disabled={disabled}
            />
          </FieldLabel>
        </div>
        <FieldLabel label="Consumables to be bought from" hint="named in the warranty clause on some templates">
          <TextInput
            value={draft.consumablesSupplier}
            onChange={(e) => patch({ consumablesSupplier: e.target.value })}
            placeholder="M/s …"
            disabled={disabled}
          />
        </FieldLabel>
        <FieldLabel label="Other commitments made" hint="description and amount">
          <TextArea
            rows={2}
            value={draft.otherCommitments}
            onChange={(e) => patch({ otherCommitments: e.target.value })}
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
      </Card>
    </div>
  );
}
