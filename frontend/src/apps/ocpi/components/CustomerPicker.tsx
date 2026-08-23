import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Combobox from "@/shared/components/ui/Combobox";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import {
  OCPI_MASTERS_QK, fetchOcpiMasters, fetchLastContactFor, type OcpiParty,
} from "../data/ocpiMasters";
import type { QuotationDraft } from "../lib/fieldSpec";

/**
 * Pick the customer, from Tally or as a brand-new lead.
 *
 * ⚠ WHAT PICKING A CUSTOMER ACTUALLY GIVES YOU. mst_parties carries a name, a
 *   GSTIN on about a quarter of rows, and a company — and NOTHING ELSE:
 *   `address`, `email` and `phone` are empty on all 7,863 rows. So this fills in
 *   whatever Tally happens to hold and leaves the rest to be typed. It then
 *   asks fms_ocpi_last_contact_for for the details the LAST quotation to this
 *   customer recorded, which is how a repeat customer stops being retyped.
 *
 * ⚠ IT NEVER OVERWRITES WHAT SOMEONE HAS TYPED. Both fills are soft: a field
 *   that already has a value is left alone. A picker that clobbers a corrected
 *   address with a stale one teaches people not to use it.
 *
 * ⚠ A NEW LEAD IS NOT A LESSER CASE. Most machine deals start before the
 *   customer exists in Tally, so leaving the picker empty and typing a name is
 *   the normal path, not a fallback. `customerId` stays blank and the name is
 *   stored on the deal.
 */
export default function CustomerPicker({
  draft,
  patch,
  disabled,
}: {
  draft: QuotationDraft;
  patch: (p: Partial<QuotationDraft>) => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: OCPI_MASTERS_QK,
    queryFn: fetchOcpiMasters,
    // Tally syncs every 15 minutes; re-reading 7,863 rows more often than that
    // buys nothing.
    staleTime: 30 * 60 * 1000,
  });

  const parties = data?.parties ?? [];

  const options = useMemo<ComboOption[]>(
    () =>
      parties.map((p) => ({
        value: p.id,
        label: p.name,
        // The GSTIN is the one extra fact Tally reliably holds, and it is what
        // tells two similarly-named ledgers apart.
        sublabel: p.gstin ?? undefined,
      })),
    [parties],
  );

  async function choose(id: string) {
    if (!id) {
      // Cleared: this becomes a new lead. The typed name is deliberately KEPT —
      // clearing the picker is how someone converts a mis-picked customer into a
      // fresh lead, and wiping their work would punish that.
      patch({ customerId: "", companyId: "" });
      return;
    }

    const party = parties.find((p: OcpiParty) => p.id === id);
    if (!party) return;

    // Soft-fill: only what Tally actually holds, and only into empty fields.
    const next: Partial<QuotationDraft> = {
      customerId: party.id,
      customerName: party.name,
      companyId: party.companyId ?? "",
    };
    if (!draft.gstNo && party.gstin) {
      next.gstNo = party.gstin;
      next.gstAvailable = true;
    }
    if (!draft.customerAddress && party.address) next.customerAddress = party.address;
    if (!draft.customerEmail && party.email) next.customerEmail = party.email;
    if (!draft.customerMobile && party.phone) next.customerMobile = party.phone;
    if (!draft.customerAttn && party.contactName) next.customerAttn = party.contactName;
    patch(next);

    // Then whatever the last quotation to this customer recorded. This is where
    // the address usually comes from, Tally having none.
    setBusy(true);
    try {
      const last = await fetchLastContactFor(party.id);
      if (!last) return;
      const fill: Partial<QuotationDraft> = {};
      if (!draft.customerAddress && !party.address && last.customerAddress) {
        fill.customerAddress = last.customerAddress;
      }
      if (!draft.customerAttn && !party.contactName && last.customerAttn) {
        fill.customerAttn = last.customerAttn;
      }
      if (!draft.customerEmail && !party.email && last.customerEmail) {
        fill.customerEmail = last.customerEmail;
      }
      if (!draft.customerMobile && !party.phone && last.customerMobile) {
        fill.customerMobile = last.customerMobile;
      }
      if (!draft.gstNo && !party.gstin && last.gstNo) {
        fill.gstNo = last.gstNo;
        fill.gstAvailable = true;
      }
      if (Object.keys(fill).length > 0) patch(fill);
    } catch {
      // A prefill that fails is not an error the user needs to see — they simply
      // type the details, exactly as they would have before this existed.
    } finally {
      setBusy(false);
    }
  }

  const picked = parties.find((p) => p.id === draft.customerId);

  return (
    <div className="space-y-3">
      <FieldLabel
        label="Existing customer (Tally)"
        hint={picked && busy ? "looking up previous details…" : undefined}
      >
        <Combobox
          value={draft.customerId}
          onChange={(v) => void choose(v)}
          options={options}
          placeholder={isLoading ? "Loading customers…" : "Search the customer master…"}
          disabled={disabled || isLoading}
          searchable
          clearable
        />
        <p className="mt-1 text-[12px] text-grey-2">
          {picked
            ? busy
              ? "Filling in what we know about this customer…"
              : "Tally holds the name and GST only — the rest is remembered from the last quotation, or typed below."
            : "Leave this empty for a new lead and just type the name below."}
        </p>
      </FieldLabel>

      <FieldLabel label="Customer / party name" required>
        <TextInput
          value={draft.customerName}
          onChange={(e) => patch({ customerName: e.target.value })}
          placeholder="As it should appear on the quotation"
          disabled={disabled}
        />
      </FieldLabel>
    </div>
  );
}
