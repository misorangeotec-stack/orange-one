import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import RequestForm from "../../components/RequestForm";
import { useProcurementStore } from "../../store";
import { useRequestForm } from "./useRequestForm";

/**
 * Stage 1 — raise a Purchase Request. Pick the buyer Company, then fill the
 * grid: each row picks its own Category → Item Group → Item, and Tab/Enter off
 * the end of a row starts the next one. The form lives in useRequestForm +
 * RequestForm, shared with EditRequest.
 */
export default function NewRequest() {
  const s = useProcurementStore();
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
        // The server takes the first line's category for the NOT NULL header.
        categoryId: null,
        note: form.note.trim() || null,
        items: form.filled.map((l) => ({
          itemId: l.itemId,
          categoryId: l.categoryId,
          quantity: Number(l.qty),
          unit: l.unit,
          lineRemark: l.remark.trim() || null,
        })),
      });
      navigate(`/procurement/requests/${id}`);
    } catch (e) {
      form.setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <h1 className="text-[22px] font-bold text-navy">New Purchase Request</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">Pick the company, then add the items you need — each row can be a different category.</p>
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
