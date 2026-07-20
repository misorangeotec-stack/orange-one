import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import EmptyState from "@/shared/components/ui/EmptyState";
import { useSuppliesStore } from "../../store";
import SupplyRequestFields from "../../components/SupplyRequestFields";
import { useSupplyRequestForm, type SupplyFormInit } from "./useSupplyRequestForm";

/**
 * Correct a submitted supply request — allowed only while nobody has acted
 * (awaiting first approval, or a no-approval request still awaiting handover).
 * The gate is re-checked server-side; this page's guard is a courtesy.
 *
 * The request stores the item as a NAME, not an id, so seeding the Item picker
 * means matching that name back to an item in the category — falling back to the
 * category's "Other" entry (with the name as free text) when it isn't a listed
 * item.
 */
export default function EditRequest() {
  const { id } = useParams();
  const s = useSuppliesStore();
  const navigate = useNavigate();

  const request = s.requestById(id ?? "");
  const editable = request ? s.requestEditable(request) : false;

  let init: SupplyFormInit | null = null;
  if (request && editable) {
    // Reverse-map the stored item/service name to a picker id.
    let itemId = "";
    let otherItem = "";
    let serviceTypeId = request.serviceTypeId ?? "";
    let otherService = "";

    if (request.requestType === "new_requirement" && request.categoryId) {
      const items = s.itemsForCategory(request.categoryId);
      const match = items.find((i) => i.name === request.itemName);
      const other = items.find((i) => i.name.toLowerCase() === "other");
      if (match) {
        itemId = match.id;
      } else if (other) {
        itemId = other.id;
        otherItem = request.itemName ?? "";
      }
    } else if (request.requestType === "services_maintenance" && serviceTypeId) {
      const svc = s.serviceTypeById(serviceTypeId);
      if ((svc?.name ?? "").toLowerCase() === "other") otherService = request.itemName ?? "";
    }

    init = {
      requestId: request.id,
      companyId: request.companyId,
      location: request.location,
      onBehalf: request.raisedOnBehalf,
      beneficiaryName: request.raisedOnBehalf ? request.requestedForName : "",
      beneficiaryUserId: request.requestedForUserId ?? "",
      requestType: request.requestType,
      categoryId: request.categoryId ?? "",
      itemId,
      otherItem,
      serviceTypeId,
      otherService,
      reason: request.reason ?? "",
      quantity: request.quantity,
    };
  }

  const form = useSupplyRequestForm(init);
  const [busy, setBusy] = useState(false);

  if (!request) {
    return (
      <EmptyState title="Request not found" message="It may have been removed." actionLabel="Back to My Requests" actionTo="/office-supplies/my-requests" />
    );
  }
  if (!editable) {
    return (
      <EmptyState
        title="This request can no longer be edited"
        message={
          request.status === "cancelled"
            ? "It has been cancelled."
            : "It has already been acted on. Only a request nobody has acted on yet can be changed."
        }
        actionLabel="Back to the request"
        actionTo={`/office-supplies/requests/${request.id}`}
      />
    );
  }

  const save = async () => {
    form.setErr(null);
    const built = form.build();
    if ("error" in built) return form.setErr(built.error);

    setBusy(true);
    try {
      await s.updateRequest(request.id, built.input);
      navigate(`/office-supplies/requests/${request.id}`);
    } catch (e) {
      form.setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <Link to={`/office-supplies/requests/${request.id}`} className="text-[12.5px] text-grey hover:text-navy">← {request.reqNo}</Link>
        <h1 className="text-[22px] font-bold text-navy mt-1">Edit {request.reqNo}</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Fix what you asked for while the request is still awaiting action. Changing the category may change whether it
          needs approval.
        </p>
      </div>

      <Card className="p-5 space-y-4">
        <SupplyRequestFields form={form} />
        <div className="flex justify-end gap-3 pt-1">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/office-supplies/requests/${request.id}`)} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
        </div>
      </Card>
    </div>
  );
}
