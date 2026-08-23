import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOcpiStore } from "../../store";
import { fetchDealById } from "../../data/ocpiFetch";
import {
  generateQuotation as generateWrite,
  saveDraft as saveDraftWrite,
  uploadQuotationPdf,
} from "../../data/ocpiWrites";
import { clearHidden } from "../../lib/branching";
import { quotationFileName, quotationPdfBlob } from "../../lib/quotationPdf";
import {
  EMPTY_DRAFT, draftFromDeal, missingForSubmit, payloadFromDraft, type QuotationDraft,
} from "../../lib/fieldSpec";

/**
 * The quotation form's state, and the one place that knows how to save it.
 *
 * Shared by New Quotation and Edit Draft so the two cannot drift — the only
 * difference between them is whether they start from an existing row.
 *
 * ⚠ THE PAYLOAD IS RUN THROUGH `clearHidden` BEFORE IT LEAVES. Answer High Seas,
 *   pick CIF, then switch to Local Delivery: without this the form would send an
 *   answer the user can no longer see, and the row would carry it. The server
 *   nulls hidden fields too — that is the backstop — but sending a coherent
 *   payload keeps the form's own state, the draft it restores, and the row all
 *   telling the same story.
 *
 * ⚠ THE SALESPERSON DEFAULTS FROM `profiles.receivables_salespersons`. That tag
 *   already maps a portal user to their Tally salesperson name(s); inventing a
 *   second mapping for OCPI would be a second thing to keep in step. When the
 *   tag names exactly one person we prefill it, and it stays editable — a sales
 *   coordinator raising a quotation for someone else must be able to say so.
 */
export function useQuotationDraft(dealId?: string) {
  const s = useOcpiStore();
  const existing = dealId ? s.deals.find((d) => d.id === dealId) : undefined;

  const seeded = useRef(false);
  const [draft, setDraft] = useState<QuotationDraft>(EMPTY_DRAFT);
  const [savedId, setSavedId] = useState<string | null>(dealId ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Seed ONCE. Re-seeding on every store refresh would throw away whatever the
  // user has typed since the last save — react-query refetches in the
  // background, so this is not hypothetical.
  useEffect(() => {
    if (seeded.current) return;
    if (dealId) {
      if (!existing) return; // still loading
      setDraft(draftFromDeal(existing));
      seeded.current = true;
      return;
    }
    // Prefilled only when the tag names exactly ONE salesperson. Somebody tagged
    // with three has not told us which of them this deal belongs to, and picking
    // the first would be a guess printed on a customer's quotation.
    const tagged = s.salespersonTags;
    setDraft({
      ...EMPTY_DRAFT,
      salespersonName: tagged.length === 1 ? tagged[0] : "",
    });
    seeded.current = true;
  }, [dealId, existing, s]);

  const patch = useCallback((p: Partial<QuotationDraft>) => {
    setDraft((d) => ({ ...d, ...p }));
    setSavedAt(null);
  }, []);

  const missing = useMemo(() => missingForSubmit(draft), [draft]);

  const save = useCallback(async (): Promise<string | null> => {
    setBusy(true);
    setError(null);
    try {
      const payload = payloadFromDraft(clearHidden(draft));
      const id = await saveDraftWrite(payload, savedId);
      setSavedId(id);
      setSavedAt(new Date().toISOString());
      await s.refresh();
      return id;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, [draft, savedId, s]);

  /**
   * Save, then freeze a revision and produce the PDF.
   *
   * ⚠ SAVE FIRST, ALWAYS. The RPC reads the ROW to decide what is still missing
   *   and to build the frozen payload, so generating from unsaved form state
   *   would freeze a document that does not match the answers on record.
   *
   * ⚠ THE RESOLVED DOCUMENT IS CAPTURED HERE, from the same machine and profile
   *   the renderer is handed. That is the only place where the snapshot and the
   *   PDF are certain to agree.
   */
  const generate = useCallback(async (): Promise<Blob | null> => {
    setBusy(true);
    setError(null);
    try {
      const payload = payloadFromDraft(clearHidden(draft));
      const id = await saveDraftWrite(payload, savedId);
      setSavedId(id);

      const machine = s.machineById(draft.machineId || null);
      const profile = s.profileFor(draft.companyId || null);

      const documentPayload = {
        machine_name: machine?.name ?? null,
        doc_title: machine?.docTitle ?? null,
        machine_model_no: machine?.machineModelNo ?? null,
        supply_description: machine?.supplyDescription ?? null,
        spec_rows: machine?.specRows ?? [],
        composition: machine?.composition ?? [],
        sections: machine ? s.sectionsFor(machine.id).map((x) => ({ key: x.key, title: x.title, body: x.body })) : [],
        company_profile: profile
          ? {
              legal_name: profile.legalName,
              cin: profile.cin,
              registered_address: profile.registeredAddress,
              bank_name: profile.bankName,
              bank_branch: profile.bankBranch,
              bank_account_no: profile.bankAccountNo,
              bank_ifsc: profile.bankIfsc,
              ex_works_city: profile.exWorksCity,
              letterhead_path: profile.letterheadPath,
            }
          : null,
        quotation_validity_days: s.config.quotationValidityDays,
      };

      const versionNo = await generateWrite(id, payload, documentPayload);

      // ⚠ RE-READ THE ROW FROM THE DATABASE, NOT FROM THE STORE. `s` is the value
      //   this callback captured when it was created; `s.refresh()` gives the
      //   COMPONENT new data but leaves this closure holding the old array, so a
      //   brand-new deal is simply not in it. It also carries the quotation
      //   number the RPC just minted, which the form state does not.
      const rendered = await fetchDealById(id);
      if (!rendered) throw new Error("The quotation could not be re-read after generating");

      const blob = await quotationPdfBlob({ deal: rendered, machine, profile, versionNo });

      // A failed upload does not unwind the revision: it is already frozen, and
      // the PDF is deterministic, so it can be produced again at any time.
      try {
        await uploadQuotationPdf(id, versionNo, blob, quotationFileName(rendered, versionNo));
      } catch (e) {
        setError(
          `The quotation was generated, but storing a copy failed: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }

      // Refresh LAST, so the component picks up the minted number and the new
      // version row. Nothing above this line reads the store.
      await s.refresh();
      setSavedAt(new Date().toISOString());
      return blob;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, [draft, savedId, s]);

  return {
    draft,
    patch,
    save,
    generate,
    busy,
    error,
    savedId,
    savedAt,
    missing,
    /** True once the row exists in the database. */
    isPersisted: !!savedId,
    /** The row, when editing an existing draft. */
    existing,
  };
}
