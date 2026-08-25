import { useEffect, useMemo, useState } from "react";
import PaperSet, { type Paper } from "./PaperSet";
import { useOcpiStore } from "../store";
import { fetchStoredPdf } from "../lib/docUrls";
import { quotationDetailFileName, quotationFileName } from "../lib/quotationPdf";
import { dmy } from "../lib/format";
import type { OcpiDeal, QuotationVersion } from "../types";

/**
 * The papers this quotation has actually issued — always, not only in the
 * seconds after Generate was pressed.
 *
 * ⚠ THIS EXISTS BECAUSE THE PREVIEW USED TO BE COMPONENT STATE. `QuotationEditor`
 *   held the generated blobs in a `useState` set by the Generate handler, so the
 *   documents vanished on reload, on navigating away and back, and on opening
 *   the draft the next morning. The files were never lost — they are in storage,
 *   on the version row — but nothing read them back, so the only chance to
 *   download a quotation was the one moment it was made. That is precisely when
 *   somebody is least likely to want it.
 *
 * ⚠ THE STORED FILE WINS OVER A RE-RENDER. A version is frozen: what the
 *   customer holds must be the bytes that were issued, not a fresh render from a
 *   machine template somebody may have reworded since. There is no rebuild
 *   fallback here at all — an issued quotation with no stored file says so
 *   rather than quietly substituting a different document. (The approved
 *   contract does rebuild, in `ApprovedOcPreview`, because a deal must not be
 *   stuck at the signature step; the reasoning is opposite and deliberate.)
 *
 * ⚠ A FRESHLY GENERATED PAIR IS PREFERRED OVER A DOWNLOAD. Immediately after
 *   Generate the blobs are already in hand and the upload may still be in
 *   flight, so passing them in shows the document instantly instead of racing
 *   storage for it.
 */
export default function IssuedPapers({
  deal,
  versions,
  fresh,
}: {
  deal: OcpiDeal;
  versions: QuotationVersion[];
  /** The pair just rendered in this browser, when Generate has only just run. */
  fresh?: { summary: Blob; detail: Blob | null } | null;
}) {
  const s = useOcpiStore();
  const machine = s.machineById(deal.machineId);

  // The newest version is the one on offer. Older ones stay reachable through
  // the revision history, each with its own frozen pair.
  const current = useMemo(
    () =>
      versions.length === 0
        ? null
        : versions.reduce((a, b) => (b.versionNo > a.versionNo ? b : a)),
    [versions],
  );

  const [summary, setSummary] = useState<Blob | null>(null);
  const [detail, setDetail] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (fresh) {
      setSummary(fresh.summary);
      setDetail(fresh.detail);
      setBusy(false);
      return;
    }
    if (!current) {
      setSummary(null);
      setDetail(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    void (async () => {
      const [a, b] = await Promise.all([
        fetchStoredPdf(current.pdfPath),
        fetchStoredPdf(current.ocPdfPath),
      ]);
      if (cancelled) return;
      setSummary(a);
      setDetail(b);
      setBusy(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fresh, current?.versionNo, current?.pdfPath, current?.ocPdfPath]);

  if (!current) return null;

  const versionNo = current.versionNo;
  const noTemplate = !!machine && !machine.hasTemplate;

  const papers: Paper[] = [
    {
      key: "summary",
      label: "Summary",
      blob: summary,
      fileName: quotationFileName(deal, versionNo),
      missingNote:
        "The summary for this version is not in storage. Generate a revision to issue it again.",
    },
    {
      key: "detail",
      label: "Detailed sheet",
      blob: detail,
      fileName: quotationDetailFileName(deal, versionNo),
      missingNote: noTemplate
        ? `${machine!.name} has no detailed template yet, so this issue is the summary alone. The sheet appears once somebody builds the template under Machines.`
        : "No detailed sheet was stored for this version.",
    },
  ];

  return (
    <PaperSet
      papers={papers}
      title={`${deal.quotationNo ?? "Quotation"}${versionNo > 1 ? ` · Rev ${versionNo - 1}` : ""}`}
      note={
        versionNo > 1
          ? `Issued ${dmy(current.generatedAt)} — earlier revisions are kept below, each with its own pair.`
          : `Issued ${dmy(current.generatedAt)} — the first version.`
      }
      busy={busy}
    />
  );
}
