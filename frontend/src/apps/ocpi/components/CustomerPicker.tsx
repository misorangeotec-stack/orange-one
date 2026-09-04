import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Combobox from "@/shared/components/ui/Combobox";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { FIELD_ANCHOR } from "../lib/completeness";
import {
  OCPI_MASTERS_QK, fetchOcpiMasters, fetchLastContactFor, type OcpiParty,
} from "../data/ocpiMasters";
import type { QuotationDraft } from "../lib/fieldSpec";
import { useOcpiStore } from "../store";

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
  const s = useOcpiStore();
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
        /*
          The GSTIN is the one extra fact Tally reliably holds, and it is what
          tells two similarly-named ledgers apart.

          🔴 IT IS LABELLED, AND ITS ABSENCE IS SPELLED OUT (OCPI-42). Searching
             `AKLAVYA` returns TWO rows both reading `AKLAVYA INDUSTRIES
             PVT.LTD.` — one carrying `24AAGCS6274F1ZA`, one carrying nothing.
             A bare number under one of them and blank space under the other
             does not read as a difference; it reads as one row that happens to
             be taller. Naming it, and saying "no GST number in Tally" on the
             other, is what makes the pair distinguishable — and the wrong pick
             puts a contract out with no GST number on it, which OCPI-39 made
             visible on the paper.

          ⚠ `Combobox` searches the sublabel too, so a GSTIN typed into the box
            still finds its customer.
        */
        sublabel: p.gstin ? `GST ${p.gstin}` : "no GST number in Tally",
      })),
    [parties],
  );

  async function choose(id: string) {
    if (!id) {
      // Cleared: this becomes a new lead. The typed name is deliberately KEPT —
      // clearing the picker is how someone converts a mis-picked customer into a
      // fresh lead, and wiping their work would punish that.
      //
      // ⚠ THE SELLING ENTITY IS KEPT TOO, now that it is a field the salesperson
      //   can set. It used to be cleared because only a Tally party could supply
      //   it, so a cleared party meant a meaningless value; today a new lead is
      //   exactly the case where somebody has to choose the entity by hand, and
      //   clearing it would throw that choice away.
      patch({ customerId: "" });
      return;
    }

    const party = parties.find((p: OcpiParty) => p.id === id);
    if (!party) return;

    // Soft-fill: only what Tally actually holds, and only into empty fields.
    const next: Partial<QuotationDraft> = {
      customerId: party.id,
      customerName: party.name,
    };
    // The party's company is the DEFAULT selling entity, not the last word — the
    // form now shows it and lets it be changed. Only overwrite when Tally has one:
    // `?? ""` used to blank a deliberate choice for the ~10 parties it does not.
    //
    // ⚠ AND ONLY WHEN THAT COMPANY IS A CONFIGURED SELLING ENTITY. Four of the
    //   five Tally companies have no profile, so copying one here would put a
    //   value on the draft that the Selling entity field no longer offers —
    //   the reader would see a company marked "not set up" that they never
    //   chose. Left blank instead, which the form already explains, naming the
    //   default entity it will print.
    if (party.companyId && s.companyProfiles.some((p) => p.companyId === party.companyId && p.active)) {
      next.companyId = party.companyId;
    }
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
        {/*
          ⚠ THE TRIGGER SHOWS THE LABEL ALONE. `Combobox` renders the sublabel in
            the open list and nowhere else, so the GSTIN that told two identical
            ledgers apart disappears the moment one is chosen — leaving no way to
            check the pick without reopening the list. It is repeated here.
        */}
        {picked && !busy && (
          <p className="mt-1 text-[12px]">
            {picked.gstin ? (
              <span className="text-grey-2">
                GST <span className="font-medium text-navy">{picked.gstin}</span>
              </span>
            ) : (
              <span className="text-amber-700">
                This Tally ledger carries no GST number — check it is the right one, and
                enter the GST below if the customer has one.
              </span>
            )}
          </p>
        )}
        <p className="mt-1 text-[12px] text-grey-2">
          {picked
            ? busy
              ? "Filling in what we know about this customer…"
              : "Tally holds the name and GST only — the rest is remembered from the last quotation, or typed below."
            : "Leave this empty for a new lead and just type the name below."}
        </p>
      </FieldLabel>

      {/* ⚠ ALWAYS REQUIRED, so it does not read `requiredKeys` — there is no
          state of this form in which a quotation may be addressed to nobody, and
          threading the set in for one unconditional field would be ceremony. The
          anchor is what matters here: it is the first entry the missing-answers
          panel jumps to. */}
      <FieldLabel
        label="Customer / party name"
        required
        anchor={FIELD_ANCHOR("customerName")}
      >
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
