import { useEffect, useState } from "react";
import { useOcpiStore } from "../store";
import { fetchServiceChecklistPdf } from "../data/ocpiServiceChecklists";
import type { Paper } from "./PaperSet";
import type { OcpiDeal } from "../types";

const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "-");

/**
 * The deal machine's service checklist PDF (Masters → Service checklists), as a
 * paper for every PaperSet that issues the deal's documents — the issued
 * quotation, the approval, and the approved contract.
 *
 * ⚠ `attach: true` — PaperSet appends it to the END of the Summary, PI and OC,
 *   so Download and Print on any of them include the checklist in the same
 *   file; "Download all" adds it once. The customer always receives it before
 *   installation without anyone having to remember it.
 *
 * Fetched on its own: it is not part of the issued/approved set, so a missing
 * checklist never raises a "rebuilt" banner or delays the other papers.
 */
export function useServiceChecklistPaper(deal: OcpiDeal, ref?: string | null): Paper {
  const s = useOcpiStore();
  const machine = s.machineById(deal.machineId);
  const checklist = s.serviceChecklistFor(deal.machineId);

  const [blob, setBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setBlob(null);
    if (!checklist) return;
    setBusy(true);
    fetchServiceChecklistPdf(checklist)
      .then((b) => { if (!cancelled) setBlob(b); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [checklist?.filePath]);

  return {
    key: "service-checklist",
    label: "Service checklist",
    blob,
    attach: true,
    loading: busy,
    fileName: `${safe(ref ?? deal.ocNo ?? deal.quotationNo ?? "OCPI")} - Service checklist - ${safe(machine?.name ?? "machine")}.pdf`,
    missingNote: busy
      ? "Loading the service checklist…"
      : checklist
        ? "The service checklist PDF could not be loaded."
        : `No service checklist PDF is uploaded for ${machine?.name ?? "this machine"} yet. Add it on Masters → Service checklists (PDF).`,
  };
}
