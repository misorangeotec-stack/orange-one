import { useState } from "react";
import { FileText } from "lucide-react";
import { useSamplingStore } from "../store";

/**
 * Opens a stored sampling attachment through a fresh short-lived signed URL.
 *
 * ONE component for every document in the module — the gate pass, the result
 * report, the lab report, the sample-received note. Four byte-identical copies of
 * this had already been hand-rolled inside the modals that needed them, and the
 * gate pass would have been the fifth.
 *
 * The URL is minted on CLICK, never on render: a signed URL lasts ten minutes, so
 * one baked in at render time is dead by the time a modal has been open a while.
 */
export default function DocLink({
  path,
  name,
  fallback = "View attachment",
}: {
  path: string;
  name: string | null;
  fallback?: string;
}) {
  const s = useSamplingStore();
  const [busy, setBusy] = useState(false);

  const open = async () => {
    if (busy) return;
    setBusy(true);
    try {
      window.open(await s.resultDocumentUrl(path), "_blank", "noopener,noreferrer");
    } catch {
      /* surfaced elsewhere; keep the host quiet */
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
      <span className="truncate">{busy ? "Opening…" : name || fallback}</span>
    </button>
  );
}
