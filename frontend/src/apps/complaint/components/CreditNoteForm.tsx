import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import ChoiceButtons from "@/shared/components/ui/ChoiceButtons";
import Combobox from "@/shared/components/ui/Combobox";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import SavedDraftsPanel, { SaveDraftButton } from "@/shared/components/ui/SavedDraftsPanel";
import { useSavedDrafts } from "@/shared/lib/useSavedDrafts";
import { useSession } from "@/core/platform/session";
import { useComplaintStore } from "../store";
import { myRequestsHref } from "../lib/routes";
import { APPROVED_BY_NAMES, CN_PRODUCT_LABEL, CN_PRODUCTS, type CnProduct } from "../types/creditNote";

/**
 * The Tally salesperson list — ext_ledger_tags.salesperson on ConnectWave, the
 * same list Customer Onboarding's SalespersonPicker offers. Same query key, so
 * the two share one cached copy. Imported dynamically: the fetcher is a
 * code-split chunk and must stay out of the entry bundle.
 */
function useSalespersonNames(): string[] {
  const { data } = useQuery({
    queryKey: ["hub", "salespersonNames"],
    queryFn: async () => {
      const { fetchSalespersonNames } = await import("@hub/lib/connectwaveFetcher");
      return fetchSalespersonNames();
    },
    staleTime: 10 * 60 * 1000,
  });
  return data ?? [];
}

/** Dropdown options, plus the current value when it was typed rather than picked. */
const withTyped = (names: string[], value: string) =>
  [...(value && !names.includes(value) ? [value] : []), ...names].map((n) => ({ value: n, label: n }));

/**
 * Raise a Customer Compensation — the fourth option on "Raise a complaint".
 *
 *   Company · Customer name · Product (Other → specify) · Amount (if any) ·
 *   Salesperson · Approved by · Reason for compensation · Attachments
 *
 * (Built as "Customer Credit Note", renamed by the user; the tables, RPCs and
 * code names keep the credit-note wording.)
 *
 * Submit sends it to MANAGEMENT APPROVAL (Setup step `cn_approval`); once
 * approved it waits in the TALLY bucket (`cn_tally`), which records the Tally
 * no., an attachment and a remark and closes it.
 */
interface CnForm {
  companyId: string;
  productType: "" | CnProduct;
  productOther: string;
  partyId: string;
  partyName: string;
  salespersonName: string;
  approvedByName: string;
  reason: string;
  amount: string;
}

