import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import SavedDraftsPanel, { SaveDraftButton } from "@/shared/components/ui/SavedDraftsPanel";
import { useSavedDrafts } from "@/shared/lib/useSavedDrafts";
import RequestForm from "../../components/RequestForm";
import { useImportStore } from "../../store";
import { useRequestForm, type RequestDraft } from "./useRequestForm";

/**
 * Stage 1 — raise an Import Purchase Request. Import has FIXED vendors, so there
 * is no sourcing: pick Company → Vendor → Shipment Type, then fill the grid. Each
 * row picks its own Category and Item, so one request may span categories. It is
 * a pure quantity requisition — no rate, exchange rate, or value on a line.
 *
 * The form itself lives in useRequestForm + RequestForm, shared with EditRequest.
 *
 * Save as draft: the person's saved drafts sit above the form (no separate
 * Drafts page). Continue loads one into the form; submitting it raises the
 * request as normal and deletes the draft. The form has no attachments.
 */
export default function NewRequest() {
  const s = useImportStore();
  const navigate = useNavigate();
  const form = useRequestForm({ mode: "new" });

  const [busy, setBusy] = useState(false);
  const drafts = useSavedDrafts<RequestDraft>("import:request");

  const saveDraft = () => {
    const company = form.companyOptions.find((o) => o.value === form.companyId)?.label;
    const vendor = form.vendorId ? s.vendorById(form.vendorId)?.name : undefined;
    const n = form.filled.length;
    if (!form.companyId && !form.vendorId && !form.shipmentType && n === 0 && !form.note.trim()) {
      return Promise.reject(new Error("Nothing to save yet."));
    }
    return drafts.save({
      title: `${vendor ?? company ?? "No vendor yet"} · ${n} item${n === 1 ? "" : "s"}`,
      summary: [
        `Company: ${company ?? "—"}`,
        `Vendor: ${vendor ?? "—"}`,
        ...form.filled.map((l) => {
          const it = s.itemById(l.itemId);
          return `${it?.name ?? "Item not picked"} — ${l.qty || "?"} ${l.unit}${l.remark.trim() ? ` (${l.remark.trim()})` : ""}`;
        }),
        ...(form.note.trim() ? [`Note: ${form.note.trim()}`] : []),
      ],
      payload: form.snapshot(),
    });
  };

  const continueDraft = (payload: RequestDraft) => {
    form.setErr(null);
    form.restore(payload);
  };

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
        shipmentType: form.shipmentType,
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
      await drafts.finish();
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
          Pick the company, the vendor and how the shipment travels, then fill the grid — each row has its own category.
          Press Tab or Enter at the end of a row to start the next one.
        </p>
      </div>

      <SavedDraftsPanel api={drafts} onContinue={continueDraft} />

      <RequestForm form={form}>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={submit} disabled={busy}>{busy ? "Submitting…" : "Submit request"}</Button>
          <SaveDraftButton api={drafts} onSave={saveDraft} disabled={busy} />
          <span className="text-[12.5px] text-grey-2">{form.filled.length} item{form.filled.length === 1 ? "" : "s"}</span>
        </div>
      </RequestForm>
    </div>
  );
}
