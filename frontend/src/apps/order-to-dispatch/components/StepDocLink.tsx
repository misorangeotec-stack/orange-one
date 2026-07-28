import { useState } from "react";
import { FileText } from "lucide-react";
import { useDispatchStore } from "../store";

/**
 * Opens a stored step document (the sales invoice, or the receiver copy / LR) via
 * a fresh short-lived signed URL. Used inside the step modals and on the order
 * detail's planned-vs-actual panel, so it lives in its own file.
 */
export default function StepDocLink({ path, name }: { path: string; name: string | null }) {
  const s = useDispatchStore();
  const [busy, setBusy] = useState(false);
  const open = async () => {
    if (busy) return;
    setBusy(true);
    try {
      window.open(await s.stepDocumentUrl(path), "_blank", "noopener,noreferrer");
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
