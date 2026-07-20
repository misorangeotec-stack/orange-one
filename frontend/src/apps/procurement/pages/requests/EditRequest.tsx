import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import EmptyState from "@/shared/components/ui/EmptyState";
import RequestForm from "../../components/RequestForm";
import { useProcurementStore } from "../../store";
import { hydrateLine, useRequestForm, type RequestFormInit } from "./useRequestForm";

/**
 * Correct a request you already submitted — allowed only before any buyer
 * sources it. Reuses the New Request grid; Company is locked. Saving calls
 * update_request, which matches lines by id so each keeps its identity.
 * The gate is re-checked server-side by the RPC — this page's guard is a
 * courtesy so the user sees a sentence instead of a rejection.
 */
export default function EditRequest() {
  const { id } = useParams();
  const s = useProcurementStore();
  const navigate = useNavigate();

  const request = s.requestById(id ?? null);
  const lines = request ? s.itemsForRequest(request.id) : [];
  const editable = request ? s.canEditRequest(request) : false;

  const groupIdOfItem = (itemId: string) => s.itemById(itemId)?.itemGroupId ?? "";

  const init: RequestFormInit | null =
    request && editable
      ? {
          requestId: request.id,
          companyId: request.companyId,
          note: request.note ?? "",
          lines: lines.map((l) => hydrateLine(l, groupIdOfItem)),
        }
      : null;

  // Hooks run unconditionally, so the form is created before the guards.
  const form = useRequestForm({ mode: "edit", init });
  const [busy, setBusy] = useState(false);

  if (!request) {
    return (
      <EmptyState
        title="Request not found"
        message="It may have been removed."
        actionLabel="Back to Requests"
        actionTo="/procurement/requests"
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
            : "Sourcing has already begun on at least one of its lines. Only a request that nobody has sourced yet can be changed."
        }
        actionLabel="Back to the request"
        actionTo={`/procurement/requests/${request.id}`}
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
        items: form.filled.map((l) => ({
          id: l.dbId,
          itemId: l.itemId,
          categoryId: l.categoryId,
          quantity: Number(l.qty),
          unit: l.unit,
          lineRemark: l.remark.trim() || null,
        })),
      });
      navigate(`/procurement/requests/${request.id}`);
    } catch (e) {
      form.setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <Link to={`/procurement/requests/${request.id}`} className="text-[12.5px] text-grey hover:text-navy">← {request.requestNo}</Link>
        <h1 className="text-[22px] font-bold text-navy mt-1">Edit {request.requestNo}</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Change items or quantities while the request is still awaiting sourcing. The company is fixed — raise a new
          request if that needs to change.
        </p>
      </div>

      <RequestForm form={form}>
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
          <Button variant="ghost" onClick={() => navigate(`/procurement/requests/${request.id}`)} disabled={busy}>Cancel</Button>
          <span className="text-[12.5px] text-grey-2">{form.filled.length} item{form.filled.length === 1 ? "" : "s"}</span>
        </div>
      </RequestForm>
    </div>
  );
}
