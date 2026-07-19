import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import RequestForm from "../../components/RequestForm";
import { useImportStore } from "../../store";
import { useRequestForm } from "./useRequestForm";

/**
 * Stage 1 — raise an Import Purchase Request. Import has FIXED vendors and fixed
 * vendor-item pricing, so there is no sourcing: pick Company → Vendor, then fill
 * the grid. Each row picks its own Category and Item, so one request may span
 * categories. A priced item auto-fills its rate; an unpriced one takes a typed
 * rate that can be saved back to the price list. A live foreign→INR exchange
 * rate (from xe.com via the Edge Function, editable) turns each line into an INR
 * value so the approval tier can route it.
 *
 * The form itself lives in useRequestForm + RequestForm, shared with EditRequest.
 */
export default function NewRequest() {
  const s = useImportStore();
  const navigate = useNavigate();
  const form = useRequestForm({ mode: "new" });

  const [busy, setBusy] = useState(false);
  /** Set when the request saved but one or more price-list writes did not. */
  const [partial, setPartial] = useState<{ id: string; failures: string[] } | null>(null);

  const submit = async () => {
    form.setErr(null);
    setPartial(null);
    const invalid = form.validate();
    if (invalid) return form.setErr(invalid);

    setBusy(true);
    try {
      const id = await s.submitRequest({
        companyId: form.companyId,
        vendorId: form.vendorId,
        // The server takes the first line's category for the (NOT NULL) header.
        categoryId: null,
        currency: form.currency.trim().toUpperCase(),
        fxRate: Number(form.fxRate),
        note: form.note.trim() || null,
        items: form.filled.map((l) => ({
          itemId: l.itemId,
          categoryId: l.categoryId,
          quantity: Number(l.qty),
          unit: l.unit,
          rate: Number(l.rate),
          lineRemark: l.remark.trim() || null,
        })),
      });

      // Price-list writes are a side effect of the request, never a gate on it —
      // the request is already saved by this point.
      const failures = await form.savePriceList();
      if (failures.length === 0) {
        navigate(`/import/requests/${id}`);
        return;
      }
      setPartial({ id, failures });
      setBusy(false);
    } catch (e) {
      form.setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 max-w-6xl">
      <div>
        <h1 className="text-[22px] font-bold text-navy">New Import Request</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Pick the company and vendor, then fill the grid — each row has its own category, and the rate auto-fills from
          the price list. Press Tab or Enter at the end of a row to start the next one.
        </p>
      </div>

      <RequestForm form={form}>
        {partial && (
          <div className="rounded-xl border border-ryg-amber/50 bg-ryg-amber/10 p-3 text-[12.5px] space-y-1">
            <p className="font-semibold text-navy">
              The request was created. {partial.failures.length} price{partial.failures.length === 1 ? "" : "s"} couldn't be saved to the price list:
            </p>
            <ul className="list-disc pl-5 text-grey">
              {partial.failures.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
            <p className="text-grey-2">The request itself is unaffected.</p>
            <button type="button" className="text-teal underline" onClick={() => navigate(`/import/requests/${partial.id}`)}>
              Open the request →
            </button>
          </div>
        )}

        <div className="flex items-center gap-3">
          <Button onClick={submit} disabled={busy}>{busy ? "Submitting…" : "Submit request"}</Button>
          <span className="text-[12.5px] text-grey-2">{form.filled.length} item{form.filled.length === 1 ? "" : "s"}</span>
        </div>
      </RequestForm>
    </div>
  );
}
