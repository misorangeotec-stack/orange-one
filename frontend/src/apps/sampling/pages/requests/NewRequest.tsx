import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import SavedDraftsPanel, { SaveDraftButton } from "@/shared/components/ui/SavedDraftsPanel";
import { useSavedDrafts } from "@/shared/lib/useSavedDrafts";
import { useSamplingStore } from "../../store";
import SampleRequestFields from "../../components/SampleRequestFields";
import { isSampleBlank, useSampleRequestForm, type SampleDraft } from "./useSampleRequestForm";

/**
 * The in-app intake form — the branching sampling form built natively. State and
 * the fields live in useSampleRequestForm + SampleRequestFields.
 *
 * Save as draft: the person's saved drafts sit above the form (no separate
 * Drafts page). Continue loads one into the form; submitting it raises the
 * request as normal and deletes the draft. The form has no attachments.
 */
export default function NewRequest() {
  const s = useSamplingStore();
  const navigate = useNavigate();
  const form = useSampleRequestForm();
  const [busy, setBusy] = useState(false);
  const drafts = useSavedDrafts<SampleDraft>("sampling:request");

  const saveDraft = () => {
    const n = form.sampleItems.filter((r) => !isSampleBlank(r)).length;
    const product = form.productDesc.trim();
    const party = form.partyName.trim();
    if (
      !form.companyId && !form.direction && !form.receiveVia && !product && !party && n === 0 &&
      !form.desiredResult.trim() && !form.additionalInfo.trim()
    ) {
      return Promise.reject(new Error("Nothing to save yet."));
    }
    const dir = form.direction === "inward" ? "Inward" : form.direction === "outward" ? "Outward" : "";
    return drafts.save({
      title: [dir, product || "No product yet", party].filter(Boolean).join(" · "),
      payload: form.snapshot(),
    });
  };

  const continueDraft = (payload: SampleDraft) => {
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
      navigate(`/sampling/requests/${id}`);
    } catch (e) {
      form.setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Raise a sampling request</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          A few quick details and you're done. Inward samples are received then tested; outward samples are sent,
          confirmed and then tested.
        </p>
      </div>

      <SavedDraftsPanel api={drafts} onContinue={continueDraft} />

      <Card className="p-6">
        <SampleRequestFields form={form} />
        <div className="flex flex-wrap items-center justify-end gap-3 pt-5 mt-6 border-t border-line">
          <SaveDraftButton api={drafts} onSave={saveDraft} disabled={busy} />
          <Button size="sm" onClick={submit} disabled={busy}>
            {busy ? "Submitting…" : "Submit request"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
