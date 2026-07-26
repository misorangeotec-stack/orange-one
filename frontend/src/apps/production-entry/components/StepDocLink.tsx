import { useState } from "react";
import { FileText } from "lucide-react";
import { useProductionStore } from "../store";

/**
 * Opens a stored stage document (QC / M/C / log book / FG-transfer attachment)
 * via a fresh short-lived signed URL. Used both inside the step modals and on the
 * job-card detail's Attachments list, so it lives in its own file.
 */
export default function StepDocLink({ path, name }: { path: string; name: string | null }) {
  const s = useProductionStore();
  const [busy, setBusy] = useState(false);
  const open = async () => {
    if (busy) return;
    setBusy(true);
    try {
      window.open(await s.qcDocumentUrl(path), "_blank", "noopener,noreferrer");
    } catch {
      /* surfaced elsewhere */
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      onClick={open}
      disabled={busy}
      className="inline-flex max-w-[240px] items-center gap-1.5 text-[12.5px] font-semibold text-orange hover:underline disabled:opacity-60"
    >
      <FileText className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{busy ? "Opening…" : name || "View attachment"}</span>
    </button>
  );
}
