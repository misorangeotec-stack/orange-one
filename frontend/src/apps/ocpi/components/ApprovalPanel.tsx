import { useEffect, useMemo, useState } from "react";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import PaperSet from "./PaperSet";
import { CompanyProfileWarning, OcSeriesWarning, StepOwnersWarning } from "./SetupWarnings";
import { useOcpiStore } from "../store";
import { decideQuotation, freezeOc, setDealPiPdf, uploadOcPdf } from "../data/ocpiWrites";
import { fetchDealById } from "../data/ocpiFetch";
import { fetchStoredPdf } from "../lib/docUrls";
import { factsForDeal } from "../lib/fieldSpec";
import {
  quotationDetailFileName, quotationFileName, quotationPdfBlob,
} from "../lib/quotationPdf";
import { ocFileName, ocPdfBlob, ocSummaryFileName, resolvedOcDocument } from "../lib/ocPdf";
import { piFileName, piPdfBlob } from "../lib/piPdf";
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
 * ⚠ APPROVING STAMPS `oc_at` AND RE-ISSUES THE PAIR. It does NOT mint the number
 *   — OCPI-36 moved that to Generate (Ritesh Bhai, 02-09-2026), so the serial is
 *   already on the deal before an approver ever opens it. What the approval adds
 *   is the stamp, and the stamp is what re-heads both papers as the ORDER
 *   CONFIRMATION and puts the contract number on them (`paperNo`/`docHeading` in
 *   lib/format.ts). This browser then re-renders the pair, uploads them, and
 *   freezes them onto the deal.
 *
 * ⚠ THIS COMMENT USED TO SAY "APPROVING MINTS THE NUMBER", and reasoned that
 *   minting earlier "burns a number from a live series on a quotation that may be
 *   rejected". That reasoning was overturned deliberately — a paper folder that
 *   never closes already consumes its number — and the copy below was written
 *   from it. Corrected by the OCPI-40 re-audit; `fms_ocpi_decide_quotation` keeps
 *   a mint only as the fallback for deals generated BEFORE the move.
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
  const [pi, setPi] = useState<Blob | null>(null);
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
        const [storedSummary, storedDetail, storedPi] = await Promise.all([
          fetchStoredPdf(latest?.pdfPath ?? null),
          fetchStoredPdf(latest?.ocPdfPath ?? null),
          fetchStoredPdf(latest?.piPdfPath ?? null),
        ]);
        if (cancelled) return;

        /*
          The PI rebuilds on a miss, like the other two — and unlike them it has
          no template condition to check first. Every machine issues one.
        */
        setPi(
          storedPi ??
            (await piPdfBlob({
              deal,
              machine,
              profile: s.profileFor(deal.companyId),
              salesPage: s.salesPageFor(deal.machineId),
              facts: factsForDeal(s.dryerTypes, s.machineCategories, deal, machine),
            })),
        );
        /*
          ⚠ A MISSING PI DOES NOT RAISE THE "REBUILT" BANNER, AND MUST NOT.
            That banner reads "the approved file could not be found, so check it
            before printing" — a statement about a document that went missing.
            Every deal issued before OCPI-36 has no stored PI because none was
            ever issued, not because one was lost, and raising the banner there
            would cast doubt on the summary and the OC as well, which ARE the
            approved bytes. The PI is still rebuilt, because it is deterministic
            from the deal and a salesperson asking for one should get one.
        */

        if (storedSummary) {
          setSummary(storedSummary);
        } else {
          setSummary(
            await quotationPdfBlob({
              deal,
              machine,
              profile: s.profileFor(deal.companyId),
              versionNo: deal.quotationVersionNo || 1,
              facts: factsForDeal(s.dryerTypes, s.machineCategories, deal, machine),
              warrantyNote: s.config.warrantyNote,
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
              facts: factsForDeal(s.dryerTypes, s.machineCategories, deal, machine),
              profile: s.profileFor(deal.companyId),
              validityDays: s.config.quotationValidityDays,
              warranty: s.config.warranty,
              warrantyNote: s.config.warrantyNote,
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
      facts: factsForDeal(s.dryerTypes, s.machineCategories, fresh, m),
      warrantyNote: s.config.warrantyNote,
    });
    const summaryPath = await uploadOcPdf(fresh.id, approvedSummary, ocSummaryFileName(fresh));

    /*
      The Performa Invoice, re-issued under the approved heading with the rest.

      ⚠ NO `hasTemplate` GATE, deliberately. That condition belongs to the
        detailed sheet alone — 7 of 28 machines carry no OC template and every
        one of them still issues a PI, which is the whole finding behind OCPI-36:
        25 of 27 real folders hold a PI and only 12 hold an OC.
    */
    const approvedPi = await piPdfBlob({
      deal: fresh,
      machine: m,
      profile,
      salesPage: s.salesPageFor(fresh.machineId),
      facts: factsForDeal(s.dryerTypes, s.machineCategories, fresh, m),
    });
    const piPath = await uploadOcPdf(fresh.id, approvedPi, piFileName(fresh));

    let detailPath: string | undefined;
    let document: Record<string, unknown> = {};
    if (m?.hasTemplate) {
      const input = {
        deal: fresh,
        machine: m,
        sections: s.sectionsFor(m.id),
        facts: factsForDeal(s.dryerTypes, s.machineCategories, fresh, m),
        profile,
        validityDays,
        warranty: s.config.warranty,
        warrantyNote: s.config.warrantyNote,
      };
      document = resolvedOcDocument(input);
      detailPath = await uploadOcPdf(fresh.id, await ocPdfBlob(input), ocFileName(fresh));
    }

    await freezeOc(fresh.id, document, detailPath, summaryPath);
    // Its own write door — see the note on `setDealPiPdf`, and the migration's.
    await setDealPiPdf(fresh.id, piPath);
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
            `Approved, and both papers are now the order confirmation — but storing the signed copies ` +
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
            : "Read every paper before deciding — approving issues them as the contract."
        }
        /* Summary · PI · OC — PaperSet lands on the first, so the order matters. */
        papers={[
          {
            key: "summary",
            label: "Summary",
            blob: summary,
            fileName: quotationFileName(deal, deal.quotationVersionNo || 1),
            missingNote: "The issued summary could not be loaded.",
          },
          {
            key: "pi",
            label: "PI",
            blob: pi,
            fileName: piFileName(deal, deal.quotationVersionNo || 1),
            missingNote: "The Performa Invoice could not be loaded or rebuilt.",
          },
          {
            key: "detail",
            label: "OC",
            blob: detail,
            fileName: quotationDetailFileName(deal, deal.quotationVersionNo || 1),
            missingNote: machine
              ? `${machine.name} has no detailed template yet, so the summary and the PI are the whole of it. Approving is not blocked.`
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
                : "Approving re-heads both papers as the ORDER CONFIRMATION the customer signs, under the contract number this deal already holds. Sending it back returns it to the salesperson to edit and regenerate — the numbers and every earlier version are kept. The contract number was taken when the quotation was generated, so neither decision frees it."}
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