const EMPTY: CnForm = { companyId: "", productType: "", productOther: "", partyId: "", partyName: "", salespersonName: "", approvedByName: "", reason: "", amount: "" };

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

  const salespeople = useSalespersonNames();
  /**
   * Default the salesperson to the person raising it when they ARE one — the
   * admin-set profile tag (exactly one), as Customer Onboarding does. Only fills
   * a blank field.
   */
  const ownTag = useMemo(() => {
    const tags = (user.receivablesSalespersons ?? []).map((t) => t.trim()).filter(Boolean);
    if (tags.length !== 1) return "";
    return salespeople.find((n) => n.toLowerCase() === tags[0].toLowerCase()) ?? tags[0];
  }, [user.receivablesSalespersons, salespeople]);
  useEffect(() => {
    if (ownTag) setForm((f) => (f.salespersonName ? f : { ...f, salespersonName: ownTag }));
  }, [ownTag]);

  const set = <K extends keyof CnForm>(k: K, v: CnForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const amount = Number(form.amount.replace(/,/g, ""));
  const errors: Partial<Record<keyof CnForm, string>> = {};
  if (!form.companyId) errors.companyId = "Company is required.";
  if (!form.productType) errors.productType = "Product is required.";
  else if (form.productType === "other" && !form.productOther.trim()) errors.productOther = "Specify the product.";
  if (!form.partyName.trim()) errors.partyName = "Customer name is required.";
  if (!form.salespersonName.trim()) errors.salespersonName = "Salesperson is required.";
  if (!form.approvedByName.trim()) errors.approvedByName = "Approved by is required.";
  if (!form.reason.trim()) errors.reason = "Reason for compensation is required.";
  // Amount is optional ("if any") — but a typed one must be a real amount.
  if (form.amount.trim() && (!Number.isFinite(amount) || amount <= 0)) errors.amount = "Enter an amount more than zero, or leave it blank.";
  const isValid = Object.keys(errors).length === 0;
  const err = (k: keyof CnForm) => (touched ? (errors[k] ?? "") : "");

  const companyOpts = s.companies.map((c) => ({ value: c.id, label: c.name }));
  // The chosen company's customers (all companies until one is picked); the
  // company shows under each name so same-named ledgers can be told apart.
  const customers = s.partiesFor(form.companyId || null, "finished_good", form.partyId || null);
  const partyOpts = customers.map((p) => ({
    value: p.id,
    label: p.name,
    sublabel: p.companyId ? s.companyName(p.companyId) : undefined,
  }));

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
        productType: form.productType as CnProduct,
        productOther: form.productType === "other" ? form.productOther.trim() : null,
        partyId: form.partyId || null,
        partyName: form.partyName.trim(),
        salespersonName: form.salespersonName.trim(),
        approvedByName: form.approvedByName.trim(),
        reason: form.reason.trim(),
        amount: form.amount.trim() ? Math.round(amount * 100) / 100 : null,
        details: null,
        requesterName: user.name,
      });
      // After the credit note exists — the storage path starts with its id.
      // A failed upload never reads as a failed submit.
      for (const file of files) {
        try {
          await s.uploadCreditNoteDoc(id, "raise", "raise", file);
        } catch (e) {
          setSubmitError(
            `The compensation was saved, but "${file.name}" did not upload: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      await drafts.finish();
      // My Complaints, with the new compensation's popup open.
      navigate(`${myRequestsHref()}?open=${id}`);
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
        noun="compensation"
      />

      <Card className="p-5">
        <h2 className="text-[15px] font-bold text-navy">Customer compensation</h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel strong label="Company" required>
              <Combobox
                value={form.companyId}
                onChange={(v) =>
                  setForm((f) => {
                    // A customer from another company's book no longer fits.
                    const p = customers.find((x) => x.id === f.partyId);
                    const keep = !p || !v || !p.companyId || p.companyId === v;
                    return keep ? { ...f, companyId: v } : { ...f, companyId: v, partyId: "", partyName: "" };
                  })
                }
                options={companyOpts}
                placeholder="Select a company"
                clearable
              />
            </FieldLabel>
            <ErrorText>{err("companyId")}</ErrorText>
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
            <FieldLabel strong label="Product" required>
              <ChoiceButtons
                ariaLabel="Product"
                options={CN_PRODUCTS.map((v) => ({ value: v, label: CN_PRODUCT_LABEL[v] }))}
                value={form.productType}
                onChange={(v) => set("productType", v as CnProduct)}
              />
            </FieldLabel>
            {form.productType === "other" && (
              <TextInput
                className="mt-2"
                autoFocus
                value={form.productOther}
                onChange={(e) => set("productOther", e.target.value)}
                placeholder="Specify the product"
              />
            )}
            <ErrorText>{err("productType") || err("productOther")}</ErrorText>
          </div>

          <div>
            <FieldLabel strong label="Amount (₹)">
              <TextInput
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => set("amount", e.target.value.replace(/[^\d.,]/g, ""))}
                placeholder="if any"
              />
            </FieldLabel>
            <ErrorText>{err("amount")}</ErrorText>
          </div>

          <div>
            <FieldLabel strong label="Salesperson" required>
              <Combobox
                value={form.salespersonName}
                onChange={(v) => set("salespersonName", v)}
                options={withTyped(salespeople, form.salespersonName)}
                placeholder={salespeople.length ? "Choose a salesperson" : "Loading salespeople…"}
                searchable
                clearable
                onCreate={(n) => n.trim()}
                createLabel={(q) => `Use “${q}”`}
              />
            </FieldLabel>
            <ErrorText>{err("salespersonName")}</ErrorText>
          </div>

          <div>
            <FieldLabel strong label="Approved by" required>
              <Combobox
                value={form.approvedByName}
                onChange={(v) => set("approvedByName", v)}
                options={withTyped(APPROVED_BY_NAMES, form.approvedByName)}
                placeholder="Karan / Ayush / Manmohan / Nakul sir…"
                searchable
                clearable
                onCreate={(n) => n.trim()}
                createLabel={(q) => `Use “${q}”`}
              />
            </FieldLabel>
            <ErrorText>{err("approvedByName")}</ErrorText>
          </div>

          <div className="sm:col-span-2">
            <FieldLabel strong label="Reason for compensation" required>
              <TextArea
                rows={4}
                value={form.reason}
                onChange={(e) => set("reason", e.target.value)}
                placeholder="e.g. rate difference, quality claim, short supply — and what was agreed with the customer"
              />
            </FieldLabel>
            <ErrorText>{err("reason")}</ErrorText>
          </div>

          <div className="sm:col-span-2">
            <FieldLabel strong label="Attachments">
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
