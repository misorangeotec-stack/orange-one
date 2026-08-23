import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import OrderConfirmationForm from "../../components/OrderConfirmationForm";
import { CompanyProfileWarning } from "../../components/SetupWarnings";
import { useOcpiStore } from "../../store";
import { freezeOc, saveOcDraft, submitOc, uploadOcPdf } from "../../data/ocpiWrites";
import { fetchDealById } from "../../data/ocpiFetch";
import { ocFileName, ocPdfBlob, resolvedOcDocument } from "../../lib/ocPdf";
import {
  EMPTY_OC, clearHiddenOc, missingForOc, ocFromDeal, ocPayload, withGst, type OcDraft,
} from "../../lib/ocFieldSpec";

/**
 * Fill in the order confirmation.
 *
 * ⚠ SAVE AND SUBMIT ARE DIFFERENT ACTS, as they are on the quotation. Save
 *   keeps the answers and mints nothing; submit allocates the OTPL/OC number and
 *   hands the deal to management. Only submit is gated on completeness.
 *
 * ⚠ THE GST FIGURES RECALCULATE AS YOU TYPE and are STORED, not derived when
 *   the document prints — a signed contract keeps the arithmetic it was signed
 *   under.
 */
export default function OrderConfirmationEditor() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const s = useOcpiStore();
  const deal = s.deals.find((d) => d.id === id);
  const machine = s.machineById(deal?.machineId ?? null);

  const seeded = useRef(false);
  const [draft, setDraft] = useState<OcDraft>(EMPTY_OC);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Seed once — a background refetch must not discard an in-progress edit.
  useEffect(() => {
    if (seeded.current || !deal) return;
    const loaded = ocFromDeal(deal);
    setDraft(
      withGst({
        ...loaded,
        // Sensible starting points that are still the salesperson's to change.
        machineModelNo: loaded.machineModelNo || machine?.machineModelNo || "",
        gstRate: loaded.gstRate || String(s.config.defaultGstRate),
      }),
    );
    seeded.current = true;
  }, [deal, machine, s.config.defaultGstRate]);

  const patch = useCallback((p: Partial<OcDraft>) => {
    setDraft((d) => withGst({ ...d, ...p }));
    setSavedAt(null);
  }, []);

  const missing = useMemo(() => missingForOc(draft), [draft]);

  if (!deal) {
    return (
      <Card className="p-6">
        <h1 className="text-[18px] font-bold text-navy">That deal is not available</h1>
        <Link to="/ocpi/deals" className="mt-1 inline-block text-[13.5px] font-semibold text-orange hover:underline">
          Back to all deals
        </Link>
      </Card>
    );
  }

  const editable = deal.status === "awaiting_order_confirmation" || deal.status === "rework";
  const noTemplate = machine ? !machine.hasTemplate : true;

  async function save() {
    if (!deal) return;
    setBusy(true);
    setError(null);
    try {
      await saveOcDraft(deal.id, ocPayload(clearHiddenOc(deal, draft)));
      await s.refresh();
      setSavedAt(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Save, submit, then render and freeze the document.
   *
   * ⚠ THE ORDER MATTERS. The RPC reads the ROW to decide what is missing and to
   *   mint the number, so the answers have to be saved first; and the PDF has to
   *   be rendered AFTER submit, because it prints the OC number the submit just
   *   allocated. The row is re-read from the database rather than from the store
   *   for the same reason — a closure created before the write is still holding
   *   the old copy.
   */
  async function submit() {
    if (!deal || !machine) return;
    setBusy(true);
    setError(null);
    try {
      await saveOcDraft(deal.id, ocPayload(clearHiddenOc(deal, draft)));
      await submitOc(deal.id);

      const fresh = await fetchDealById(deal.id);
      if (!fresh) throw new Error("The deal could not be re-read after submitting");

      const sections = s.sectionsFor(machine.id);
      const profile = s.profileFor(fresh.companyId);
      const docInput = {
        deal: fresh,
        machine,
        sections,
        profile,
        validityDays: s.config.quotationValidityDays,
      };

      // Freezing is what protects the signed copy from a later template edit, so
      // it happens even if storing the file fails.
      const document = resolvedOcDocument(docInput);
      let path: string | undefined;
      try {
        const blob = await ocPdfBlob(docInput);
        path = await uploadOcPdf(fresh.id, blob, ocFileName(fresh));
      } catch (e) {
        setError(
          `The order confirmation was submitted, but storing the PDF failed: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
      await freezeOc(fresh.id, document, path);

      await s.refresh();
      nav(`/ocpi/deals/${deal.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-navy">Order confirmation</h1>
          <p className="mt-0.5 text-[13.5px] text-grey-2">
            {deal.customerName} · {deal.quotationNo ?? "quotation"} approved
            {deal.ocNo ? ` · ${deal.ocNo}` : " · no number issued yet"}
          </p>
        </div>
        {editable && (
          <div className="flex items-center gap-2">
            {savedAt && !busy && <span className="text-[12.5px] text-grey-2">Saved</span>}
            <Button variant="ghost" onClick={() => void save()} disabled={busy}>
              {busy ? "Working…" : "Save"}
            </Button>
            <Button onClick={() => void submit()} disabled={busy || missing.length > 0 || noTemplate}>
              Send for approval
            </Button>
          </div>
        )}
      </div>

      {error && (
        <Card className="border-ryg-red/40 p-4">
          <p className="text-[13px] text-ryg-red">{error}</p>
        </Card>
      )}

      <CompanyProfileWarning companyId={deal.companyId} />

      {noTemplate && (
        <Card className="border-ryg-red/40 p-4">
          <p className="text-[13px] font-medium text-navy">
            {machine?.name ?? "This machine"} has no order-confirmation template yet
          </p>
          <p className="mt-1 text-[13px] text-grey">
            The quotation is fine, but there is nothing to print here until somebody builds the
            template.{" "}
            {s.isAdmin ? (
              <Link to={`/ocpi/machines/${machine?.id ?? ""}`} className="font-semibold text-orange hover:underline">
                Build it now
              </Link>
            ) : (
              "An admin can build one under Administration → Machines."
            )}
          </p>
        </Card>
      )}

      {!editable && (
        <Card className="p-4">
          <p className="text-[13px] text-grey">
            This order confirmation is no longer editable —{" "}
            {deal.ocNo ? `${deal.ocNo} has been submitted.` : "the deal has moved on."}{" "}
            <Link to={`/ocpi/deals/${deal.id}`} className="font-semibold text-orange hover:underline">
              Open the deal
            </Link>
          </p>
        </Card>
      )}

      {editable && missing.length > 0 && !noTemplate && (
        <Card className="p-4">
          <p className="text-[13px] font-medium text-navy">Still needed before this can be sent</p>
          <p className="mt-1 text-[13px] text-grey">
            {missing.join(", ")}. You can save what you have in the meantime.
          </p>
        </Card>
      )}

      <OrderConfirmationForm
        deal={deal}
        machine={machine}
        draft={draft}
        patch={patch}
        disabled={!editable}
      />
    </div>
  );
}
