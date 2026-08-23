import { useEffect, useState } from "react";
import DocumentPreview from "./DocumentPreview";
import { useOcpiStore } from "../store";
import { fetchStoredPdf } from "../lib/docUrls";
import { ocFileName, ocPdfBlob } from "../lib/ocPdf";
import type { OcpiDeal } from "../types";

/**
 * The approved order confirmation, ready to print.
 *
 * ⚠ THE STORED FILE WINS. What the customer signs must be the bytes management
 *   approved — not a fresh render from a machine template somebody may have
 *   reworded since. `oc_pdf_path` is written at submit, from exactly the blob
 *   that was shown to the approver, so it is fetched first and used as-is.
 *
 * ⚠ RE-RENDERING IS A FALLBACK, AND IT SAYS SO ON SCREEN. If the file is
 *   missing — an upload that failed while the submit itself succeeded, which the
 *   editor deliberately tolerates rather than unwinding a minted OC number — the
 *   document is rebuilt so the deal is not stuck. But the rebuild reads the
 *   template as it stands TODAY, so it can differ from what was approved, and a
 *   quiet substitution on the one document that gets signed is not acceptable.
 *   The note tells the reader which of the two they are looking at.
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

  const [pdf, setPdf] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(true);
  const [rebuilt, setRebuilt] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const stored = await fetchStoredPdf(deal.ocPdfPath);
        if (cancelled) return;
        if (stored) {
          setPdf(stored);
          setRebuilt(false);
          return;
        }
        if (!machine) throw new Error("This deal has no machine, so there is nothing to print");
        const blob = await ocPdfBlob({
          deal,
          machine,
          sections: s.sectionsFor(machine.id),
          profile: s.profileFor(deal.companyId),
          validityDays: s.config.quotationValidityDays,
        });
        if (cancelled) return;
        setPdf(blob);
        setRebuilt(true);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal.id, deal.ocPdfPath, deal.updatedAt, machine?.id]);

  return (
    <>
      <DocumentPreview
        blob={pdf}
        fileName={ocFileName(deal)}
        title={deal.ocNo ?? "Order confirmation"}
        note={
          rebuilt
            ? "Rebuilt from the machine template — the approved file could not be found, so check it before printing."
            : note
        }
        busy={busy}
      />
      {error && <p className="mt-2 text-[13px] text-ryg-red">{error}</p>}
    </>
  );
}
