import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import SavedDraftsPanel, { SaveDraftButton } from "@/shared/components/ui/SavedDraftsPanel";
import { useSavedDrafts } from "@/shared/lib/useSavedDrafts";
import { useSuppliesStore } from "../../store";
import SupplyRequestFields from "../../components/SupplyRequestFields";
import { requestHref } from "../../lib/routes";
import { useSupplyRequestForm, type SupplyDraft } from "./useSupplyRequestForm";

/**
 * The in-app intake form — the branching MS-Form rebuilt natively. State and the
 * fields live in useSupplyRequestForm + SupplyRequestFields, shared with the
 * Edit screen.
 *
 * Save as draft: the person's saved drafts sit above the form (no separate
 * Drafts page). Continue loads one into the form; submitting it raises the
 * request as normal and deletes the draft. The form has no attachments.
 */
export default function NewRequest() {
  const s = useSuppliesStore();
  const navigate = useNavigate();
  const form = useSupplyRequestForm();
  const [busy, setBusy] = useState(false);
  const drafts = useSavedDrafts<SupplyDraft>("office-supplies:request");

  const saveDraft = () => {
    const what =
      form.requestType === "new_requirement"
        ? form.otherItem.trim() || form.itemOptions.find((o) => o.value === form.itemId)?.label
        : form.otherService.trim() || form.serviceOptions.find((o) => o.value === form.serviceTypeId)?.label;
    const company = form.companyOptions.find((o) => o.value === form.companyId)?.label;
    if (!form.companyId && !form.location && !what && !form.categoryId && !form.quantity.trim() && !form.reason.trim()) {
      return Promise.reject(new Error("Nothing to save yet."));
    }
    return drafts.save({
      title: [what ?? "No item yet", form.quantity.trim() && `qty ${form.quantity.trim()}`, company]
        .filter(Boolean)
        .join(" · "),
      summary: [
        `Company: ${company ?? "—"}${form.location ? ` · ${form.location}` : ""}`,
        `${form.requestType === "new_requirement" ? "Item" : "Service"}: ${what ?? "—"}`,
        ...(form.quantity.trim() ? [`Quantity: ${form.quantity.trim()}`] : []),
        ...(form.onBehalf && form.beneficiaryName ? [`On behalf of: ${form.beneficiaryName}`] : []),
        ...(form.reason.trim() ? [`Reason: ${form.reason.trim()}`] : []),
      ],
      payload: form.snapshot(),
    });
  };

  const continueDraft = (payload: SupplyDraft) => {
    form.setErr(null);
    form.restore(payload);
  };

  const submit = async () => {
    form.setErr(null);
    const built = form.build();
    if ("error" in built) return form.setErr(built.error);

    setBusy(true);
    try {
      const id = await s.submitRequest(built.input);
      await drafts.finish();
      navigate(requestHref(id));
    } catch (e) {
      form.setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Raise a purchase request</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Tell us what you need. Computer &amp; tech accessories go through two approvals; stationery, maintenance and
          services go straight to the handover team.
        </p>
      </div>

      <SavedDraftsPanel api={drafts} onContinue={continueDraft} />

      <Card className="p-5 space-y-4">
        <SupplyRequestFields form={form} />
        <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
          <SaveDraftButton api={drafts} onSave={saveDraft} disabled={busy} />
          <Button size="sm" onClick={submit} disabled={busy}>
            {busy ? "Submitting…" : "Submit request"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
