import { useEffect, useMemo, useState } from "react";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import PaperSet from "./PaperSet";
import { CompanyProfileWarning, OcSeriesWarning, StepOwnersWarning } from "./SetupWarnings";
import { useOcpiStore } from "../store";
import { decideQuotation, freezeOc, uploadOcPdf } from "../data/ocpiWrites";
import { fetchDealById } from "../data/ocpiFetch";
import { fetchStoredPdf } from "../lib/docUrls";
import { dealFacts } from "../lib/fieldSpec";
import {
  quotationDetailFileName, quotationFileName, quotationPdfBlob,
} from "../lib/quotationPdf";
import { ocFileName, ocPdfBlob, ocSummaryFileName, resolvedOcDocument } from "../lib/ocPdf";
import type { OcpiDeal } from "../types";

/**
 * The Directors' gate — and the moment the quotation BECOMES the order
 * confirmation.
 *
 * ⚠ THE DOCUMENTS ARE RENDERED, NOT SUMMARISED. Approving here issues a contract;
 *   doing it from a list of field values would mean confirming something nobody
 *   had read. Both papers are shown, and the STORED files are preferred over a
 *   re-render — what the approver reads has to be the bytes the customer was
 *   sent, not a fresh render from a machine template somebody may have reworded
 *   since. A rebuild is a labelled fallback, never a silent substitution.
 *
 * ⚠ APPROVING MINTS THE NUMBER AND RE-ISSUES THE PAIR, in one action. The two
 *   cannot be split: minting earlier burns a number from a live series on a
 *   quotation that may be rejected, and rendering earlier prints a contract with
 *   no number on it. So `fms_ocpi_decide_quotation` mints, this browser
 *   immediately re-renders both papers with the number and the ORDER
 *   CONFIRMATION heading, uploads them, and freezes them onto the deal.
 *
 * ⚠ A FAILED UPLOAD DOES NOT UNWIND THE APPROVAL. The number is minted and the
 *   decision recorded; what is missing is a file that can be produced again.
 *   The failure is reported here, and `ApprovedOcPreview` rebuilds from the
 *   template and says on screen that it did.
 *
 * ⚠ THREE OUTCOMES, NOT TWO. "Send back for changes" is the one that gets used
 *   most — a price to revisit, a delivery date to firm up — and without it an
 *   approver's only way to say "nearly" is to reject, which kills the deal.
 *   Rework returns it to the salesperson as a draft they can edit and
 *   regenerate, keeping the number and the whole revision history. **It mints
 *   nothing**, so a returned quotation costs no OC number.
 *
 * ⚠ THE BUTTONS ARE A COURTESY; the RPC re-checks who may act, refuses
 *   self-approval, and refuses a decision on a deal that is not actually waiting.
 */
