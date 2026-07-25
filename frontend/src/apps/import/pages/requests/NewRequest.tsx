import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import RequestForm from "../../components/RequestForm";
import { useImportStore } from "../../store";
import { useRequestForm } from "./useRequestForm";

/**
 * Stage 1 — raise an Import Purchase Request. Import has FIXED vendors, so there
 * is no sourcing: pick Company → Vendor, then fill the grid. Each row picks its
 * own Category and Item, so one request may span categories. It is a pure
 * quantity requisition — there is no rate, exchange rate, or value on a line.
 *
 * The form itself lives in useRequestForm + RequestForm, shared with EditRequest.
 */
export default function NewRequest() {
  const s = useImportStore();
  const navigate = useNavigate();
  const form = useRequestForm({ mode: "new" });

  const [busy, setBusy] = useState(false);

  const submit = async () => {
    form.setErr(null);
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
        note: form.note.trim() || null,
        items: form.filled.map((l) => ({
          itemId: l.itemId,
          categoryId: l.categoryId,
          quantity: Number(l.qty),
          unit: l.unit,
          lineRemark: l.remark.trim() || null,
        })),
      });
      navigate(`/import/requests/${id}`);
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
          Pick the company and vendor, then fill the grid — each row has its own category. Press Tab or Enter at the end
          of a row to start the next one.
        </p>
      </div>

      <RequestForm form={form}>
        <div className="flex items-center gap-3">
          <Button onClick={submit} disabled={busy}>{busy ? "Submitting…" : "Submit request"}</Button>
          <span className="text-[12.5px] text-grey-2">{form.filled.length} item{form.filled.length === 1 ? "" : "s"}</span>
        </div>
      </RequestForm>
    </div>
  );
}
