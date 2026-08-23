import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import QuotationForm from "../../components/QuotationForm";
import DocumentPreview from "../../components/DocumentPreview";
import RevisionHistory from "../../components/RevisionHistory";
import { CompanyProfileWarning, QuotationSeriesWarning } from "../../components/SetupWarnings";
import { useOcpiStore } from "../../store";
import { quotationFileName } from "../../lib/quotationPdf";
import { submitQuotation } from "../../data/ocpiWrites";
import { useQuotationDraft } from "./useQuotationDraft";

/**
 * Write a quotation — the same screen whether it is new or a draft being
 * finished, because those are the same act.
 *
 * ⚠ SAVING A DRAFT IS DELIBERATELY CHEAP. It asks for a customer name and
 *   nothing else, so somebody handed half the details on a phone call can put
 *   them down and come back. What is still missing is listed beside the Generate
 *   button rather than blocking Save — a form that refuses to save until it is
 *   complete is a form people keep in a notebook instead.
 *
 * ⚠ GENERATE IS THE ACT THAT COSTS SOMETHING. It mints a number from a series
 *   customers already hold, and freezes a version that can never be edited. So
 *   it is a separate, clearly-labelled button, and the copy says what it will
 *   do — it is not a save with a different name.
 */
export default function QuotationEditor({ dealId }: { dealId?: string }) {
  const nav = useNavigate();
  const s = useOcpiStore();
  const q = useQuotationDraft(dealId);
  const [pdf, setPdf] = useState<Blob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isNew = !dealId;
  const deal = q.savedId ? s.deals.find((d) => d.id === q.savedId) : undefined;
  const versions = useMemo(
    () => (q.savedId ? s.versions.filter((v) => v.dealId === q.savedId) : []),
    [s.versions, q.savedId],
  );
  const canGenerate = q.missing.length === 0;

  async function onSave() {
    const id = await q.save();
    if (!id) return;
    if (isNew) nav(`/ocpi/deals/${id}/edit`, { replace: true });
  }

  async function onGenerate() {
    const blob = await q.generate();
    if (!blob) return;
    setPdf(blob);
    if (isNew && q.savedId) nav(`/ocpi/deals/${q.savedId}/edit`, { replace: true });
  }

  async function onSubmit() {
    if (!q.savedId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submitQuotation(q.savedId);
      await s.refresh();
      // It is out of the salesperson's hands now, so the editor is the wrong
      // place to be left standing.
      nav(`/ocpi/deals/${q.savedId}`);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  const alreadyIssued = !!deal?.quotationNo;
  const nextVersionLabel = alreadyIssued ? "Generate revision" : "Generate quotation";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-navy">
            {alreadyIssued ? deal!.quotationNo : isNew ? "New quotation" : "Draft quotation"}
          </h1>
          <p className="mt-0.5 text-[13.5px] text-grey-2">
            {alreadyIssued
              ? `${deal!.customerName ?? ""}${
                  deal!.quotationVersionNo > 1 ? ` · Rev ${deal!.quotationVersionNo - 1}` : ""
                }`
              : "No number is issued until the quotation is generated."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {q.savedAt && !q.busy && <span className="text-[12.5px] text-grey-2">Saved</span>}
          <Button variant="ghost" onClick={() => void onSave()} disabled={q.busy}>
            {q.busy ? "Working…" : "Save draft"}
          </Button>
          <Button variant="ghost" onClick={() => void onGenerate()} disabled={q.busy || !canGenerate}>
            {nextVersionLabel}
          </Button>
          {/*
            ⚠ SEPARATE FROM GENERATE, and only offered once a document exists.
              Sending for approval is the act that takes the quotation out of the
              salesperson's hands; an approver cannot sign off a set of answers
              nobody has rendered, so the database refuses it too.
          */}
          <Button
            onClick={() => void onSubmit()}
            disabled={q.busy || !alreadyIssued || submitting}
            title={alreadyIssued ? undefined : "Generate the quotation first"}
          >
            {submitting ? "Sending…" : "Send for approval"}
          </Button>
        </div>
      </div>

      {(q.error || submitError) && (
        <Card className="border-ryg-red/40 p-4">
          <p className="text-[13px] text-ryg-red">{q.error ?? submitError}</p>
        </Card>
      )}

      {/*
        ⚠ ONLY WHILE NO NUMBER HAS BEEN ISSUED. Once this deal carries a
          quotation number the warning is history — regenerating keeps the same
          number, so nothing further can be minted from this screen and the
          notice would just be noise on every revision.
      */}
      {!alreadyIssued && <QuotationSeriesWarning />}
      <CompanyProfileWarning companyId={q.draft.companyId || null} />

      {!canGenerate && (
        <Card className="p-4">
          <p className="text-[13px] font-medium text-navy">
            Still needed before a quotation can be generated
          </p>
          <p className="mt-1 text-[13px] text-grey">
            {q.missing.join(", ")}. You can save it as a draft in the meantime.
          </p>
        </Card>
      )}

      {alreadyIssued && (
        <Card className="p-4">
          <p className="text-[13px] text-grey">
            <span className="font-medium text-navy">{deal!.quotationNo}</span> has been issued. Editing
            below and generating again keeps that number and adds a revision — the version already
            with the customer is kept exactly as it was.
          </p>
        </Card>
      )}

      {pdf && deal && (
        <DocumentPreview
          blob={pdf}
          fileName={quotationFileName(deal, deal.quotationVersionNo)}
          title={deal.quotationNo ?? "Quotation"}
          note={
            deal.quotationVersionNo > 1
              ? `Revision ${deal.quotationVersionNo - 1} · earlier versions are kept`
              : "First version"
          }
          busy={q.busy}
        />
      )}

      <QuotationForm draft={q.draft} patch={q.patch} />

      {versions.length > 0 && <RevisionHistory versions={versions} />}
    </div>
  );
}
