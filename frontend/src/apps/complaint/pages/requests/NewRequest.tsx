import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import SavedDraftsPanel, { SaveDraftButton } from "@/shared/components/ui/SavedDraftsPanel";
import { useSavedDrafts } from "@/shared/lib/useSavedDrafts";
import { appName } from "@/apps/appInfo";
import ComplaintFields, { ComplaintTypeCard, CREDIT_NOTE_CHOICE } from "../../components/ComplaintFields";
import CreditNoteForm from "../../components/CreditNoteForm";
import { useComplaintForm, type ComplaintDraft } from "./useComplaintForm";
import { requestHref } from "../../lib/routes";

/**
 * Raise a complaint — a thin shell over `useComplaintForm` + `ComplaintFields`,
 * matching the shape every other FMS intake uses.
 *
 * The route is guarded by `RequireRaise` in ComplaintApp: a hidden nav link is not
 * a guard, and this page renders a working Submit.
 *
 * Save as draft: the person's saved drafts sit above the form. Continue loads
 * one back, evidence files included; submitting it deletes the draft.
 */
export default function NewRequest() {
  const [params, setParams] = useSearchParams();
  // The fourth choice, Customer Credit Note, is a different form on its own
  // table. Kept in the URL so the bell / a bookmark can open it directly.
  if (params.get("type") === CREDIT_NOTE_CHOICE) {
    return (
      <div className="space-y-5 max-w-6xl">
        <div>
          <h1 className="text-[22px] font-bold text-navy">Raise a complaint</h1>
        </div>
        <ComplaintTypeCard
          value={CREDIT_NOTE_CHOICE}
          onChange={(v) => {
            if (v === CREDIT_NOTE_CHOICE) return;
            setParams({ from: v }, { replace: true });
          }}
        />
        <CreditNoteForm />
      </div>
    );
  }
  return <ComplaintRequestForm onPickCreditNote={() => setParams({ type: CREDIT_NOTE_CHOICE }, { replace: true })} />;
}

function ComplaintRequestForm({ onPickCreditNote }: { onPickCreditNote: () => void }) {
  const [params] = useSearchParams();
  const f = useComplaintForm();
  const navigate = useNavigate();
  // Coming back from the credit-note form: land on the type that was clicked.
  const from = params.get("from");
  useEffect(() => {
    if (from === "finished_good" || from === "raw_material" || from === "other_supplier") {
      f.setComplaintType(from);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from]);
  const drafts = useSavedDrafts<ComplaintDraft>("complaint:request");

  const saveDraft = () => {
    const v = f.form;
    // issueIdentifiedAt is pre-filled with now, so it alone doesn't make a draft.
    const typed = (Object.keys(v) as (keyof typeof v)[]).some(
      (k) => k !== "complaintType" && k !== "issueIdentifiedAt" && String(v[k]).trim() !== "",
    );
    if (!typed && f.files.length === 0) return Promise.reject(new Error("Nothing to save yet."));
    const party = v.partyName.trim();
    const what = v.problemDetails.trim() || v.itemName.trim() || v.lotNo.trim();
    return drafts.save({
      title: [party || "No party yet", what].filter(Boolean).join(" · ").slice(0, 120),
      payload: f.snapshot(),
      files: f.files,
    });
  };

  const continueDraft = (payload: ComplaintDraft, files: File[]) => {
    f.restore(payload);
    f.setFiles(files);
  };

  const onSubmit = async () => {
    const id = await f.submit();
    if (!id) return;
    await drafts.finish();
    navigate(requestHref(id));
  };

  return (
    <div className="space-y-5 max-w-6xl">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Raise a complaint</h1>
      </div>

      <SavedDraftsPanel api={drafts} onContinue={continueDraft} noun="complaint" />

      <ComplaintFields f={f} onPickCreditNote={onPickCreditNote} />

      {f.submitError && (
        <Card className="p-4 border-red-200 bg-red-50">
          <p className="text-[13px] font-semibold text-red-700">This complaint was not saved.</p>
          <p className="text-[12.5px] text-red-700/90 mt-1">{f.submitError}</p>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onSubmit} disabled={f.submitting}>
          {f.submitting ? "Submitting…" : "Submit complaint"}
        </Button>
        <SaveDraftButton api={drafts} onSave={saveDraft} disabled={f.submitting} />
        <Button variant="ghost" onClick={() => navigate(-1)} disabled={f.submitting}>
          Cancel
        </Button>
        {/* Shown only once Submit has been pressed — flagging every empty required
            field on a form nobody has filled in yet is noise, not help. */}
        {f.touched && !f.isValid && (
          <span className="text-[12.5px] text-red-600">
            Some required fields still need filling in.
          </span>
        )}
      </div>
    </div>
  );
}
