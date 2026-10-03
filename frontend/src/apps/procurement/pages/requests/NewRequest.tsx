import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import SavedDraftsPanel, { SaveDraftButton } from "@/shared/components/ui/SavedDraftsPanel";
import { useSavedDrafts } from "@/shared/lib/useSavedDrafts";
import RequestForm from "../../components/RequestForm";
import { useProcurementStore } from "../../store";
import { useRequestForm, type RequestDraft } from "./useRequestForm";
import { toPendingDoc, uploadSourcingFiles } from "../../components/SourcingDocsCapture";

/**
 * Stage 1 — raise a Purchase Request. Pick the buyer Company, then fill the
 * grid: each row picks its own Category → Item Group → Item, and Tab/Enter off
 * the end of a row starts the next one. The form lives in useRequestForm +
 * RequestForm, shared with EditRequest.
 *
 * Save as draft: the person's saved drafts sit above the form (no separate
 * Drafts page). Continue loads one into the form, attachments included;
 * submitting it raises the request as normal and deletes the draft.
 */
export default function NewRequest() {
  const s = useProcurementStore();
  const navigate = useNavigate();
  const form = useRequestForm({ mode: "new" });
  const [busy, setBusy] = useState(false);
  // The request has no id until it is submitted, so its files go up under a
  // one-off folder key. Kept across retries so a retry re-uses what landed.
  const folderKey = useRef(crypto.randomUUID());
  const drafts = useSavedDrafts<RequestDraft>("procurement:request");

  const saveDraft = () => {
    const company = form.companyOptions.find((o) => o.value === form.companyId)?.label;
    const n = form.filled.length;
    if (!form.companyId && n === 0 && !form.note.trim() && form.files.length === 0) {
      return Promise.reject(new Error("Nothing to save yet."));
    }
    return drafts.save({
      title: `${company ?? "No company yet"} · ${n} item${n === 1 ? "" : "s"}`,
      summary: [
        `Company: ${company ?? "—"}`,
        ...form.filled.map((l) => {
          const it = form.itemById(l.itemId);
          return `${it?.name ?? "Item not picked"} — ${l.qty || "?"} ${l.unit}${l.remark.trim() ? ` (${l.remark.trim()})` : ""}`;
        }),
        ...(form.note.trim() ? [`Note: ${form.note.trim()}`] : []),
      ],
      payload: form.snapshot(),
      // New-request files are all still local picks.
      files: form.files.flatMap((f) => (f.kind === "pending" ? [f.file] : [])),
    });
  };

  const continueDraft = (payload: RequestDraft, files: File[]) => {
    form.setErr(null);
    form.restore(payload);
    form.setFiles(files.map((f, i) => toPendingDoc(f, i)));
  };

  const submit = async () => {
    form.setErr(null);
    const invalid = form.validate();
    if (invalid) return form.setErr(invalid);

    setBusy(true);
    try {
      // Upload FIRST: a failed upload leaves the form on screen, nothing raised.
      const docs = await uploadSourcingFiles(folderKey.current, form.files, s.uploadRequestDoc, form.setFiles);
      const id = await s.submitRequest({
        docs,
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
      // Before navigating: the entry exists now, so its draft must not come
      // back the next time someone opens New Request. clear() also blocks the
      // unmount flush, which would otherwise rewrite what we just removed.
      form.draft.clear();
      await drafts.finish();
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
