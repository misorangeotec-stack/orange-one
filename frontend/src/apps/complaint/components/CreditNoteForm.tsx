import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import Combobox from "@/shared/components/ui/Combobox";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import SavedDraftsPanel, { SaveDraftButton } from "@/shared/components/ui/SavedDraftsPanel";
import { useSavedDrafts } from "@/shared/lib/useSavedDrafts";
import { useSession } from "@/core/platform/session";
import { useComplaintStore } from "../store";
import { creditNotesHref } from "../lib/routes";

/**
 * Raise a Customer Credit Note — the fourth option on "Raise a complaint".
 *
 *   Customer name · Reason for credit note · Amount · Full details
 *
 * Submit sends it to MANAGEMENT APPROVAL (Setup step `cn_approval`); once
 * approved it waits in the TALLY bucket (`cn_tally`), which records the Tally
 * no., an attachment and a remark and closes it.
 */
interface CnForm {
  companyId: string;
  partyId: string;
  partyName: string;
  reason: string;
  amount: string;
  details: string;
}

const EMPTY: CnForm = { companyId: "", partyId: "", partyName: "", reason: "", amount: "", details: "" };

function ErrorText({ children }: { children: string }) {
  if (!children) return null;
  return <p className="mt-1 text-[12px] text-red-600">{children}</p>;
}