export default function ApprovalPanel({
  deal,
  inDialog,
}: {
  deal: OcpiDeal;
  /**
   * Rendered inside a dialog rather than on the deal page.
   *
   * ⚠ THE VIEWER MUST BE SHORTER THAN THE DIALOG. At the full-page height the
   *   frame is taller than the dialog can be, so the DIALOG scrolls and the
   *   contract is read through a letterbox — which is exactly what a Director
   *   cannot do their job through.
   */
  inDialog?: boolean;
}) {
  const s = useOcpiStore();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<null | "approve" | "reject" | "rework">(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Blob | null>(null);
  const [detail, setDetail] = useState<Blob | null>(null);
  const [rebuilt, setRebuilt] = useState(false);
  const [loading, setLoading] = useState(false);

  const mayAct = s.canActOn("quotation_approval");
  const waiting = deal.status === "awaiting_quotation_approval";
  const isOwnDeal = deal.raisedBy === s.userId;
  const soleApprover =
    s.ownersOf("quotation_approval").length === 1 && s.ownersOf("quotation_approval")[0] === s.userId;

  const machine = s.machineById(deal.machineId);

  /** The revision that was actually sent for approval — the last one generated. */
  const latest = useMemo(() => {
    const mine = s.versions.filter((v) => v.dealId === deal.id);
    return mine.length ? mine.reduce((a, b) => (b.versionNo > a.versionNo ? b : a)) : undefined;
  }, [s.versions, deal.id]);

  useEffect(() => {
    if (!waiting) return;
    let cancelled = false;
    setLoading(true);
    setRebuilt(false);
    void (async () => {
      try {
        const [storedSummary, storedDetail] = await Promise.all([
          fetchStoredPdf(latest?.pdfPath ?? null),
          fetchStoredPdf(latest?.ocPdfPath ?? null),
        ]);
        if (cancelled) return;

        if (storedSummary) {
          setSummary(storedSummary);
        } else {
          setSummary(
            await quotationPdfBlob({
              deal,
              machine,
              profile: s.profileFor(deal.companyId),
              versionNo: deal.quotationVersionNo || 1,
              noDryerCategory: dealFacts(s.dryerTypes, deal.dryerType ?? "").noDryerCategory,
            }),
          );
          if (!cancelled) setRebuilt(true);
        }

        if (storedDetail) {
          setDetail(storedDetail);
        } else if (machine?.hasTemplate) {
          setDetail(
            await ocPdfBlob({
              deal,
              machine,
              sections: s.sectionsFor(machine.id),
              profile: s.profileFor(deal.companyId),
              validityDays: s.config.quotationValidityDays,
              warranty: s.config.warranty,
            }),
          );
          if (!cancelled) setRebuilt(true);
        } else {
          setDetail(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal.id, deal.updatedAt, latest?.versionNo, machine?.id, waiting]);

  if (!waiting) return null;

  /**
   * Re-issue both papers under the number the approval just minted.
   *
   * Reads the deal back from the database rather than trusting the copy this
   * component is holding: the OC number was minted inside the RPC, and it is the
   * one thing the new render exists to carry.
   */
  async function issueApprovedPapers(): Promise<void> {
    const fresh = await fetchDealById(deal.id);
    if (!fresh) throw new Error("The deal could not be re-read after approving");

    const m = s.machineById(fresh.machineId);
    const profile = s.profileFor(fresh.companyId);
    const validityDays = s.config.quotationValidityDays;

    const approvedSummary = await quotationPdfBlob({
      deal: fresh,
      machine: m,
      profile,
      versionNo: fresh.quotationVersionNo || 1,
      noDryerCategory: dealFacts(s.dryerTypes, fresh.dryerType ?? "").noDryerCategory,
    });
    const summaryPath = await uploadOcPdf(fresh.id, approvedSummary, ocSummaryFileName(fresh));

    let detailPath: string | undefined;
    let document: Record<string, unknown> = {};
    if (m?.hasTemplate) {
      const input = {
        deal: fresh,
        machine: m,
        sections: s.sectionsFor(m.id),
        profile,
        validityDays,
        warranty: s.config.warranty,
      };
      document = resolvedOcDocument(input);
      detailPath = await uploadOcPdf(fresh.id, await ocPdfBlob(input), ocFileName(fresh));
    }

    await freezeOc(fresh.id, document, detailPath, summaryPath);
  }

  async function decide(decision: "approve" | "reject" | "rework") {
    setBusy(decision);
    setError(null);
    try {
      await decideQuotation(deal.id, decision, note.trim() || undefined);
      if (decision === "approve") {
        try {
          await issueApprovedPapers();
        } catch (e) {
          setError(
            `Approved, and the order-confirmation number is issued — but storing the signed copies ` +
              `failed: ${e instanceof Error ? e.message : String(e)}. The documents will be rebuilt ` +
              `from the template when they are printed, and the screen will say so.`,
          );
        }
      }
      setNote("");
      await s.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const blockedBySelf = isOwnDeal && !soleApprover;
  const rebuiltNote =
    "Rebuilt from the template — the issued file could not be found, so check it before approving.";

  return (
    <div className="space-y-4">
      {/*
        The approver is the last person who can stop a contract going out under
        the wrong company's bank details, so the notice sits above the documents
        rather than below them.
      */}
      <StepOwnersWarning step="quotation_approval" />
      <OcSeriesWarning />
      <CompanyProfileWarning companyId={deal.companyId} />

      <PaperSet
        viewerClass={inDialog ? "h-[52vh]" : undefined}
        busy={loading}
        title={deal.quotationNo ?? "Quotation"}
        note={
          rebuilt
            ? rebuiltNote
            : "Read both papers before deciding — approving issues them as the contract."
        }
        papers={[
          {
            key: "summary",
            label: "Summary",
            blob: summary,
            fileName: quotationFileName(deal, deal.quotationVersionNo || 1),
            missingNote: "The issued summary could not be loaded.",
          },
          {
            key: "detail",
            label: "Detailed sheet",
            blob: detail,
            fileName: quotationDetailFileName(deal, deal.quotationVersionNo || 1),
            missingNote: machine
              ? `${machine.name} has no detailed template yet, so the summary is the whole of it. Approving is not blocked.`
              : "There is no detailed sheet on this deal. Approving is not blocked.",
          },
        ]}
      />

      {mayAct ? (
        <Card className="space-y-3 p-5">
          <div>
            <h2 className="text-[15px] font-bold text-navy">Your decision</h2>
            <p className="mt-0.5 text-[13.5px] text-grey-2">
              {blockedBySelf
                ? "You raised this quotation, so somebody else has to approve it."
                : "Approving issues the order-confirmation number and re-heads both papers as the ORDER CONFIRMATION the customer signs. Sending it back returns it to the salesperson to edit and regenerate — the quotation number and every earlier version are kept, and no order-confirmation number is used up."}
            </p>
          </div>

          {!blockedBySelf && (
            <>
              <FieldLabel label="Reason or note" hint="required when rejecting or sending back">
                <TextArea
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="What needs to change, or why this is refused"
                  disabled={!!busy}
                />
              </FieldLabel>

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void decide("approve")} disabled={!!busy}>
                  {busy === "approve" ? "Issuing…" : "Approve and issue"}
                </Button>
                <Button variant="ghost" onClick={() => void decide("rework")} disabled={!!busy}>
                  {busy === "rework" ? "Sending back…" : "Send back for changes"}
                </Button>
                <Button variant="ghost" onClick={() => void decide("reject")} disabled={!!busy}>
                  {busy === "reject" ? "Rejecting…" : "Reject"}
                </Button>
              </div>
            </>
          )}

          {error && <p className="text-[13px] text-ryg-red">{error}</p>}
        </Card>
      ) : (
        <Card className="p-4">
          <p className="text-[13.5px] text-grey">
            This quotation is waiting for approval. You are not one of the approvers, so there is
            nothing for you to do here.
          </p>
          {error && <p className="mt-2 text-[13px] text-ryg-red">{error}</p>}
        </Card>
      )}
    </div>
  );
}
