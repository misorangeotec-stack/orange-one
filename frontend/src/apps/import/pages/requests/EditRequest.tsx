import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import EmptyState from "@/shared/components/ui/EmptyState";
import RequestForm from "../../components/RequestForm";
import { useImportStore } from "../../store";
import { hydrateLine, useRequestForm, type RequestFormInit } from "./useRequestForm";

/**
 * Correct a request you already submitted — allowed only while nothing on it has
 * been decided. Reuses the New Request grid wholesale; the differences are that
 * Company / Vendor are locked (items are vendor-scoped, so changing the vendor is
 * a different request, not a correction) and that saving calls update_request,
 * which matches lines by id so each keeps its history, its SLA anchor and any
 * manual approver routing.
 *
 * The gate is re-checked server-side by the RPC — this page's guard is a
 * courtesy so the user sees a sentence instead of a rejection.
 */
export default function EditRequest() {
  const { id } = useParams();
  const s = useImportStore();
  const navigate = useNavigate();

  const request = s.requestById(id ?? null);
  const lines = request ? s.itemsForRequest(request.id) : [];
  const editable = request ? s.canEditRequest(request) : false;

  const init: RequestFormInit | null =
    request && editable
      ? {
          requestId: request.id,
          companyId: request.companyId,
          vendorId: request.vendorId ?? "",
          shipmentType: request.shipmentType ?? "",
          currency: request.currency ?? "",
          note: request.note ?? "",
          lines: lines.map(hydrateLine),
        }
      : null;

  // Hooks must run unconditionally, so the form is created before the guards.
  const form = useRequestForm({ mode: "edit", init });
  const [busy, setBusy] = useState(false);

  if (!request) {
    return (
      <EmptyState
        title="Request not found"
        message="It may have been removed."
        actionLabel="Back to Requests"
        actionTo="/import/requests"
      />
    );
  }
  if (!editable) {
    return (
      <EmptyState
        title="This request can no longer be edited"
        message={
          request.status === "cancelled"
            ? "It has been cancelled."
            : "A decision has already been recorded on at least one of its lines. Only a request that nobody has acted on yet can be changed."
        }
        actionLabel="Back to the request"
        actionTo={`/import/requests/${request.id}`}
      />
    );
  }

  const save = async () => {
    form.setErr(null);
    const invalid = form.validate();
    if (invalid) return form.setErr(invalid);

    setBusy(true);
    try {
      await s.updateRequest({
        requestId: request.id,
        note: form.note.trim() || null,
        shipmentType: form.shipmentType || null,
        items: form.filled.map((l) => ({
          // null id ⇒ a row added during this edit; the RPC inserts it.
          id: l.dbId,
          itemId: l.itemId,
          categoryId: l.categoryId,
          quantity: Number(l.qty),
          unit: l.unit,
          lineRemark: l.remark.trim() || null,
        })),
      });
      navigate(`/import/requests/${request.id}`);
    } catch (e) {
      form.setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 max-w-6xl">
      <div>
        <Link to={`/import/requests/${request.id}`} className="text-[12.5px] text-grey hover:text-navy">← {request.requestNo}</Link>
        <h1 className="text-[22px] font-bold text-navy mt-1">Edit {request.requestNo}</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Change quantities, items or the shipment type while the request is still awaiting approval. The company and
          vendor are fixed — raise a new request if those need to change.
        </p>
      </div>

      <RequestForm form={form}>
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
          <Button variant="ghost" onClick={() => navigate(`/import/requests/${request.id}`)} disabled={busy}>Cancel</Button>
          <span className="text-[12.5px] text-grey-2">{form.filled.length} item{form.filled.length === 1 ? "" : "s"}</span>
        </div>
      </RequestForm>
    </div>
  );
}