export default function CreditNoteForm() {
  const s = useComplaintStore();
  const { user } = useSession();
  const navigate = useNavigate();
  const drafts = useSavedDrafts<CnForm>("complaint:credit-note");
  const [form, setForm] = useState<CnForm>(EMPTY);
  const [files, setFiles] = useState<File[]>([]);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const set = <K extends keyof CnForm>(k: K, v: CnForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const amount = Number(form.amount.replace(/,/g, ""));
  const errors: Partial<Record<keyof CnForm, string>> = {};
  if (!form.partyName.trim()) errors.partyName = "Customer name is required.";
  if (!form.reason.trim()) errors.reason = "Reason for credit note is required.";
  if (!form.amount.trim()) errors.amount = "Amount of the credit note is required.";
  else if (!Number.isFinite(amount) || amount <= 0) errors.amount = "Enter an amount more than zero.";
  if (!form.details.trim()) errors.details = "Full details are required.";
  const isValid = Object.keys(errors).length === 0;
  const err = (k: keyof CnForm) => (touched ? (errors[k] ?? "") : "");

  const companyOpts = s.companies.map((c) => ({ value: c.id, label: c.name }));
  const customers = s.partiesFor(form.companyId || null, "finished_good", form.partyId || null);
  const partyOpts = customers.map((p) => ({ value: p.id, label: p.name }));

  const saveDraft = () => {
    const typed = (Object.keys(form) as (keyof CnForm)[]).some((k) => form[k].trim() !== "");
    if (!typed && files.length === 0) return Promise.reject(new Error("Nothing to save yet."));
    return drafts.save({
      title: [form.partyName.trim() || "No customer yet", form.reason.trim()].filter(Boolean).join(" · ").slice(0, 120),
      payload: form,
      files,
    });
  };

  const submit = async () => {
    setTouched(true);
    if (!isValid) return;
    setBusy(true);
    setSubmitError("");
    try {
      const id = await s.submitCreditNote({
        companyId: form.companyId || null,
        partyId: form.partyId || null,
        partyName: form.partyName.trim(),
        reason: form.reason.trim(),
        amount: Math.round(amount * 100) / 100,
        details: form.details.trim(),
        requesterName: user.name,
      });
      // After the credit note exists — the storage path starts with its id.
      // A failed upload never reads as a failed submit.
      for (const file of files) {
        try {
          await s.uploadCreditNoteDoc(id, "raise", "raise", file);
        } catch (e) {
          setSubmitError(
            `The credit note was saved, but "${file.name}" did not upload: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      await drafts.finish();
      navigate(creditNotesHref({ tab: "approval", open: id }));
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <SavedDraftsPanel
        api={drafts}
        onContinue={(payload: CnForm, f: File[]) => {
          setForm({ ...EMPTY, ...payload });
          setFiles(f);
          setTouched(false);
        }}
        noun="credit note"
      />

      <Card className="p-5">
        <h2 className="text-[15px] font-bold text-navy">Customer credit note</h2>
        <p className="mt-1 text-[12.5px] text-grey-2">
          Goes to management for approval, then to the Tally desk to post it. Closed once Tally no. is entered.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel label="Company" hint="narrows the customer list — optional">
              <Combobox
                value={form.companyId}
                onChange={(v) => setForm((f) => ({ ...f, companyId: v }))}
                options={companyOpts}
                placeholder="Any company"
                searchable
                clearable
              />
            </FieldLabel>
          </div>

          <div>
            <FieldLabel strong label="Customer Name" required>
              <Combobox
                value={form.partyId}
                onChange={(v) => {
                  const p = customers.find((x) => x.id === v);
                  setForm((f) => ({ ...f, partyId: v, partyName: p?.name ?? "" }));
                }}
                options={partyOpts}
                placeholder="Search customers"
                searchable
                wrapLabel
                clearable
              />
            </FieldLabel>
            {!form.partyId && (
              <TextInput
                className="mt-2"
                value={form.partyName}
                onChange={(e) => set("partyName", e.target.value)}
                placeholder="…or type the customer name"
              />
            )}
            <ErrorText>{err("partyName")}</ErrorText>
          </div>

          <div>
            <FieldLabel strong label="Reason for credit note" required>
              <TextInput
                value={form.reason}
                onChange={(e) => set("reason", e.target.value)}
                placeholder="e.g. rate difference, quality claim, short supply"
              />
            </FieldLabel>
            <ErrorText>{err("reason")}</ErrorText>
          </div>

          <div>
            <FieldLabel strong label="Amount of the credit note (₹)" required>
              <TextInput
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => set("amount", e.target.value.replace(/[^\d.,]/g, ""))}
                placeholder="0.00"
              />
            </FieldLabel>
            <ErrorText>{err("amount")}</ErrorText>
          </div>

          <div className="sm:col-span-2">
            <FieldLabel strong label="Full details — why we are giving this credit note" required>
              <TextArea
                rows={5}
                value={form.details}
                onChange={(e) => set("details", e.target.value)}
                placeholder="What happened, which invoice(s) it relates to, how the amount was worked out, and what was agreed with the customer."
              />
            </FieldLabel>
            <ErrorText>{err("details")}</ErrorText>
          </div>

          <div className="sm:col-span-2">
            <FieldLabel strong label="Attachments" hint="supporting papers — optional">
              <input
                type="file"
                multiple
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                className="block w-full text-[13px] text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-page file:px-3 file:py-2 file:text-[12.5px] file:font-semibold file:text-navy hover:file:bg-line/40"
              />
            </FieldLabel>
            {files.length > 0 && (
              <p className="text-[12px] text-grey-2 mt-1">
                {files.length} file{files.length > 1 ? "s" : ""} will be attached: {files.map((x) => x.name).join(", ")}
              </p>
            )}
          </div>
        </div>
      </Card>

      {submitError && (
        <Card className="p-4 border-red-200 bg-red-50">
          <p className="text-[13px] font-semibold text-red-700">There was a problem.</p>
          <p className="text-[12.5px] text-red-700/90 mt-1">{submitError}</p>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={submit} disabled={busy}>
          {busy ? "Submitting…" : "Submit for management approval"}
        </Button>
        <SaveDraftButton api={drafts} onSave={saveDraft} disabled={busy} />
        <Button variant="ghost" onClick={() => navigate(-1)} disabled={busy}>
          Cancel
        </Button>
        {touched && !isValid && (
          <span className="text-[12.5px] text-red-600">Some required fields still need filling in.</span>
        )}
      </div>
    </div>
  );
}
