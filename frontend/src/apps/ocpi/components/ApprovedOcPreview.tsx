import { useEffect, useState } from "react";
import Card from "@/shared/components/ui/Card";
import PaperSet from "./PaperSet";
import { useOcpiStore } from "../store";
import { fetchStoredPdf } from "../lib/docUrls";
import { ocFileName, ocPdfBlob, ocSummaryFileName } from "../lib/ocPdf";
import { piFileName, piPdfBlob } from "../lib/piPdf";
import { quotationPdfBlob } from "../lib/quotationPdf";
import { factsForDeal } from "../lib/fieldSpec";
import type { OcpiDeal } from "../types";

/**
 * The approved contract, ready to print — both papers.
 *
 * ⚠ THE STORED FILES WIN. What the customer signs must be the bytes the
 *   Directors approved, not a fresh render from a machine template somebody may
 *   have reworded since. `oc_summary_pdf_path` and `oc_pdf_path` are written at
 *   the approval, from exactly the blobs that were issued, so they are fetched
 *   first and used as-is.
 *
 * ⚠ RE-RENDERING IS A FALLBACK, AND IT SAYS SO ON SCREEN. If a file is missing —
 *   an upload that failed while the approval itself succeeded, which the panel
 *   deliberately tolerates rather than unwinding a minted OC number — the
 *   document is rebuilt so the deal is not stuck. But the rebuild reads the
 *   template as it stands TODAY, so it can differ from what was approved, and a
 *   quiet substitution on the one document that gets signed is not acceptable.
 *   The note tells the reader which of the two they are looking at.
 *
 * ⚠ BOTH SHEETS, NOT ONE. They are one contract issued as a pair; printing only
 *   the detailed sheet would send the customer half of what was approved. A
 *   machine with no template has only the summary, which is a legal outcome and
 *   is said in words rather than left as a missing panel.
 */
export default function ApprovedOcPreview({
  deal,
  note,
}: {
  deal: OcpiDeal;
  note?: string;
}) {
  const s = useOcpiStore();
  const machine = s.machineById(deal.machineId);

  const [summary, setSummary] = useState<Blob | null>(null);
  const [detail, setDetail] = useState<Blob | null>(null);
  const [pi, setPi] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(true);
  const [rebuilt, setRebuilt] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError(null);
    setRebuilt(false);
    void (async () => {
      try {
        const [storedSummary, storedDetail, storedPi] = await Promise.all([
          fetchStoredPdf(deal.ocSummaryPdfPath),
          fetchStoredPdf(deal.ocPdfPath),
          fetchStoredPdf(deal.piPdfPath),
        ]);
        if (cancelled) return;

        // Rebuilt on a miss like the others, and with no template condition —
        // every machine issues a Performa Invoice.
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
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal.id, deal.ocPdfPath, deal.ocSummaryPdfPath, deal.piPdfPath, deal.updatedAt, machine?.id]);

  const rebuiltNote =
    "Rebuilt from the template — the approved file could not be found, so check it before printing.";

  return (
    <div className="space-y-4">
      <PaperSet
        busy={busy}
        title={deal.ocNo ?? "Order confirmation"}
        note={rebuilt ? rebuiltNote : note}
        /* Summary · PI · OC — PaperSet lands on the first, so the order matters. */
        papers={[
          {
            key: "summary",
            label: "Summary",
            blob: summary,
            fileName: ocSummaryFileName(deal),
            missingNote: "The approved summary could not be loaded.",
          },
          {
            key: "pi",
            label: "PI",
            blob: pi,
            fileName: piFileName(deal),
            missingNote:
              "This deal was approved before the Performa Invoice was added to the module, so none was filed against it.",
          },
          {
            key: "detail",
            label: "OC",
            blob: detail,
            fileName: ocFileName(deal),
            missingNote: machine
              ? `${machine.name} has no detailed template, so the summary and the PI are the whole of this contract.`
              : "There is no detailed sheet on this deal.",
          },
        ]}
      />
      {error && <p className="text-[13px] text-ryg-red">{error}</p>}
    </div>
  );
}
